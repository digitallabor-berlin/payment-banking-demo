import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const products = sqliteTable("products", {
 id: text("id").primaryKey(),
 name: text("name").notNull(),
 description: text("description").notNull(),
 priceCents: integer("price_cents").notNull(),
 imageUrl: text("image_url").notNull(),
 category: text("category").notNull(),
 /** Pack size exactly as printed on the shelf ticket, e.g. "300 g", "750 ml". */
 packLabel: text("pack_label").notNull(),
 /**
  * The same quantity expressed in `baseUnit`. Exists so the unit price can be
  * computed rather than stored: EU Directive 98/6/EC requires a grocer to show
  * the price per kg / per litre alongside the selling price, and a derived
  * value cannot drift out of sync with priceCents the way a stored one can.
  */
 baseQuantity: real("base_quantity").notNull(),
 baseUnit: text("base_unit", { enum: ["kg", "l", "pc"] }).notNull(),
});

export const orders = sqliteTable("orders", {
 id: text("id").primaryKey(),
 totalCents: integer("total_cents").notNull(),
 currency: text("currency").notNull().default("EUR"),
 customerName: text("customer_name").notNull(),
 customerEmail: text("customer_email").notNull(),
 status: text("status", { enum: ["pending", "paid", "cancelled"] })
  .notNull()
  .default("pending"),
 createdAt: integer("created_at").notNull(),
});

/**
 * One row per cart line, written by `createOrder` at the moment it prices the
 * order. Exists because the *composition* of a cart, not just its total, is
 * load-bearing at payment time: an order containing an age-restricted product
 * is presented with the `dpc_av` named query rather than `dpc`, and that
 * decision is made in `startPaymentSession`, which sees only an order id.
 *
 * `unitPriceCents` is a snapshot, deliberately: it records what the customer
 * was actually charged per unit, which a later price change to `products` must
 * not rewrite. The age-restriction decision, by contrast, is NOT snapshotted —
 * it is derived from `productId` against live data every time a session starts,
 * so tightening the restricted set applies to orders already in flight.
 */
export const orderItems = sqliteTable("order_items", {
 id: integer("id").primaryKey({ autoIncrement: true }),
 orderId: text("order_id")
  .notNull()
  .references(() => orders.id),
 productId: text("product_id")
  .notNull()
  .references(() => products.id),
 quantity: integer("quantity").notNull(),
 unitPriceCents: integer("unit_price_cents").notNull(),
});

/**
 * One row per verification attempt for an order. `state` is a superset of
 * foundry's own verification state — see spec §5.2 for why this table exists
 * rather than proxying foundry directly.
 *
 * Deliberately no UNIQUE constraint on order_id: spec §6.3 requires a retry to
 * "start a fresh presentation" for the same order, so a one-to-one constraint
 * would contradict the spec's own retry semantics. The invariant that matters
 * — at most one *live* session per order — is enforced in code by
 * startPaymentSession requiring the order to still be `pending`.
 */
export const paymentSessions = sqliteTable("payment_sessions", {
 id: text("id").primaryKey(),
 orderId: text("order_id")
  .notNull()
  .references(() => orders.id),
 foundryVerificationId: text("foundry_verification_id"),
 state: text("state", {
  enum: ["pending", "verified", "settling", "completed", "failed"],
 })
  .notNull()
  .default("pending"),
 openid4vpUri: text("openid4vp_uri"),
 requestUri: text("request_uri"),
 /**
  * How this session's presentation was requested. Recorded rather than
  * inferred: `openid4vp_uri IS NULL` is ambiguous between a dc_api session
  * and a foundry failure.
  */
 transport: text("transport", { enum: ["request_uri", "dc_api"] })
  .notNull()
  .default("request_uri"),
 /**
  * Which foundry named query this session asked for — `dpc` for an ordinary
  * basket, `dpc_av` when the order contains an age-restricted product.
  *
  * Recorded rather than recomputed, for the same reason `transport` is: the
  * settle gate has to know whether an age attestation was actually *requested*
  * before it can treat a missing one as a failure, and re-deriving it from the
  * order at poll time would silently change the verdict if the restricted set
  * were edited mid-session.
  */
 namedQueryRef: text("named_query_ref", { enum: ["dpc", "dpc_av"] })
  .notNull()
  .default("dpc"),
 /** foundry's inline unsigned request object, verbatim. Only for dc_api. */
 dcApiRequestJson: text("dc_api_request_json"),
 /** foundry's verdict, stored verbatim so the success screen can show it. */
 disclosedClaimsJson: text("disclosed_claims_json"),
 checksJson: text("checks_json"),
 bankTxId: text("bank_tx_id"),
 failureReason: text("failure_reason"),
 createdAt: integer("created_at").notNull(),
});

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type NamedQueryRef = PaymentSession["namedQueryRef"];
export type PaymentSession = typeof paymentSessions.$inferSelect;
export type OrderStatus = Order["status"];
export type PaymentSessionState = PaymentSession["state"];
