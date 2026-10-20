import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  accounts,
  credentials,
  transactions,
  transferSessions,
  type TransferSession,
  type TransferSessionState,
} from "../db/schema.js";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_NAMED_QUERY,
} from "./credential-types.js";
import { extractAuthSubject, passedLoginBinding } from "./login-checks.js";
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
export interface TransferStatusDto {
  state: TransferSessionState;
  failureReason?: string;
  /**
   * Carried on the status rather than fetched separately, because the dialog's
   * success copy names the amount and the recipient and the only thing it
   * still holds by then is a session id.
   */
  amountCents: number;
  payeeName: string;
}

export type RefreshTransferResult =
  | { ok: true; status: TransferStatusDto }
  | { ok: false; reason: "not_found" };

/**
 * Reads one session, scoped THREE ways: by id, by the account it names, and by
 * the customer who started it.
 *
 * All three absences answer the same `undefined`, and the route turns that
 * into one 404. A session id is guessable and this flow ends in a debit, so
 * "this is not yours" must not be distinguishable from "this does not exist" —
 * the same rule `getTransactionProof` follows.
 *
 * Scoped HERE rather than in the route, for the same reason: a route is one
 * caller of many, and the check belongs with the read.
 */
function loadSession(
  db: Db,
  userId: string,
  accountId: string,
  sessionId: string,
): TransferSession | undefined {
  return db
    .select()
    .from(transferSessions)
    .where(
      and(
        eq(transferSessions.id, sessionId),
        eq(transferSessions.startedByUserId, userId),
        eq(transferSessions.accountId, accountId),
      ),
    )
    .get();
}

/** A plain lookup. No foundry traffic — `refreshTransferState` does that. */
export function getTransferStatus(
  db: Db,
  userId: string,
  accountId: string,
  sessionId: string,
): TransferStatusDto | null {
  const row = loadSession(db, userId, accountId, sessionId);
  if (!row) return null;

  return {
    state: row.state,
    failureReason: row.failureReason ?? undefined,
    amountCents: row.amountCents,
    payeeName: row.payeeName,
  };
}

/**
 * Polled by the browser roughly every 2s. Drives `pending → verified | failed`
 * and NOTHING else — moving the money is `applyTransfer`'s job, on a POST,
 * because a GET with a side effect gets fired twice by a prefetch or a
 * double-poll and here the side effect debits an account.
 *
 * Order mirrors `refreshLimitChangeState` exactly: terminal (no traffic), then
 * expiry (no traffic), then already-verified (no traffic), and only then
 * foundry. An abandoned tab stops generating admin-API calls the moment its
 * window closes.
 *
 * Then four gates, in this order:
 *
 *   1. foundry reports the presentation verified;
 *   2. `extractAuthSubject` yields a `sub` — a pure READ, which settles
 *      nothing;
 *   3. `transaction_data_binding` passed on the credential that answered the
 *      authenticator query;
 *   4. that `sub` RESOLVES to an authenticator credential owned by
 *      `started_by_user_id`.
 *
 * Note 2 and 3 in that order, which is not the order the design's prose lists
 * them in and is the order `login-sessions.ts` documents as correct. Reading a
 * claim out of a JSON blob is inert; the gate belongs before the claim is
 * *used*, not before it is read. The distinction is only observable in the
 * `failure_reason` a verdict gets when it is both unbound and carries a `sub`
 * nothing matches — one test pins exactly that case, because a maintainer
 * "correcting" the code to match a numbered list would silently collapse two
 * distinct wallet failures into one.
 *
 * **(4) IS THE GATE THIS FLOW ADDS OVER WALLET LOGIN, AND IT LIVES HERE RATHER
 * THAN IN APPLY.** Login resolves a `sub` to whoever owns that credential —
 * that is the point, nobody is signed in yet. Here somebody is, and without
 * this check any valid Sparkassen Authenticator presentation could approve any
 * signed-in customer's transfer. Putting it in apply instead would need a
 * second `getVerificationStatus` call after the session had gone terminal and,
 * worse, would let a stranger's valid presentation drive the session to
 * `verified` — showing the holder a success-shaped dialog that apply then
 * rejects. `verified` must mean *the right person approved*, or the state name
 * is a lie.
 *
 * A THROWN status call leaves the session `pending` rather than failing it.
 * One transient 503 inside a five-minute window must not destroy a holder's
 * approval; only the client's consecutive-failure counter decides when to give
 * up. `refreshLimitChangeState` does the same.
 */
export async function refreshTransferState(
  db: Db,
  foundry: FoundryClient,
  input: { userId: string; accountId: string; sessionId: string },
  now: number = Date.now(),
): Promise<RefreshTransferResult> {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  const done = (): RefreshTransferResult => ({
    ok: true,
    status: getTransferStatus(
      db,
      input.userId,
      input.accountId,
      input.sessionId,
    )!,
  });

  // Terminal: nothing left to learn.
  if (row.state === "applied" || row.state === "failed") return done();

  // Expiry BEFORE the foundry call, so an abandoned tab stops costing traffic.
  // `expired` is a failure reason, not a fifth state.
  if (now - row.createdAt > TRANSFER_SESSION_TTL_MS) {
    failTransfer(db, input.sessionId, "expired");
    return done();
  }

  // Approved and waiting for the apply. Re-polling foundry would tell us
  // nothing we have not already recorded.
  if (row.state === "verified") return done();

  if (!row.foundryVerificationId) {
    failTransfer(db, input.sessionId, "verification_failed");
    return done();
  }

  let verdict;
  try {
    verdict = await foundry.getVerificationStatus(row.foundryVerificationId);
  } catch {
    // Transient. Stay pending so a later poll can recover.
    return done();
  }

  if (verdict.state === "pending") return done();

  if (verdict.state === "failed" || verdict.result?.verified !== true) {
    failTransfer(db, input.sessionId, "verification_failed");
    return done();
  }

  const subject = extractAuthSubject(verdict.result.credentials);
  if (!subject) {
    // Either no credential answered the authenticator query, or the one that
    // did disclosed no usable `sub`. Both are the wallet's answer being wrong,
    // not the customer being unknown.
    failTransfer(db, input.sessionId, "verification_failed");
    return done();
  }

  if (!passedLoginBinding(verdict.result.credentials)) {
    // A wallet that ignored the `transaction_data` entry yields a verdict that
    // is `verified: true` and still worthless: nothing in it is tied to THESE
    // four values, so it attests an approval of a transfer the holder may
    // never have seen. Its own reason, so an operator can tell this apart from
    // every other bad presentation; the holder sees the generic copy.
    failTransfer(db, input.sessionId, "transaction_data_binding_failed");
    return done();
  }

  const credential = db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.credentialId, subject),
        eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID),
      ),
    )
    .get();

  if (!credential) {
    // A real, correctly-signed credential this bank cannot match to a customer.
    // Expected for anything issued before the sub was persisted; there is no
    // backfill, and the copy for this reason names the remedy.
    failTransfer(db, input.sessionId, "unknown_credential");
    return done();
  }

  if (credential.userId !== row.startedByUserId) {
    // A stranger's valid authenticator. Its OWN reason, distinct from
    // `unknown_credential`, so an operator can tell a credential issued to the
    // wrong person from one this bank cannot place at all. The holder sees the
    // same generic copy for both — neither is something they can act on.
    failTransfer(db, input.sessionId, "wrong_customer");
    return done();
  }

  // Deliberately NOT gated on `credential.state === "active"`, for the reason
  // wallet login is not: foundry's verdict is the authority that the credential
  // is real and holder-bound; this row only answers WHOSE. Nothing here ever
  // clears an `offered` row.
  db.update(transferSessions)
    .set({ state: "verified", approvedByUserId: credential.userId })
    .where(eq(transferSessions.id, input.sessionId))
    .run();

  return done();
}

export type ApplyTransferResult =
  | { ok: true; transactionId: string; newBalanceCents: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_verified"
        | "already_applied"
        | "expired"
        | "limit_exceeded"
        | "insufficient_funds";
    };

/**
 * The `sub` of an authenticator credential belonging to the approver.
 *
 * Recorded on the debit the way a card payment records the credential that
 * authorised it. The session row stores WHO approved (`approved_by_user_id`)
 * rather than WHICH credential, because §7.1's columns are exactly what the
 * holder signed over plus the session's own machinery — so the credential is
 * re-resolved here from the customer the poll already settled.
 *
 * The gate in `refreshTransferState` guarantees that customer is the one who
 * started the session, so this can never name a stranger's credential. What it
 * does not guarantee is WHICH of that customer's authenticators, if they hold
 * more than one: the newest is taken. In this demo a customer holds one, and
 * the weaker claim — "an authenticator this customer holds stands behind this
 * debit" — is the one the ledger row is making.
 */
function approvingAuthenticatorSub(db: Db, userId: string | null): string | null {
  if (!userId) return null;
  const rows = db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.userId, userId),
        eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID),
      ),
    )
    .all();
  const newest = rows
    .filter((row) => row.credentialId !== null)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  return newest?.credentialId ?? null;
}

/**
 * Debits the account and moves `verified → applied`.
 *
 * A POST rather than part of the poll, for the reason the login flow mints its
 * cookie on a POST: a GET with a side effect gets fired twice by a prefetch or
 * a double-poll, and here the side effect MOVES MONEY.
 *
 * Synchronous, because better-sqlite3 is. That is not incidental — the guarded
 * UPDATE below is the whole single-use mechanism and is only meaningful as one
 * statement rather than a read followed by a write. It never talks to foundry:
 * everything the wallet said is already settled.
 *
 * Re-checks only what is LOCAL and could have moved during the wallet round
 * trip: the caller still owns the session, the window is still open, and the
 * live account still affords the transfer. Note one of those can move BECAUSE
 * OF THIS APP — a limit change running in another tab can lower the limit
 * underneath a transfer already in the wallet.
 *
 * **A money-gate refusal returns BEFORE the transaction, leaving the session
 * `verified` and therefore claimable.** A transient refusal must not burn the
 * holder's approval: undo whatever moved the limit and this same session still
 * applies. Both gates are `>`, so equality passes.
 *
 * Ownership is checked in `loadSession` and not in the route, for the same
 * reason `getTransactionProof` checks it rather than its route: a route is one
 * caller of many, and the check belongs with the read.
 */
export function applyTransfer(
  db: Db,
  input: { userId: string; accountId: string; sessionId: string },
  now: number = Date.now(),
): ApplyTransferResult {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  // Distinguished from `not_verified` so the route can answer 410 rather than
  // 409: an applied session is gone for good, a pending one might yet arrive.
  if (row.state === "applied") return { ok: false, reason: "already_applied" };
  if (row.state !== "verified") return { ok: false, reason: "not_verified" };

  if (now - row.createdAt > TRANSFER_SESSION_TTL_MS) {
    failTransfer(db, input.sessionId, "expired");
    return { ok: false, reason: "expired" };
  }

  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .get();
  if (!account) return { ok: false, reason: "not_found" };

  // THE RE-CHECKS, and they come before the guarded write on purpose — see the
  // doc comment. The limit and the balance are NOT part of what the holder
  // signed; they are preconditions.
  if (row.amountCents > account.dailyLimitCents) {
    return { ok: false, reason: "limit_exceeded" };
  }
  if (row.amountCents > account.balanceCents) {
    return { ok: false, reason: "insufficient_funds" };
  }

  const credentialId = approvingAuthenticatorSub(db, row.approvedByUserId);
  const transactionId = `tx_${randomUUID()}`;
  const newBalanceCents = account.balanceCents - row.amountCents;

  // ONE TRANSACTION over all three writes, as `processPayment` already does
  // for the debit and its proof package. Without it, a throw partway leaves
  // the session `applied` with no debit behind it — and the retry then answers
  // 410, so the holder is told their transfer did not happen, correctly, with
  // no way to make it happen.
  return db.transaction((tx) => {
    // A GUARDED WRITE, not a read-then-write. `.changes` is what decides
    // whether THIS call won the race to consume the session; checking the
    // state above and then updating unconditionally would let two concurrent
    // applies both debit.
    //
    // Belt and braces with the unique index on `idempotency_key` below: the
    // database enforces single-debit as well as the state machine does, and
    // the two mechanisms fail independently.
    const consumed = tx
      .update(transferSessions)
      .set({ state: "applied" })
      .where(
        and(
          eq(transferSessions.id, row.id),
          eq(transferSessions.state, "verified"),
        ),
      )
      .run();
    if (consumed.changes !== 1) {
      return { ok: false, reason: "already_applied" } as ApplyTransferResult;
    }

    tx.update(accounts)
      .set({ balanceCents: newBalanceCents })
      .where(eq(accounts.id, account.id))
      .run();

    tx.insert(transactions)
      .values({
        id: transactionId,
        accountId: account.id,
        // NEGATIVE. It is a debit, and that is the ledger's convention.
        amountCents: -row.amountCents,
        counterparty: row.payeeName,
        reference: row.purpose,
        bookedAt: now,
        credentialId,
        idempotencyKey: row.id,
      })
      .run();

    // Written in the SAME transaction, so a session and its debit can never
    // disagree about whether the money moved.
    tx.update(transferSessions)
      .set({ transactionId })
      .where(eq(transferSessions.id, row.id))
      .run();

    return { ok: true, transactionId, newBalanceCents } as ApplyTransferResult;
  });
}

export type RelayTransferResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "no_verification" | "foundry_unavailable";
    };

/**
 * Relays a browser Digital Credentials API response to foundry.
 *
 * Exists because foundry's `dc-api-response` endpoint is ADMIN authenticated:
 * the browser cannot call it without the admin key, and the admin key must
 * never leave the server.
 *
 * foundry verifies synchronously and returns a verdict, which is deliberately
 * DISCARDED. The transaction state it also writes is what the poll already
 * running in the dialog reads — one state path, not two. Debiting here instead
 * would give same-device and cross-device transfers two different routes to
 * moving money, and they would drift.
 *
 * `dc-api-relay.ts`'s shape with the ownership check added, DUPLICATED rather
 * than generalised — exactly as the limit change's own relay is.
 */
export async function relayTransferDcApiResponse(
  db: Db,
  client: FoundryClient,
  input: {
    userId: string;
    accountId: string;
    sessionId: string;
    response: string;
  },
): Promise<RelayTransferResult> {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) {
    return { ok: false, reason: "no_verification" };
  }

  try {
    await client.submitDcApiResponse(row.foundryVerificationId, input.response);
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}
