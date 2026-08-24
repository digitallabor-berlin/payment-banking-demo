import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import {
  credentials,
  loginSessions,
  type LoginSessionState,
} from "../db/schema.js";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_NAMED_QUERY,
} from "./credential-types.js";
import { extractAuthSubject } from "./login-checks.js";

/**
 * How long a login session may be claimed for.
 *
 * Short on purpose: every route that touches a login session is necessarily
 * unauthenticated, so the session id is a bearer token — whoever holds a
 * verified one can take the cookie. Five minutes is long enough for a human to
 * find their phone and short enough that a leaked id is usually already dead.
 */
export const LOGIN_SESSION_TTL_MS = 5 * 60 * 1000;

export type StartLoginSessionResult =
  | {
      ok: true;
      sessionId: string;
      /** Null under dc_api — foundry inlines the request object instead. */
      uri: string | null;
      transport: "request_uri" | "dc_api";
      /** foundry's inline unsigned request object. Null under request_uri. */
      dcApiRequest: unknown;
      state: "pending";
    }
  | { ok: false; reason: "foundry_unavailable" };

export interface LoginSessionStatusDto {
  state: LoginSessionState;
  failureReason?: string;
}

/**
 * Opens a wallet-login presentation.
 *
 * The row is written BEFORE foundry is called, so a refused request leaves a
 * visible `failed` row rather than nothing at all — the property
 * `startIssuance` and the merchant's `startPaymentSession` both rely on. That
 * matters more here than usual: no local foundry declares the
 * `sparkassen_auth` named query, so a local run takes this path every time.
 *
 * Sends `named_query_ref` and nothing else. No `dcql_query`, because foundry
 * prefers an inline query and would silently ignore the named one; and no
 * `transaction_data`, because that binds an AMOUNT to a presentation and a
 * login has none.
 */
export async function startLoginSession(
  db: Db,
  client: FoundryClient,
  useDcApi: boolean,
  now: number = Date.now(),
): Promise<StartLoginSessionResult> {
  const sessionId = `login_${randomUUID()}`;
  const transport = useDcApi ? "dc_api" : "request_uri";

  db.insert(loginSessions)
    .values({ id: sessionId, state: "pending", transport, createdAt: now })
    .run();

  try {
    const response = await client.createVerificationRequest({
      transport,
      named_query_ref: SPARKASSEN_AUTH_NAMED_QUERY,
    });

    // Under dc_api foundry returns neither uri — the request object is inlined
    // and unsigned because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? null;
    const dcApiRequest = response.dc_api_request ?? null;

    db.update(loginSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        dcApiRequestJson:
          dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
      })
      .where(eq(loginSessions.id, sessionId))
      .run();

    return {
      ok: true,
      sessionId,
      uri,
      transport,
      dcApiRequest,
      state: "pending",
    };
  } catch {
    failLogin(db, sessionId, "foundry_unavailable");
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/** A plain lookup. No foundry traffic — `refreshLoginSessionState` does that. */
export function getLoginSessionStatus(
  db: Db,
  sessionId: string,
): LoginSessionStatusDto | null {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return null;

  return {
    state: row.state,
    failureReason: row.failureReason ?? undefined,
  };
}

export type RefreshLoginResult =
  | { ok: true; status: LoginSessionStatusDto }
  | { ok: false; reason: "not_found" };

/**
 * Polled by the browser roughly every 2s. Drives `pending → verified | failed`
 * and nothing else — minting the cookie is `claimLoginSession`'s job, on a
 * POST, because a GET that mints an authenticated session would be consumed by
 * any prefetch or double-poll.
 *
 * Order matters: terminal first (no traffic), then expiry (no traffic), then
 * already-verified (no traffic), and only then foundry. An abandoned session
 * therefore stops generating admin-API calls the moment its window closes.
 */
export async function refreshLoginSessionState(
  db: Db,
  foundry: FoundryClient,
  sessionId: string,
  now: number = Date.now(),
): Promise<RefreshLoginResult> {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };

  const done = (): RefreshLoginResult => ({
    ok: true,
    status: getLoginSessionStatus(db, sessionId)!,
  });

  // Terminal: nothing left to learn.
  if (row.state === "consumed" || row.state === "failed") return done();

  // Expiry BEFORE the foundry call, so an abandoned tab stops costing traffic.
  // `expired` is a failure reason, not a fifth state.
  if (now - row.createdAt > LOGIN_SESSION_TTL_MS) {
    failLogin(db, sessionId, "expired");
    return done();
  }

  // Verified and waiting to be claimed. Re-polling foundry would tell us
  // nothing we have not already recorded.
  if (row.state === "verified") return done();

  if (!row.foundryVerificationId) {
    failLogin(db, sessionId, "verification_failed");
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
    failLogin(db, sessionId, "verification_failed");
    return done();
  }

  const subject = extractAuthSubject(verdict.result.credentials);
  if (!subject) {
    // Either no credential answered the authenticator query, or the one that
    // did disclosed no usable `sub`. Both are the wallet's answer being wrong,
    // not the customer being unknown — hence verification_failed, not
    // unknown_credential.
    failLogin(db, sessionId, "verification_failed");
    return done();
  }

  // The type predicate is redundant against the UNIQUE index on
  // `credential_id` — no psu_id can equal a sub AND both be stored — but it
  // makes the read state its intent instead of relying on that.
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
    // A real, correctly-signed credential this bank cannot match to a
    // customer. Expected for anything issued before the sub was persisted.
    failLogin(db, sessionId, "unknown_credential");
    return done();
  }

  // Deliberately NOT gated on `credential.state === "active"`. foundry's
  // verdict is the authority that the credential is real, holder-bound and
  // unrevoked; this row only answers WHOSE. Nothing here ever clears an
  // `offered` row, so requiring `active` would lock a customer out of a
  // credential demonstrably in their wallet.
  db.update(loginSessions)
    .set({ state: "verified", userId: credential.userId })
    .where(eq(loginSessions.id, sessionId))
    .run();

  return done();
}

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failLogin(db: Db, sessionId: string, reason: string): void {
  db.update(loginSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(loginSessions.id, sessionId))
    .run();
}