import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orderItems, products } from "../db/schema.js";
import { isAgeRestricted } from "./dcql.js";

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  /** What the customer was charged per unit, snapshotted at order time. */
  unitPriceCents: number;
  lineTotalCents: number;
  ageRestricted: boolean;
}

/**
 * The composition of an order, for display.
 *
 * Exists so `/pay/[sessionId]` has real content to render behind the payment
 * sheet. That route has no localStorage cart — it may be a deep link, a reload,
 * or a shared URL — and a scrim over a blank page is what made the sheet read as
 * a modal over nothing.
 *
 * `lineTotalCents` multiplies the SNAPSHOTTED `unitPriceCents`, never the live
 * `products.price_cents`: `orders.ts` records the snapshot precisely so a later
 * price change cannot rewrite what someone was charged. Only the display name
 * comes from the live product row.
 *
 * Returns `[]` for an unknown order rather than throwing — the caller resolves
 * the order first, and an empty basket renders as an empty list.
 */
export function listOrderLines(db: Db, orderId: string): OrderLine[] {
  return db
    .select({
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      name: products.name,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .all()
    .map((row) => ({
      productId: row.productId,
      name: row.name,
      quantity: row.quantity,
      unitPriceCents: row.unitPriceCents,
      lineTotalCents: row.unitPriceCents * row.quantity,
      ageRestricted: isAgeRestricted(row.productId),
    }));
}