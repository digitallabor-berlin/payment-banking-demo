import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  accounts,
  limitChangeSessions,
  type LimitChangeSessionState,
} from "../db/schema.js";
import { SPARKASSEN_AUTH_NAMED_QUERY } from "./credential-types.js";
import { isValidNewLimit } from "./limit-presets.js";
import {
  buildLimitChangeAdHocMetadataRequest,
  buildLimitChangeTransactionData,
} from "./limit-transaction-data.js";
import {
  isDcApiTransport,
  resolveDcApiProtocol,
  type PresentationTransport,
} from "./transport.js";

/**
 * How long a limit-change session may be approved within. Five minutes,
 * matching `LOGIN_SESSION_TTL_MS`.
 *
 * Unlike a login session id, this one is NOT a bearer token — every route that
 * touches it is behind the session cookie and scoped to the logged-in user. The
 * short window is here because a stale approval is an approval of a transition
 * that may no longer be the one happening, which is the same thing
 * `oldLimitCents` guards at apply time.
 */
export const LIMIT_CHANGE_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * What the dialog needs to drive a handover, under the dialog's own prop names.
 *
 * The start route returns this value STRAIGHT THROUGH — `NextResponse.json(
 * result.session, …)` — never re-assembled from its members. The written-out
 * return annotation on `startLimitChange` is the guard that makes that safe:
 * this repo lost `dcApiProtocol` at exactly this seam once (6e997da), from an
 * object literal a type could not check.
 */
export interface LimitChangeSessionDto {
  sessionId: string;
  accountId: string;
  /** Null under either DC API transport — foundry inlines the request object. */
  uri: string | null;
  /** What foundry ACTUALLY served, which is not always what was asked for. */
  transport: PresentationTransport;
  /** foundry's inline request object. Null under request_uri. */
  dcApiRequest: unknown;
  /** foundry's protocol identifier, verbatim. Null under request_uri. */
  dcApiProtocol: string | null;
  state: LimitChangeSessionState;
  oldLimitCents: number;
  newLimitCents: number;
}

export type StartLimitChangeResult =
  | { ok: true; session: LimitChangeSessionDto }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_limit"
        | "metadata_unavailable"
        | "foundry_unavailable";
    };

/**
 * Opens a limit-change presentation.
 *
 * Order: resolve and own the account → validate the new limit → write the
 * `pending` row → mint the ad-hoc metadata → create the verification request →
 * persist what foundry served.
 *
 * The row is written BEFORE either foundry call, so a refusal leaves a visible
 * `failed` row rather than nothing at all — the property `startIssuance`,
 * `startLoginSession` and the merchant's `startPaymentSession` all rely on.
 * That matters more here than usual: no local foundry declares the
 * `sparkassen_auth` named query, so a local run takes a failure path every
 * time.
 *
 * Ownership and validation come FIRST, before any write and any traffic: a
 * caller must not be able to make the bank talk to foundry, or leave a row
 * behind, by naming an account that is not theirs.
 *
 * **The mint failing is its own reason.** It shares a `try` with the
 * verification request but not a failure reason, because "foundry is down" and
 * "foundry will not describe this transaction data type" are different operator
 * problems — and only the second one is fixed by looking at a PaSO config. More
 * importantly the verification request is then NEVER created: an entry with no
 * `metadata` is the anti-goal, not a degraded mode.
 */
export async function startLimitChange(
  db: Db,
  client: FoundryClient,
  input: {
    userId: string;
    accountId: string;
    /** Unvalidated — it arrived over HTTP. `isValidNewLimit` is the gate. */
    newLimitCents: unknown;
    /**
     * The transport the browser resolved. Defaults to the cross-device QR,
     * which works everywhere — a caller that cannot decide gets the safe one
     * rather than a DC API call it cannot make.
     *
     * Carried in `input` rather than as a positional parameter beside `now`
     * (which `startLoginSession` does) because this function already takes a
     * bag of request-shaped values and a fifth positional after an optional
     * one reads as an accident.
     */
    transport?: PresentationTransport;
  },
  now: number = Date.now(),
): Promise<StartLimitChangeResult> {
  const requestedTransport = input.transport ?? "request_uri";

  // Scoped by user as well as id, so another customer's account and a
  // nonexistent one are indistinguishable — the id is guessable and this flow
  // writes to the account it names.
  const account = db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.id, input.accountId), eq(accounts.userId, input.userId)),
    )
    .get();
  if (!account) return { ok: false, reason: "not_found" };

  if (!isValidNewLimit(input.newLimitCents, account.dailyLimitCents)) {
    return { ok: false, reason: "invalid_limit" };
  }
  const newLimitCents = input.newLimitCents;

  const sessionId = `limit_${randomUUID()}`;

  // The first write records what is being ATTEMPTED, so a `failed` row names
  // the transport that failed. A row that reaches foundry has this corrected
  // below to what was actually served.
  db.insert(limitChangeSessions)
    .values({
      id: sessionId,
      startedByUserId: input.userId,
      accountId: account.id,
      // A SNAPSHOT. It is half of what the holder signs over, and
      // `applyLimitChange` refuses if the account no longer agrees with it.
      oldLimitCents: account.dailyLimitCents,
      newLimitCents,
      state: "pending",
      transport: requestedTransport,
      createdAt: now,
    })
    .run();

  let metadataJwt: string;
  try {
    const minted = await client.createAdHocMetadata(
      buildLimitChangeAdHocMetadataRequest(),
    );
    metadataJwt = minted.jwt;
  } catch {
    failLimitChange(db, sessionId, "metadata_unavailable");
    return { ok: false, reason: "metadata_unavailable" };
  }

  try {
    const response = await client.createVerificationRequest({
      transport: requestedTransport,
      named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY,
      transaction_data: buildLimitChangeTransactionData({
        oldLimitCents: account.dailyLimitCents,
        newLimitCents,
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

    db.update(limitChangeSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        transport,
        dcApiRequestJson:
          dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
        dcApiProtocol,
      })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    return {
      ok: true,
      session: {
        sessionId,
        accountId: account.id,
        uri: usableDcApi ? null : uri,
        transport,
        dcApiRequest,
        dcApiProtocol,
        state: "pending",
        oldLimitCents: account.dailyLimitCents,
        newLimitCents,
      },
    };
  } catch {
    failLimitChange(db, sessionId, "foundry_unavailable");
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failLimitChange(db: Db, sessionId: string, reason: string): void {
  db.update(limitChangeSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(limitChangeSessions.id, sessionId))
    .run();
}