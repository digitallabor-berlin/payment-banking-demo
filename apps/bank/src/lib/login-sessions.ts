import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { loginSessions, type LoginSessionState } from "../db/schema.js";
import { SPARKASSEN_AUTH_NAMED_QUERY } from "./credential-types.js";

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

/** Terminal-with-a-reason. `expired` is a reason here, never a state. */
function failLogin(db: Db, sessionId: string, reason: string): void {
  db.update(loginSessions)
    .set({ state: "failed", failureReason: reason })
    .where(eq(loginSessions.id, sessionId))
    .run();
}