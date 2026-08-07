import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import { env } from "../env.js";
import type { Db } from "../db/index.js";
import { orders, paymentSessions, type PaymentSessionState } from "../db/schema.js";
import type { BankClient } from "./bank.js";
import { extractCredentialId, passedTransactionDataBinding } from "./checks.js";
import { buildDcqlQuery, buildTransactionData } from "./dcql.js";

/** The name shown on the bank statement. Same value the wallet authorized. */
const MERCHANT_REFERENCE_NAME = env.MERCHANT_NAME;

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
  useDcApi = false,
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
      transport: useDcApi ? "dc_api" : "request_uri",
      dcql_query: buildDcqlQuery(),
      transaction_data: buildTransactionData(order.id, order.totalCents, merchantName),
    });

    // Under dc_api foundry returns neither uri — the request object is inlined
    // and unsigned because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? "";

    db.update(paymentSessions)
      .set({
        foundryVerificationId: response.verification_id,
        openid4vpUri: response.openid4vp_uri ?? null,
        requestUri: response.request_uri ?? null,
        transport: useDcApi ? "dc_api" : "request_uri",
        dcApiRequestJson:
          response.dc_api_request === undefined || response.dc_api_request === null
            ? null
            : JSON.stringify(response.dc_api_request),
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

export type RefreshResult =
  | { ok: true; status: PaymentSessionStatusDto }
  | { ok: false; reason: "not_found" };

function fail(db: Db, sessionId: string, reason: string, checksJson?: string): void {
  db.update(paymentSessions)
    .set({ state: "failed", failureReason: reason, ...(checksJson ? { checksJson } : {}) })
    .where(eq(paymentSessions.id, sessionId))
    .run();
}

/**
 * Spec §6.2 steps 7–10. Polled by the browser roughly every 2s.
 *
 * Ordering is the whole point of this function: foundry's verdict is consulted
 * first, the settle gate is applied second, and only then is the bank called.
 * A session that has already reached a terminal state does no further work, so
 * polling after completion is free and cannot double-charge.
 *
 * The state chain is spec §5.2's, walked in full:
 * `pending` → `verified` (gate passed, nothing sent) → `settling` (debit may
 * be in flight) → `completed`, with `failed` reachable throughout. Collapsing
 * `verified` into `settling` would make "the wallet proved the card" and "the
 * money may already have moved" indistinguishable after a crash.
 */
export async function refreshPaymentSessionState(
  db: Db,
  foundry: FoundryClient,
  bank: BankClient,
  sessionId: string,
  _now: number = Date.now(),
): Promise<RefreshResult> {
  const row = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
  if (!row) return { ok: false, reason: "not_found" };

  // Terminal states need no further foundry or bank traffic.
  if (row.state === "completed" || row.state === "failed") {
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  let credentialId: string | null = null;

  if (row.state === "pending") {
    if (!row.foundryVerificationId) {
      fail(db, sessionId, "verification_failed");
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    let verdict;
    try {
      verdict = await foundry.getVerificationStatus(row.foundryVerificationId);
    } catch {
      // Transient: leave the session pending so a later poll can recover.
      // Only the client's consecutive-failure counter decides when to give up.
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    if (verdict.state === "pending") {
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    const checksJson = JSON.stringify(verdict.result?.checks ?? []);

    if (verdict.state === "failed" || verdict.result?.verified !== true) {
      fail(db, sessionId, "verification_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    // The gate (spec §6.2 step 8): verified === true AND binding passed.
    if (!passedTransactionDataBinding(verdict.result.checks)) {
      fail(db, sessionId, "transaction_data_binding_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    credentialId = extractCredentialId(verdict.result.claims);
    if (!credentialId) {
      fail(db, sessionId, "verification_failed", checksJson);
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }

    // 'verified' means the gate passed and nothing has been sent to the bank
    // yet. It is written as its own state, not folded into 'settling', so a
    // process that dies here is distinguishable from one that died after the
    // debit was already in flight (spec §5.2's four-state chain).
    db.update(paymentSessions)
      .set({
        state: "verified",
        checksJson,
        disclosedClaimsJson: JSON.stringify(verdict.result.claims ?? null),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();
  } else {
    // Already 'verified' or 'settling' from an earlier poll that stopped
    // between the gate and the debit — re-read the stored claims rather than
    // re-polling foundry, then retry the debit. Safe because the bank keys on
    // idempotency_key = sessionId, so a debit that did land is replayed rather
    // than repeated.
    credentialId = extractCredentialId(
      row.disclosedClaimsJson ? JSON.parse(row.disclosedClaimsJson) : null,
    );
    if (!credentialId) {
      fail(db, sessionId, "verification_failed");
      return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
    }
  }

  const order = db.select().from(orders).where(eq(orders.id, row.orderId)).get();
  if (!order) {
    fail(db, sessionId, "verification_failed");
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  // 'settling' is written immediately before the bank call and never after, so
  // the row means exactly "a debit for this session may be in flight".
  db.update(paymentSessions)
    .set({ state: "settling" })
    .where(eq(paymentSessions.id, sessionId))
    .run();

  const payment = await bank.pay({
    credentialId,
    amountCents: order.totalCents,
    currency: order.currency,
    merchant: MERCHANT_REFERENCE_NAME,
    reference: `Order ${order.id}`,
    idempotencyKey: sessionId,
  });

  if (!payment.ok) {
    // The order stays `pending` so the user can retry (spec §6.3) — only the
    // session is terminal.
    fail(db, sessionId, payment.reason);
    return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
  }

  db.update(paymentSessions)
    .set({ state: "completed", bankTxId: payment.bankTxId })
    .where(eq(paymentSessions.id, sessionId))
    .run();
  db.update(orders).set({ status: "paid" }).where(eq(orders.id, order.id)).run();

  return { ok: true, status: getPaymentSessionStatus(db, sessionId)! };
}