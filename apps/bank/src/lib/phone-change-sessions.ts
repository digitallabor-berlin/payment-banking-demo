import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  phoneChangeSessions,
  users,
  type PhoneChangeSessionState,
} from "../db/schema.js";
import { SPARKASSEN_AUTH_NAMED_QUERY } from "./credential-types.js";
import {
  isSamePhoneNumber,
  isValidPhoneNumber,
  normalisePhoneNumber,
} from "./phone-validation.js";
import {
  buildPhoneChangeAdHocMetadataRequest,
  buildPhoneChangeTransactionData,
} from "./phone-transaction-data.js";
import {
  isDcApiTransport,
  resolveDcApiProtocol,
  type PresentationTransport,
} from "./transport.js";

/**
 * How long a phone-change session may be approved within. Five minutes,
 * matching `LIMIT_CHANGE_SESSION_TTL_MS` and `LOGIN_SESSION_TTL_MS`.
 *
 * The session id is NOT a bearer token — every route that touches it is behind
 * the session cookie and scoped to the logged-in customer. The short window is
 * here because a stale approval is an approval of a transition that may no
 * longer be the one happening, which is the same thing `old_phone` guards at
 * apply time.
 */
export const PHONE_CHANGE_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * What the dialog needs to drive a handover, under the dialog's own prop names.
 *
 * The start route returns this value STRAIGHT THROUGH — `NextResponse.json(
 * result.session, …)` — never re-assembled from its members. The written-out
 * return annotation on `startPhoneChange` is the guard that makes that safe:
 * this repo lost `dcApiProtocol` at exactly this seam once (6e997da), from an
 * object literal a type could not check.
 *
 * There is no `accountId`, unlike `LimitChangeSessionDto`: the mobile number
 * is a property of the customer and this flow names no account anywhere.
 */
export interface PhoneChangeSessionDto {
  sessionId: string;
  /** Null under either DC API transport — foundry inlines the request object. */
  uri: string | null;
  /** What foundry ACTUALLY served, which is not always what was asked for. */
  transport: PresentationTransport;
  /** foundry's inline request object. Null under request_uri. */
  dcApiRequest: unknown;
  /** foundry's protocol identifier, verbatim. Null under request_uri. */
  dcApiProtocol: string | null;
  state: PhoneChangeSessionState;
  oldPhone: string;
  newPhone: string;
}

export type StartPhoneChangeResult =
  | { ok: true; session: PhoneChangeSessionDto }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_phone"
        | "phone_unchanged"
        | "metadata_unavailable"
        | "foundry_unavailable";
    };

/**
 * Opens a phone-change presentation.
 *
 * Order: resolve the customer → validate the number → refuse an unchanged one
 * → write the `pending` row → mint the ad-hoc metadata → create the
 * verification request → persist what foundry served.
 *
 * The row is written BEFORE either foundry call, so a refusal leaves a visible
 * `failed` row rather than nothing at all — the property `startLimitChange`,
 * `startTransfer` and `startLoginSession` all rely on. That matters more here
 * than usual: no local foundry declares the `sparkassen_auth` named query, so
 * a local run takes a failure path every time.
 *
 * Validation comes FIRST, before any write and any traffic: a caller with
 * `curl` must not be able to make the bank talk to foundry, or leave a row
 * behind, with a string the bank has already rejected.
 *
 * **The mint failing is its own reason.** It shares a `try` with the
 * verification request but not a failure reason, because "foundry is down" and
 * "foundry will not describe this transaction data type" are different
 * operator problems — and only the second is fixed by looking at a PaSO
 * config. More importantly the verification request is then NEVER created: an
 * entry with no `metadata` is the anti-goal, not a degraded mode, and
 * **nothing server-side enforces that** — measured on the deployed foundry, an
 * entry with `metadata` omitted is accepted at HTTP 200. This ordering is the
 * only thing standing between the demo and its anti-goal.
 */
export async function startPhoneChange(
  db: Db,
  client: FoundryClient,
  input: {
    userId: string;
    /** Unvalidated — it arrived over HTTP. `isValidPhoneNumber` is the gate. */
    phoneNumber: unknown;
    /**
     * The transport the browser resolved. Defaults to the cross-device QR,
     * which works everywhere — a caller that cannot decide gets the safe one
     * rather than a DC API call it cannot make.
     */
    transport?: PresentationTransport;
  },
  now: number = Date.now(),
): Promise<StartPhoneChangeResult> {
  const requestedTransport = input.transport ?? "request_uri";

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  if (!user) return { ok: false, reason: "not_found" };

  if (!isValidPhoneNumber(input.phoneNumber)) {
    return { ok: false, reason: "invalid_phone" };
  }
  // The ONE transformation applied to a number that is stored or sent. The
  // column, the signed payload and the dashboard row are all this string.
  const newPhone = normalisePhoneNumber(input.phoneNumber)!;

  // There is nothing to confirm, and a consent screen showing one number twice
  // is a defect — the analogue of the limit dialog withholding the chip equal
  // to the limit in force. The comparison is on DIGITS ONLY, so retyping the
  // stored number without its spaces is caught too.
  if (isSamePhoneNumber(user.phoneNumber, newPhone)) {
    return { ok: false, reason: "phone_unchanged" };
  }

  const sessionId = `phone_${randomUUID()}`;

  // The first write records what is being ATTEMPTED, so a `failed` row names
  // the transport that failed. A row that reaches foundry has this corrected
  // below to what was actually served.
  db.insert(phoneChangeSessions)
    .values({
      id: sessionId,
      startedByUserId: user.id,
      // A SNAPSHOT. It is half of what the holder signs over, and
      // `applyPhoneChange` refuses if the user row no longer agrees with it.
      oldPhone: user.phoneNumber,
      newPhone,
      state: "pending",
      transport: requestedTransport,
      createdAt: now,
    })
    .run();

  let metadataJwt: string;
  try {
    const minted = await client.createAdHocMetadata(
      buildPhoneChangeAdHocMetadataRequest(),
    );
    // CHECKED AT RUNTIME, not just typed. `FoundryClient.request` does
    // `JSON.parse(text) as T` and throws only on a non-2xx or a non-JSON body,
    // so a 200 carrying `{}`, a null, or a renamed field leaves this
    // `undefined` with nothing raised. `JSON.stringify` would then DROP
    // `metadata` from the entry silently, and foundry — measured — accepts an
    // entry with no `metadata` at HTTP 200. The anti-goal would ship looking
    // like success.
    if (typeof minted?.jwt !== "string" || minted.jwt.length === 0) {
      failPhoneChange(db, sessionId, "metadata_unavailable");
      return { ok: false, reason: "metadata_unavailable" };
    }
    metadataJwt = minted.jwt;
  } catch {
    failPhoneChange(db, sessionId, "metadata_unavailable");
    return { ok: false, reason: "metadata_unavailable" };
  }

  try {
    const response = await client.createVerificationRequest({
      transport: requestedTransport,
      named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY,
      transaction_data: buildPhoneChangeTransactionData({
        oldPhone: user.phoneNumber,
        newPhone,
        metadataJwt,
      }),
    });

    // Under either DC API transport foundry returns neither uri — the request
    // object is inlined, because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? null;
    const returnedRequest = response.dc_api_request ?? null;
    const returnedProtocol = resolveDcApiProtocol(
      requestedTransport,
      response.protocol,
    );

    // The RESPONSE decides the transport, never the request. A foundry too old
    // to know `dc_api_signed` does not reject it — unknown transport strings
    // fall through to `response_mode: direct_post.jwt` — so such a build
    // answers with a URI and no inline request object. Recording the requested
    // value there would leave the dialog offering a wallet button it cannot
    // invoke while suppressing the QR that would have worked.
    const usableDcApi =
      isDcApiTransport(requestedTransport) &&
      returnedRequest !== null &&
      returnedProtocol !== null;
    const transport: PresentationTransport = usableDcApi
      ? requestedTransport
      : "request_uri";
    const dcApiRequest = usableDcApi ? returnedRequest : null;
    const dcApiProtocol = usableDcApi ? returnedProtocol : null;

    db.update(phoneChangeSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        transport,
        dcApiRequestJson:
          dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
        dcApiProtocol,
      })
      .where(eq(phoneChangeSessions.id, sessionId))
      .run();

    return {
      ok: true,
      session: {
        sessionId,
        uri: usableDcApi ? null : uri,
        transport,
        dcApiRequest,
        dcApiProtocol,
        state: "pending",
        oldPhone: user.phoneNumber,
        newPhone,
      },
    };
  } catch {
    failPhoneChange(db, sessionId, "foundry_unavailable");
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failPhoneChange(db: Db, sessionId: string, reason: string): void {
  db.update(phoneChangeSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(phoneChangeSessions.id, sessionId))
    .run();
}

/**
 * Reads one session, scoped TWO ways: by id and by the customer who started
 * it. There is no account in this flow.
 *
 * Both absences answer the same `undefined`, and the routes turn that into one
 * 404. A session id is guessable and this flow writes to a customer's row, so
 * "this is not yours" must not be distinguishable from "this does not exist" —
 * the same rule `getTransactionProof` follows.
 *
 * Scoped HERE rather than in the route, for the same reason: a route is one
 * caller of many, and the check belongs with the read.
 */
export function loadPhoneChangeSession(
  db: Db,
  userId: string,
  sessionId: string,
) {
  return db
    .select()
    .from(phoneChangeSessions)
    .where(
      and(
        eq(phoneChangeSessions.id, sessionId),
        eq(phoneChangeSessions.startedByUserId, userId),
      ),
    )
    .get();
}