import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
  orders,
  paymentSessions,
  type OrderStatus,
  type PaymentSessionState,
} from "../db/schema.js";

export interface CheckView {
  check: string;
  passed: boolean;
  detail?: string;
}

export interface OrderViewDto {
  id: string;
  totalCents: number;
  currency: string;
  status: OrderStatus;
  customerName: string;
  paymentState: PaymentSessionState | null;
  bankTxId: string | null;
  checks: CheckView[];
}

/**
 * foundry's verdict is stored verbatim, so it is untrusted input as far as
 * this app's types are concerned — parse defensively and drop anything that
 * does not look like a check rather than rendering junk on the success page.
 */
function parseChecks(json: string | null): CheckView[] {
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const check = (entry as { check?: unknown }).check;
    const passed = (entry as { passed?: unknown }).passed;
    if (typeof check !== "string" || typeof passed !== "boolean") return [];
    const detail = (entry as { detail?: unknown }).detail;
    return [{ check, passed, ...(typeof detail === "string" ? { detail } : {}) }];
  });
}

export function getOrderView(db: Db, orderId: string): OrderViewDto | null {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;

  // Newest session wins: a retried order has more than one.
  const session = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.orderId, orderId))
    .orderBy(desc(paymentSessions.createdAt))
    .limit(1)
    .get();

  return {
    id: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
    status: order.status,
    customerName: order.customerName,
    paymentState: session?.state ?? null,
    bankTxId: session?.bankTxId ?? null,
    checks: parseChecks(session?.checksJson ?? null),
  };
}