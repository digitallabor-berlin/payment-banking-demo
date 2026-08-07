import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { paymentSessions } from "../db/schema.js";

export type RelayResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "no_verification" | "foundry_unavailable" };

/**
 * Relays a browser Digital Credentials API response to foundry.
 *
 * This exists because foundry's dc-api-response endpoint is ADMIN
 * authenticated: the browser cannot call it without the admin key, and the
 * admin key must never leave the server.
 *
 * foundry verifies synchronously and returns a verdict, which is deliberately
 * DISCARDED. The transaction state foundry also writes is what the poll
 * already running in PaymentScreen reads — one state path, not two.
 */
export async function relayDcApiResponse(
  db: Db,
  client: FoundryClient,
  sessionId: string,
  response: string,
): Promise<RelayResult> {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return { ok: false, reason: "not_found" };
  if (!row.foundryVerificationId) return { ok: false, reason: "no_verification" };

  try {
    await client.submitDcApiResponse(row.foundryVerificationId, response);
    return { ok: true };
  } catch {
    return { ok: false, reason: "foundry_unavailable" };
  }
}