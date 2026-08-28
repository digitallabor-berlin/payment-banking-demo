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
 * is presented with the `payment_av` named query rather than `payment`, and that
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
  *
  * `dc_api_signed` is the signed-Request-Object form of the DC API
  * (OpenID4VP 1.0 §A.2) and is the DEFAULT for a browser that supports the
  * API; `dc_api` is the unsigned form, reachable only via `?dcapi=unsigned`.
  * The two are separate values rather than one plus a flag because they carry
  * different `dc_api_request_json` shapes.
  *
  * Widening this list needed NO migration: the column has no CHECK constraint
  * (`0002_funny_legion.sql` is plain `text DEFAULT 'request_uri' NOT NULL`), so
  * the `enum:` here is a TypeScript claim about the data, not a database one.
  *
  * What is written here is the transport foundry ACTUALLY served, not the one
  * that was asked for — see `startPaymentSession`.
  */
 transport: text("transport", {
  enum: ["request_uri", "dc_api", "dc_api_signed"],
 })
  .notNull()
  .default("request_uri"),
 /**
  * Which foundry named query this session asked for — `payment` for an
  * ordinary basket, `payment_av` when the order contains an age-restricted
  * product. Both accept either payment credential format; `payment_av` adds a
  * required proof of age in either of its two formats.
  *
  * Recorded rather than recomputed, for the same reason `transport` is: the
  * settle gate has to know whether an age attestation was actually *requested*
  * before it can treat a missing one as a failure, and re-deriving it from the
  * order at poll time would silently change the verdict if the restricted set
  * were edited mid-session.
  *
  * The column has NO CHECK constraint (`0003_violet_red_skull.sql` is plain
  * `text`), so renaming these values from the older `dpc`/`dpc_av` needed no
  * migration — the `enum:` here is a TypeScript claim about the data, not a
  * database one. Two consequences, both accepted deliberately: the on-disk
  * DEFAULT is still `'dpc'`, which is dead weight because every insert writes
  * this column explicitly (see `startPaymentSession`); and a row left over from
  * a pre-rename session still holds `dpc_av`, which now reads as a session that
  * never asked for an age attestation. No such row can settle anyway — its
  * stored verdict answers the retired `av` query id, which `extractCredentialId`
  * and `passedAgeVerification` both refuse.
  */
 namedQueryRef: text("named_query_ref", { enum: ["payment", "payment_av"] })
  .notNull()
  .default("payment"),
 /**
  * foundry's inline request object, verbatim. Only for a DC API transport: a
  * bare parameter object under `dc_api`, the single-member
  * `{ request: "<compact JWS>" }` wrapper under `dc_api_signed`.
  */
 dcApiRequestJson: text("dc_api_request_json"),
 /**
  * The DC API exchange protocol identifier foundry returned alongside
  * `dc_api_request_json` (`openid4vp-v1-signed` / `openid4vp-v1-unsigned`),
  * stored verbatim and replayed verbatim into the browser's DC API call.
  *
  * Persisted rather than derived from `transport` on purpose. The identifier
  * and the request-object shape are two halves of one wire contract and
  * foundry decides the shape, so re-deriving one from our own request is
  * exactly how a signed payload ends up under the unsigned identifier — a
  * failure that happens inside the wallet with no server-side trace. NULL for
  * `request_uri`, which performs no DC API invocation.
  */
 dcApiProtocol: text("dc_api_protocol"),
 /** foundry's verdict, stored verbatim so the success screen can show it. */
 disclosedClaimsJson: text("disclosed_claims_json"),
 checksJson: text("checks_json"),
 bankTxId: text("bank_tx_id"),
 failureReason: text("failure_reason"),
 createdAt: integer("created_at").notNull(),
});

/**
 * Verification events delivered by foundry's artifact webhook.
 *
 * An INBOX rather than columns on `payment_sessions`, for three reasons
 * (design D7):
 *
 * 1. `presentation_request_delivered` is dispatched INSIDE foundry's
 *    `create_verification_request`, so it can reach us before
 *    `startPaymentSession` has written `foundry_verification_id` onto the
 *    session row. A direct write would have nothing to write to.
 * 2. That event fires per DELIVERY, not per transaction — on `request_uri` it
 *    fires for every `GET /vp/request/:id`, and ECDSA signing is randomized, so
 *    each copy is genuinely different bytes. Rows accumulate; the reader picks.
 * 3. The grace period in `refreshPaymentSessionState` needs something to poll.
 *
 * Deliberately no unique constraint on `tx_id` — see reason 2. No foreign key
 * to `payment_sessions` either: reason 1 means the session row may not carry
 * that id yet, and a `presentation_request_delivered` for the BANK's wallet
 * login is stored too (it is a request object, not holder data).
 */
export const verifierEvents = sqliteTable("verifier_events", {
 id: integer("id").primaryKey({ autoIncrement: true }),
 /** foundry's `verification_id`. */
 txId: text("tx_id").notNull(),
 event: text("event", {
  enum: ["presentation_request_delivered", "verification_completed"],
 }).notNull(),
 /** From the request event only. NULL on a completion. */
 transport: text("transport"),
 /**
  * foundry's `request_object_jws` — the PaSO `signed_request`. NULL when
  * foundry's `verifier.webhook.include_raw_artifacts` is off, which is its
  * default: the event still fires, it just carries no artefact.
  */
 signedRequest: text("signed_request"),
 /** `JSON.stringify(vp_token)`. NULL for the same reason as above. */
 vpTokenJson: text("vp_token_json"),
 receivedAt: integer("received_at").notNull(),
});

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type NamedQueryRef = PaymentSession["namedQueryRef"];
export type PaymentSession = typeof paymentSessions.$inferSelect;
export type OrderStatus = Order["status"];
export type PaymentSessionState = PaymentSession["state"];
export type VerifierEventRow = typeof verifierEvents.$inferSelect;
