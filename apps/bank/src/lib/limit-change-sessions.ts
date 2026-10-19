import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  accounts,
  credentials,
  limitChangeSessions,
  type LimitChangeSession,
  type LimitChangeSessionState,
} from "../db/schema.js";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_NAMED_QUERY,
} from "./credential-types.js";
import { extractAuthSubject, passedLoginBinding } from "./login-checks.js";
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

export interface LimitChangeStatusDto {
  state: LimitChangeSessionState;
  failureReason?: string;
  /**
   * Carried on the status rather than fetched separately, because the dialog's
   * success copy names the amount and the only thing it still holds by then is
   * a session id.
   */
  newLimitCents: number;
}

export type RefreshLimitChangeResult =
  | { ok: true; status: LimitChangeStatusDto }
  | { ok: false; reason: "not_found" };

/**
 * Reads one session, scoped THREE ways: by id, by the account it names, and by
 * the customer who started it.
 *
 * All three absences answer the same `null`, and the route turns that into one
 * 404. A session id is guessable and this flow writes to an account, so
 * "this is not yours" must not be distinguishable from "this does not exist" —
 * the same rule `getTransactionProof` follows.
 *
 * Scoped HERE rather than in the route, for the same reason: a route is one
 * caller of many, and the check belongs with the read.
 *
 * No foundry traffic. `refreshLimitChangeState` does that.
 */
function loadSession(
  db: Db,
  userId: string,
  accountId: string,
  sessionId: string,
): LimitChangeSession | undefined {
  return db
    .select()
    .from(limitChangeSessions)
    .where(
      and(
        eq(limitChangeSessions.id, sessionId),
        eq(limitChangeSessions.startedByUserId, userId),
        eq(limitChangeSessions.accountId, accountId),
      ),
    )
    .get();
}

/** A plain lookup. No foundry traffic — `refreshLimitChangeState` does that. */
export function getLimitChangeStatus(
  db: Db,
  userId: string,
  accountId: string,
  sessionId: string,
): LimitChangeStatusDto | null {
  const row = loadSession(db, userId, accountId, sessionId);
  if (!row) return null;

  return {
    state: row.state,
    failureReason: row.failureReason ?? undefined,
    newLimitCents: row.newLimitCents,
  };
}

/**
 * Polled by the browser roughly every 2s. Drives `pending → verified | failed`
 * and NOTHING else — writing the limit is `applyLimitChange`'s job, on a POST,
 * because a GET with a side effect gets fired twice by a prefetch or a
 * double-poll and here the side effect writes to an account.
 *
 * Order mirrors `refreshLoginSessionState` exactly: terminal (no traffic), then
 * expiry (no traffic), then already-verified (no traffic), and only then
 * foundry. An abandoned tab stops generating admin-API calls the moment its
 * window closes.
 *
 * Then four gates, in this order:
 *
 *   1. foundry reports the presentation verified;
 *   2. `transaction_data_binding` passed on the credential that answered the
 *      authenticator query;
 *   3. `extractAuthSubject` yields a `sub`;
 *   4. that `sub` resolves to an authenticator credential owned by
 *      `started_by_user_id`.
 *
 * **(4) IS THE GATE THIS FLOW ADDS OVER WALLET LOGIN, AND IT LIVES HERE RATHER
 * THAN IN APPLY.** Login resolves a `sub` to whoever owns that credential —
 * that is the point, nobody is signed in yet. Here somebody is, and without
 * this check any valid Sparkassen Authenticator presentation could approve any
 * logged-in customer's limit change. Putting it in apply instead would need a
 * second `getVerificationStatus` call after the session had gone terminal and,
 * worse, would let a stranger's valid presentation drive the session to
 * `verified` — showing the holder a success-shaped dialog that apply then
 * rejects. `verified` must mean *the right person approved*, or the state name
 * is a lie.
 *
 * (2) sits between READING the `sub` and RESOLVING it, deliberately, for the
 * reason `login-sessions.ts` documents: reading a claim out of a JSON blob is
 * inert; turning it into a customer is the act, and an unbound presentation
 * must never reach that point.
 */
export async function refreshLimitChangeState(
  db: Db,
  foundry: FoundryClient,
  input: { userId: string; accountId: string; sessionId: string },
  now: number = Date.now(),
): Promise<RefreshLimitChangeResult> {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  const done = (): RefreshLimitChangeResult => ({
    ok: true,
    status: getLimitChangeStatus(
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
  if (now - row.createdAt > LIMIT_CHANGE_SESSION_TTL_MS) {
    failLimitChange(db, input.sessionId, "expired");
    return done();
  }

  // Approved and waiting for the apply. Re-polling foundry would tell us
  // nothing we have not already recorded.
  if (row.state === "verified") return done();

  if (!row.foundryVerificationId) {
    failLimitChange(db, input.sessionId, "verification_failed");
    return done();
  }

  let verdict;
  try {
    verdict = await foundry.getVerificationStatus(row.foundryVerificationId);
  } catch {
    // Transient. Stay pending so a later poll can recover; only the client's
    // consecutive-failure counter decides when to give up.
    return done();
  }

  if (verdict.state === "pending") return done();

  if (verdict.state === "failed" || verdict.result?.verified !== true) {
    failLimitChange(db, input.sessionId, "verification_failed");
    return done();
  }

  const subject = extractAuthSubject(verdict.result.credentials);
  if (!subject) {
    // Either no credential answered the authenticator query, or the one that
    // did disclosed no usable `sub`. Both are the wallet's answer being wrong,
    // not the customer being unknown.
    failLimitChange(db, input.sessionId, "verification_failed");
    return done();
  }

  if (!passedLoginBinding(verdict.result.credentials)) {
    // A wallet that ignored the `transaction_data` entry yields a verdict that
    // is `verified: true` and still worthless: nothing in it is tied to THESE
    // two amounts, so it attests an approval of a transition the holder may
    // never have seen. Its own reason, so an operator can tell this apart from
    // every other bad presentation; the holder sees the generic copy.
    failLimitChange(db, input.sessionId, "transaction_data_binding_failed");
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
    failLimitChange(db, input.sessionId, "unknown_credential");
    return done();
  }

  if (credential.userId !== row.startedByUserId) {
    // A stranger's valid authenticator. Its OWN reason, distinct from
    // `unknown_credential`, so an operator can tell a credential issued to the
    // wrong person from one this bank cannot place at all. The holder sees the
    // same generic copy for both — neither is something they can act on.
    failLimitChange(db, input.sessionId, "wrong_customer");
    return done();
  }

  // Deliberately NOT gated on `credential.state === "active"`, for the reason
  // wallet login is not: foundry's verdict is the authority that the credential
  // is real and holder-bound; this row only answers WHOSE. Nothing here ever
  // clears an `offered` row.
  db.update(limitChangeSessions)
    .set({ state: "verified", approvedByUserId: credential.userId })
    .where(eq(limitChangeSessions.id, input.sessionId))
    .run();

  return done();
}

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failLimitChange(db: Db, sessionId: string, reason: string): void {
  db.update(limitChangeSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(limitChangeSessions.id, sessionId))
    .run();
}
export type ApplyLimitChangeResult =
  | { ok: true; dailyLimitCents: number }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_verified"
        | "already_applied"
        | "expired"
        | "limit_changed";
    };

/**
 * Writes the approved limit and moves `verified → applied`.
 *
 * A POST rather than part of the poll, for the reason the login flow mints its
 * cookie on a POST: a GET with a side effect gets fired twice by a prefetch or
 * a double-poll, and here the side effect writes to an account.
 *
 * Synchronous, because better-sqlite3 is. That is not incidental — the guarded
 * UPDATE below is the whole single-use mechanism and is only meaningful as one
 * statement rather than a read followed by a write.
 *
 * Re-checks only what is LOCAL and could have moved since the poll ran: the
 * caller still owns the session and the account, the window is still open, and
 * the account's limit still equals the snapshot. Everything the wallet said is
 * already settled — this function never talks to foundry.
 *
 * Ownership is checked here and not in the route, for the same reason
 * `getTransactionProof` checks it rather than its route: a route is one caller
 * of many, and the check belongs with the read.
 */
export function applyLimitChange(
  db: Db,
  input: { userId: string; accountId: string; sessionId: string },
  now: number = Date.now(),
): ApplyLimitChangeResult {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  // Distinguished from `not_verified` so the route can answer 410 rather than
  // 409: an applied session is gone for good, a pending one might yet arrive.
  if (row.state === "applied") return { ok: false, reason: "already_applied" };
  if (row.state !== "verified") return { ok: false, reason: "not_verified" };

  if (now - row.createdAt > LIMIT_CHANGE_SESSION_TTL_MS) {
    failLimitChange(db, input.sessionId, "expired");
    return { ok: false, reason: "expired" };
  }

  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, row.accountId))
    .get();
  if (!account) return { ok: false, reason: "not_found" };

  // THE STALE-SNAPSHOT GATE, and it comes before the guarded write on purpose.
  //
  // `old_limit_cents` is half of what the holder signed over. If the account
  // moved underneath — two dialogs open on one account — applying
  // `new_limit_cents` anyway would honour an approval of a transition that is
  // no longer the one happening. Refusing BEFORE the write leaves the session
  // claimable, so the holder's approval is not burned for nothing: if whatever
  // moved the limit is undone, this same session still applies.
  if (account.dailyLimitCents !== row.oldLimitCents) {
    return { ok: false, reason: "limit_changed" };
  }

  // A GUARDED WRITE, not a read-then-write. `.changes` is what decides whether
  // THIS call won the race to consume the session; checking the state above
  // and then updating unconditionally would let two concurrent applies both
  // proceed, and the second would write a limit against a snapshot the first
  // had already invalidated.
  const consumed = db
    .update(limitChangeSessions)
    .set({ state: "applied" })
    .where(
      and(
        eq(limitChangeSessions.id, input.sessionId),
        eq(limitChangeSessions.state, "verified"),
      ),
    )
    .run();
  if (consumed.changes !== 1) return { ok: false, reason: "already_applied" };

  db.update(accounts)
    .set({ dailyLimitCents: row.newLimitCents })
    .where(eq(accounts.id, row.accountId))
    .run();

  return { ok: true, dailyLimitCents: row.newLimitCents };
}

export type RelayLimitChangeResult =
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
 * running in the dialog reads — one state path, not two. Applying the limit
 * here instead would give same-device and cross-device changes two different
 * routes to a write, and they would drift.
 *
 * `dc-api-relay.ts`'s shape with the ownership check added, DUPLICATED rather
 * than generalised: the login relay takes no owner and is already tested where
 * it lives, so a shared relay would need a table parameter and an optional
 * owner to serve both — more surface than the eight lines it saves.
 */
export async function relayLimitChangeDcApiResponse(
  db: Db,
  client: FoundryClient,
  input: {
    userId: string;
    accountId: string;
    sessionId: string;
    response: string;
  },
): Promise<RelayLimitChangeResult> {
  const row = loadSession(db, input.userId, input.accountId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) {
    return { ok: false, reason: "no_verification" };
  }

  try {
    await client.submitDcApiResponse(
      row.foundryVerificationId,
      input.response,
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}
