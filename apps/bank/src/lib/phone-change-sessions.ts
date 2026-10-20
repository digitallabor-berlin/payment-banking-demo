import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  credentials,
  phoneChangeSessions,
  users,
  type PhoneChangeSession,
  type PhoneChangeSessionState,
} from "../db/schema.js";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_NAMED_QUERY,
} from "./credential-types.js";
import { extractAuthSubject, passedLoginBinding } from "./login-checks.js";
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

/**
 * Thrown inside `applyPhoneChange`'s transaction to roll it back when the
 * customer's number moved between the snapshot read and the write.
 *
 * A throw rather than a returned value because that is how better-sqlite3
 * rolls a transaction back; it is caught immediately below and never escapes.
 */
class StaleSnapshotError extends Error {}

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
function loadSession(
  db: Db,
  userId: string,
  sessionId: string,
): PhoneChangeSession | undefined {
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

export type ApplyPhoneChangeResult =
  | { ok: true; phoneNumber: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_verified"
        | "already_applied"
        | "expired"
        | "phone_changed";
    };

/**
 * Writes the approved number and moves `verified → applied`.
 *
 * A POST rather than part of the poll, for the reason the login flow mints its
 * cookie on a POST: a GET with a side effect gets fired twice by a prefetch or
 * a double-poll, and here the side effect writes to a customer's row.
 *
 * Synchronous, because better-sqlite3 is. That is not incidental — the guarded
 * UPDATE below is the whole single-use mechanism and is only meaningful as one
 * statement rather than a read followed by a write.
 *
 * Re-checks only what is LOCAL and could have moved since the poll ran: the
 * caller still owns the session, the window is still open, and the stored
 * number still equals the snapshot. Everything the wallet said is already
 * settled — this function never talks to foundry.
 */
export function applyPhoneChange(
  db: Db,
  input: { userId: string; sessionId: string },
  now: number = Date.now(),
): ApplyPhoneChangeResult {
  const row = loadSession(db, input.userId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  // Distinguished from `not_verified` so the route can answer 410 rather than
  // 409: an applied session is gone for good, a pending one might yet arrive.
  if (row.state === "applied") return { ok: false, reason: "already_applied" };
  if (row.state !== "verified") return { ok: false, reason: "not_verified" };

  if (now - row.createdAt > PHONE_CHANGE_SESSION_TTL_MS) {
    failPhoneChange(db, input.sessionId, "expired");
    return { ok: false, reason: "expired" };
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, row.startedByUserId))
    .get();
  if (!user) return { ok: false, reason: "not_found" };

  // THE STALE-SNAPSHOT GATE, and it comes before the guarded write on purpose.
  //
  // `old_phone` is half of what the holder signed over. If the number moved
  // underneath — two dialogs open — writing `new_phone` anyway would honour an
  // approval of a transition that is no longer the one happening. Refusing
  // BEFORE the write leaves the session claimable, so the holder's approval is
  // not burned for nothing: if whatever moved the number is undone, this same
  // session still applies.
  //
  // Exact string equality, NOT `isSamePhoneNumber`: the snapshot and the
  // column are the same stored string, and a digits-only comparison here would
  // let a reformat of the same number pass as "unmoved" while the holder had
  // approved a transition from the old formatting.
  if (user.phoneNumber !== row.oldPhone) {
    return { ok: false, reason: "phone_changed" };
  }

  // ONE TRANSACTION over both writes, as `processPayment` already does for the
  // debit and its proof package. Without it, a throw between them (SQLITE_BUSY,
  // a full disk) leaves the session `applied` with the number UNWRITTEN — and
  // the retry then answers 410, which the dialog shows as a generic failure.
  // The holder would be told their change did not happen, correctly, and have
  // no way to make it happen.
  try {
    return applyWithin(db, input.sessionId, row);
  } catch (error) {
    // The CAS below rolled the transaction back: another connection moved the
    // number between the read above and the write. Same answer as the
    // pre-check, and the session is still claimable because the rollback
    // un-consumed it.
    if (error instanceof StaleSnapshotError) {
      return { ok: false, reason: "phone_changed" };
    }
    throw error;
  }
}

/**
 * `applyPhoneChange`'s two writes, in one transaction.
 *
 * Separated only so the `StaleSnapshotError` catch above reads as a decision
 * rather than as plumbing wrapped around twenty lines.
 */
function applyWithin(
  db: Db,
  sessionId: string,
  row: PhoneChangeSession,
): ApplyPhoneChangeResult {
  return db.transaction((tx) => {
    // A GUARDED WRITE, not a read-then-write. `.changes` is what decides
    // whether THIS call won the race to consume the session; checking the
    // state above and then updating unconditionally would let two concurrent
    // applies both proceed, and the second would write against a snapshot the
    // first had already invalidated.
    const consumed = tx
      .update(phoneChangeSessions)
      .set({ state: "applied" })
      .where(
        and(
          eq(phoneChangeSessions.id, sessionId),
          eq(phoneChangeSessions.state, "verified"),
        ),
      )
      .run();
    if (consumed.changes !== 1) {
      return { ok: false, reason: "already_applied" } as ApplyPhoneChangeResult;
    }

    // Compare-and-swap on the snapshot as well, so the stale-snapshot refusal
    // above holds even if another connection moved the number between that
    // read and this write. `.changes` of 0 rolls the whole transaction back by
    // throwing, leaving the session claimable rather than
    // consumed-and-unapplied.
    //
    // UNTESTED, and honestly so: within one process better-sqlite3 is
    // synchronous and nothing can interleave between the read above and this
    // write, so this branch is unreachable from any test in this suite. It is
    // defence for the deployment shape nobody checks before introducing, not
    // for the one that exists. What IS tested is the property it serves — that
    // a failure of this second write takes the first one with it.
    const written = tx
      .update(users)
      .set({ phoneNumber: row.newPhone })
      .where(
        and(
          eq(users.id, row.startedByUserId),
          eq(users.phoneNumber, row.oldPhone),
        ),
      )
      .run();
    if (written.changes !== 1) throw new StaleSnapshotError();

    return { ok: true, phoneNumber: row.newPhone } as ApplyPhoneChangeResult;
  });
}

export type RelayPhoneChangeResult =
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
 * running in the dialog reads — one state path, not two. Writing the number
 * here instead would give same-device and cross-device changes two different
 * routes to a write, and they would drift.
 */
export async function relayPhoneChangeDcApiResponse(
  db: Db,
  client: FoundryClient,
  input: { userId: string; sessionId: string; response: string },
): Promise<RelayPhoneChangeResult> {
  const row = loadSession(db, input.userId, input.sessionId);
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

export interface PhoneChangeStatusDto {
  state: PhoneChangeSessionState;
  failureReason?: string;
  /**
   * Carried on the STATUS, not only on the start DTO. By the time the dialog
   * renders success the only thing it still holds is a session id, and the
   * success line names the number.
   */
  newPhone: string;
}

export type RefreshPhoneChangeResult =
  | { ok: true; status: PhoneChangeStatusDto }
  | { ok: false; reason: "not_found" };

/** A plain lookup. No foundry traffic — `refreshPhoneChangeState` does that. */
export function getPhoneChangeStatus(
  db: Db,
  userId: string,
  sessionId: string,
): PhoneChangeStatusDto | null {
  const row = loadSession(db, userId, sessionId);
  if (!row) return null;

  return {
    state: row.state,
    failureReason: row.failureReason ?? undefined,
    newPhone: row.newPhone,
  };
}

/**
 * Polled by the browser roughly every 2s. Drives `pending → verified | failed`
 * and NOTHING else — writing the number is `applyPhoneChange`'s job, on a
 * POST, because a GET with a side effect gets fired twice by a prefetch or a
 * double-poll and here the side effect writes to a customer's row.
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
 * **(4) IS THE GATE THIS FLOW ADDS OVER WALLET LOGIN, AND IT LIVES HERE RATHER
 * THAN IN APPLY.** Login resolves a `sub` to whoever owns that credential —
 * that is the point, nobody is signed in yet. Here somebody is, and without
 * this check any valid Sparkassen Authenticator presentation could change any
 * signed-in customer's number. Putting it in apply instead would need a second
 * `getVerificationStatus` after the session had gone terminal and, worse,
 * would let a stranger's valid presentation drive the session to `verified` —
 * showing the holder a success-shaped dialog that apply then rejects.
 * `verified` must mean *the right person approved*, or the state name is a lie.
 *
 * (3) sits between READING the `sub` and RESOLVING it, deliberately, for the
 * reason `login-sessions.ts` documents: reading a claim out of a JSON blob is
 * inert; turning it into a customer is the act, and an unbound presentation
 * must never reach that point. The distinction is only observable in which
 * `failure_reason` a verdict gets when it is both unbound and carries a `sub`
 * nothing matches — one test pins exactly that input.
 */
export async function refreshPhoneChangeState(
  db: Db,
  foundry: FoundryClient,
  input: { userId: string; sessionId: string },
  now: number = Date.now(),
): Promise<RefreshPhoneChangeResult> {
  const row = loadSession(db, input.userId, input.sessionId);
  if (!row) return { ok: false, reason: "not_found" };

  const done = (): RefreshPhoneChangeResult => ({
    ok: true,
    status: getPhoneChangeStatus(db, input.userId, input.sessionId)!,
  });

  // Terminal: nothing left to learn.
  if (row.state === "applied" || row.state === "failed") return done();

  // Expiry BEFORE the foundry call, so an abandoned tab stops costing traffic.
  // `expired` is a failure reason, not a fifth state.
  if (now - row.createdAt > PHONE_CHANGE_SESSION_TTL_MS) {
    failPhoneChange(db, input.sessionId, "expired");
    return done();
  }

  // Approved and waiting for the apply. Re-polling foundry would tell us
  // nothing we have not already recorded.
  if (row.state === "verified") return done();

  if (!row.foundryVerificationId) {
    failPhoneChange(db, input.sessionId, "verification_failed");
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
    failPhoneChange(db, input.sessionId, "verification_failed");
    return done();
  }

  const subject = extractAuthSubject(verdict.result.credentials);
  if (!subject) {
    // Either no credential answered the authenticator query, or the one that
    // did disclosed no usable `sub`. Both are the wallet's answer being wrong,
    // not the customer being unknown.
    failPhoneChange(db, input.sessionId, "verification_failed");
    return done();
  }

  if (!passedLoginBinding(verdict.result.credentials)) {
    // A wallet that ignored the `transaction_data` entry yields a verdict that
    // is `verified: true` and still worthless: nothing in it is tied to THESE
    // two numbers, so it attests an approval of a transition the holder may
    // never have seen. Its own reason, so an operator can tell this apart from
    // every other bad presentation; the holder sees the generic copy.
    failPhoneChange(db, input.sessionId, "transaction_data_binding_failed");
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
    failPhoneChange(db, input.sessionId, "unknown_credential");
    return done();
  }

  if (credential.userId !== row.startedByUserId) {
    // A stranger's valid authenticator. Its OWN reason, distinct from
    // `unknown_credential`, so an operator can tell a credential issued to the
    // wrong person from one this bank cannot place at all. The holder sees the
    // same generic copy for both — spelling this out would tell whoever holds
    // the phone that their presentation was valid but for somebody else's
    // account.
    failPhoneChange(db, input.sessionId, "wrong_customer");
    return done();
  }

  // Deliberately NOT gated on `credential.state === "active"`, for the reason
  // wallet login is not: foundry's verdict is the authority that the credential
  // is real and holder-bound; this row only answers WHOSE. Nothing here ever
  // clears an `offered` row.
  db.update(phoneChangeSessions)
    .set({ state: "verified", approvedByUserId: credential.userId })
    .where(eq(phoneChangeSessions.id, input.sessionId))
    .run();

  return done();
}