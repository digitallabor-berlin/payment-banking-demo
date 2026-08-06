import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { orders, paymentSessions, type PaymentSessionState } from "../db/schema.js";
import { buildDcqlQuery, buildTransactionData } from "./dcql.js";

export type StartPaymentSessionResult =
  | { ok: true; sessionId: string; uri: string }
  | { ok: false; reason: "order_not_found" | "order_not_pending" | "foundry_unavailable" };

export interface PaymentSessionStatusDto {
  state: PaymentSessionState;
  checks?: unknown;
  failureReason?: string;
}

/**
 * Spec §6.2 steps 2–4. The session row is written BEFORE foundry is called, so
 * a failed verification-request creation leaves a visible `failed` row
 * rather than nothing at all — the same property Plan 1's bank issuance flow
 * relies on.
 */
export async function startPaymentSession(
  db: Db,
  client: FoundryClient,
  orderId: string,
  merchantName: string,
  now: number = Date.now(),
): Promise<StartPaymentSessionResult> {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return { ok: false, reason: "order_not_found" };
  if (order.status !== "pending") return { ok: false, reason: "order_not_pending" };

  const sessionId = `sess_${randomUUID()}`;

  db.insert(paymentSessions)
    .values({ id: sessionId, orderId: order.id, state: "pending", createdAt: now })
    .run();

  try {
    const response = await client.createVerificationRequest({
      transport: "request_uri",
      dcql_query: buildDcqlQuery(),
      transaction_data: buildTransactionData(order.id, order.totalCents, merchantName),
    });

    const uri = response.openid4vp_uri ?? response.request_uri ?? "";

    db.update(paymentSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();

    return { ok: true, sessionId, uri };
  } catch {
    db.update(paymentSessions)
      .set({ state: "failed", failureReason: "foundry_unavailable" })
      .where(eq(paymentSessions.id, sessionId))
      .run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/**
 * A plain lookup, no foundry traffic. Task 8 wraps this with a
 * `refreshPaymentSessionState` that polls foundry and drives the settle gate;
 * this function stays the single place both read the DB row from.
 */
export function getPaymentSessionStatus(db: Db, sessionId: string): PaymentSessionStatusDto | null {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return null;

  return {
    state: row.state,
    checks: row.checksJson ? JSON.parse(row.checksJson) : undefined,
    failureReason: row.failureReason ?? undefined,
  };
}