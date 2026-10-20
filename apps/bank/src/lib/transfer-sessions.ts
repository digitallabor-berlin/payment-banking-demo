import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  accounts,
  transferSessions,
  type TransferSessionState,
} from "../db/schema.js";
import { SPARKASSEN_AUTH_NAMED_QUERY } from "./credential-types.js";
import {
  buildTransferAdHocMetadataRequest,
  buildTransferTransactionData,
} from "./transfer-transaction-data.js";
import { validateTransferInput } from "./transfer-validation.js";
import {
  isDcApiTransport,
  resolveDcApiProtocol,
  type PresentationTransport,
} from "./transport.js";

/**
 * How long a transfer session may be approved within. Five minutes, matching
 * `LOGIN_SESSION_TTL_MS` and `LIMIT_CHANGE_SESSION_TTL_MS`.
 *
 * Unlike a login session id, this one is NOT a bearer token — every route that
 * touches it is behind the session cookie and scoped to the logged-in user.
 * The short window is here because a stale approval is an approval taken
 * against a balance and a limit that may no longer hold, which is exactly what
 * `applyTransfer` re-checks.
 */
export const TRANSFER_SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Re-exported rather than redeclared.
 *
 * `db/schema.ts` derives it from the table's own `enum:`, the way
 * `LimitChangeSessionState` and `LoginSessionState` are derived, so the state
 * machine has one definition and the column cannot drift from the type that
 * claims to describe it.
 */
export type { TransferSessionState };

/**
 * What the dialog needs to drive a handover, under the dialog's own prop names.
 *
 * The start route returns this value STRAIGHT THROUGH — `NextResponse.json(
 * result.session, …)` — never re-assembled from its members. The written-out
 * return annotation on `startTransfer` is the guard that makes that safe: this
 * repo lost `dcApiProtocol` at exactly this seam once (6e997da), from an
 * object literal a type could not check.
 */
export interface TransferSessionDto {
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
  state: TransferSessionState;
  payeeName: string;
  payeeIban: string;
  amountCents: number;
  purpose: string;
}

export type StartTransferResult =
  | { ok: true; session: TransferSessionDto }
  | {
      ok: false;
      reason:
        | "not_found"
        | "invalid_request"
        | "limit_exceeded"
        | "insufficient_funds"
        | "metadata_unavailable"
        | "foundry_unavailable";
    };

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failTransfer(db: Db, sessionId: string, reason: string): void {
  db.update(transferSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(transferSessions.id, sessionId))
    .run();
}

/**
 * Opens a transfer presentation.
 *
 * Order, and the order IS the design: resolve and own the account → validate
 * the four typed values → the limit gate → the balance gate → write the
 * `pending` row recording the REQUESTED transport → mint the ad-hoc metadata
 * → create the verification request → correct the row to what was SERVED.
 *
 * **The two money gates come before any write and any traffic.** There is no
 * reason to ask a human to approve something the bank has already decided to
 * reject, and no reason to spend an ad-hoc mint on it. Both use `>`, so an
 * amount exactly equal to the limit, or exactly equal to the balance, is
 * ALLOWED — a customer can send their whole balance.
 *
 * Ownership and validation come first for the same reason they do in
 * `startLimitChange`: a caller must not be able to make the bank talk to
 * foundry, or leave a row behind, by naming an account that is not theirs.
 *
 * The row is written BEFORE either foundry call, so a refusal leaves a visible
 * `failed` row rather than nothing at all. That matters more here than usual:
 * no local foundry declares the `sparkassen_auth` named query, so a local run
 * takes a failure path every time.
 *
 * **The mint failing is its own reason, and the verification request is then
 * NEVER created.** "foundry is down" and "foundry will not describe this
 * transaction data type" are different operator problems, and only the second
 * is fixed by looking at a PaSO config. More importantly: foundry accepts an
 * entry with no `metadata` at HTTP 200 (measured), so this ordering is the
 * only thing standing between the demo and its anti-goal — a wallet rendering
 * raw claim names and an unformatted amount to a human, which looks like the
 * feature working.
 */
export async function startTransfer(
  db: Db,
  client: FoundryClient,
  input: {
    userId: string;
    accountId: string;
    /** All four are unvalidated — they arrived over HTTP. */
    payeeName: unknown;
    payeeIban: unknown;
    amount: unknown;
    purpose: unknown;
    /**
     * The transport the browser resolved. Defaults to the cross-device QR,
     * which works everywhere — a caller that cannot decide gets the safe one
     * rather than a DC API call it cannot make.
     */
    transport?: PresentationTransport;
  },
  now: number = Date.now(),
): Promise<StartTransferResult> {
  const requestedTransport = input.transport ?? "request_uri";

  // Scoped by user as well as id, so another customer's account and a
  // nonexistent one are indistinguishable — the id is guessable and this flow
  // ends in a debit of the account it names.
  const account = db
    .select()
    .from(accounts)
    .where(
      and(eq(accounts.id, input.accountId), eq(accounts.userId, input.userId)),
    )
    .get();
  if (!account) return { ok: false, reason: "not_found" };

  // The route's zod schema checks the WIRE SHAPE; this checks the MEANING.
  // The two are split deliberately, as `newLimitCents` and `isValidNewLimit`
  // already are — a logged-in caller with `curl` is the real input surface.
  const valid = validateTransferInput(input);
  if (!valid) return { ok: false, reason: "invalid_request" };

  // `>` on both, so equality passes. See the doc comment.
  if (valid.amountCents > account.dailyLimitCents) {
    return { ok: false, reason: "limit_exceeded" };
  }
  if (valid.amountCents > account.balanceCents) {
    return { ok: false, reason: "insufficient_funds" };
  }

  const sessionId = `transfer_${randomUUID()}`;

  // The first write records what is being ATTEMPTED, so a `failed` row names
  // the transport that failed. A row that reaches foundry has this corrected
  // below to what was actually served.
  db.insert(transferSessions)
    .values({
      id: sessionId,
      startedByUserId: input.userId,
      accountId: account.id,
      // The NORMALISED values, never the characters the user typed. The
      // stored row, the signed payload and the consent screen all derive from
      // this one source.
      payeeName: valid.payeeName,
      payeeIban: valid.payeeIban,
      amountCents: valid.amountCents,
      purpose: valid.purpose,
      state: "pending",
      transport: requestedTransport,
      createdAt: now,
    })
    .run();

  let metadataJwt: string;
  try {
    const minted = await client.createAdHocMetadata(
      buildTransferAdHocMetadataRequest(),
    );
    // CHECKED AT RUNTIME, not just typed. `FoundryClient.request` does
    // `JSON.parse(text) as T` and throws only on a non-2xx or a non-JSON body,
    // so a 200 carrying `{}`, a null, or a renamed field leaves this
    // `undefined` with nothing raised — and `JSON.stringify` would then DROP
    // `metadata` from the entry silently. The `metadataJwt: string` parameter
    // is a compile-time claim an `as` cast makes on an untyped wire body.
    if (typeof minted.jwt !== "string" || minted.jwt.length === 0) {
      failTransfer(db, sessionId, "metadata_unavailable");
      return { ok: false, reason: "metadata_unavailable" };
    }
    metadataJwt = minted.jwt;
  } catch {
    failTransfer(db, sessionId, "metadata_unavailable");
    return { ok: false, reason: "metadata_unavailable" };
  }

  try {
    const response = await client.createVerificationRequest({
      transport: requestedTransport,
      named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY,
      transaction_data: buildTransferTransactionData({
        payeeName: valid.payeeName,
        payeeIban: valid.payeeIban,
        amountCents: valid.amountCents,
        purpose: valid.purpose,
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

    db.update(transferSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        transport,
        dcApiRequestJson:
          dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
        dcApiProtocol,
      })
      .where(eq(transferSessions.id, sessionId))
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
        payeeName: valid.payeeName,
        payeeIban: valid.payeeIban,
        amountCents: valid.amountCents,
        purpose: valid.purpose,
      },
    };
  } catch {
    failTransfer(db, sessionId, "foundry_unavailable");
    return { ok: false, reason: "foundry_unavailable" };
  }
}