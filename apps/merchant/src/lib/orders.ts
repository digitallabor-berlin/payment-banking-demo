import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orderItems, orders, products } from "../db/schema.js";

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
 *
 * The line items are persisted for the same reason the total is recomputed.
 * Whether a basket needs an age attestation is a fact about what was bought,
 * and the browser is not allowed to assert it any more than it is allowed to
 * assert the price. Storing the lines is what lets `startPaymentSession`
 * establish it server-side from an order id alone.
 *
 * Order and lines are written in one transaction: an order whose composition
 * cannot be read back would be presented as an ordinary `dpc` basket, which
 * for a basket containing alcohol is the failure mode that matters.
 */
export function createOrder(
  db: Db,
  items: OrderItemInput[],
  customer: CustomerInput,
  now: number = Date.now(),
): CreateOrderResult {
  if (items.length === 0) return { ok: false, reason: "empty_cart" };

  let totalCents = 0;
  const lines: {
    productId: string;
    quantity: number;
    unitPriceCents: number;
  }[] = [];

  for (const item of items) {
    const product = db
      .select()
      .from(products)
      .where(eq(products.id, item.productId))
      .get();
    if (!product) return { ok: false, reason: "unknown_product" };
    totalCents += product.priceCents * item.quantity;
    lines.push({
      productId: product.id,
      quantity: item.quantity,
      unitPriceCents: product.priceCents,
    });
  }

  const orderId = `ord_${randomUUID()}`;

  db.transaction((tx) => {
    tx.insert(orders)
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

    for (const line of lines) {
      tx.insert(orderItems)
        .values({ orderId, ...line })
        .run();
    }
  });

  return { ok: true, orderId, totalCents };
}

/**
 * The product ids on an order, in insertion order. Returns `[]` for an unknown
 * order rather than throwing: the only caller resolves the order itself first,
 * and an empty list is the same answer an order with no restricted goods gives.
 */
export function listOrderProductIds(db: Db, orderId: string): string[] {
  return db
    .select({ productId: orderItems.productId })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .all()
    .map((row) => row.productId);
}
