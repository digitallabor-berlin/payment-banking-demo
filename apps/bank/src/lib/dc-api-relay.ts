import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";

export type RelayResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "no_verification" | "foundry_unavailable";
    };

/**
 * Relays a browser Digital Credentials API response to foundry.
 *
 * This exists because foundry's `dc-api-response` endpoint is ADMIN
 * authenticated: the browser cannot call it without the admin key, and the
 * admin key must never leave the server.
 *
 * foundry verifies synchronously and returns a verdict, which is deliberately
 * DISCARDED. The transaction state it also writes is what the poll already
 * running in the dialog reads — one state path, not two. Minting the session
 * here instead would give same-device and cross-device logins two different
 * paths to a cookie, and they would drift.
 */
export async function relayDcApiResponse(
  db: Db,
  client: FoundryClient,
  sessionId: string,
  response: string,
): Promise<RelayResult> {
  const row = db
    .select()
    .from(loginSessions)
    .where(eq(loginSessions.id, sessionId))
    .get();
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) {
    return { ok: false, reason: "no_verification" };
  }

  try {
    await client.submitDcApiResponse(row.foundryVerificationId, response);
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}