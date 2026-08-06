import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orders, products } from "../db/schema.js";

export interface OrderItemInput {
  productId: string;
  quantity: number;
}

export interface CustomerInput {
  name: string;
  email: string;
}

export type CreateOrderResult =
  | { ok: true; orderId: string; totalCents: number }
  | { ok: false; reason: "empty_cart" | "unknown_product" };

/**
 * Recomputes the total from this app's own `products` rows — the caller's
 * `OrderItemInput` cannot carry a price at all, so there is nothing client-
 * supplied to accidentally trust (spec §6.2: "the merchant never trusts the
 * browser about money").
 */
export function createOrder(
  db: Db,
  items: OrderItemInput[],
  customer: CustomerInput,
  now: number = Date.now(),
): CreateOrderResult {
  if (items.length === 0) return { ok: false, reason: "empty_cart" };

  let totalCents = 0;
  for (const item of items) {
    const product = db.select().from(products).where(eq(products.id, item.productId)).get();
    if (!product) return { ok: false, reason: "unknown_product" };
    totalCents += product.priceCents * item.quantity;
  }

  const orderId = `ord_${randomUUID()}`;
  db.insert(orders)
    .values({
      id: orderId,
      totalCents,
      currency: "EUR",
      customerName: customer.name,
      customerEmail: customer.email,
      status: "pending",
      createdAt: now,
    })
    .run();

  return { ok: true, orderId, totalCents };
}