import {
 integer,
 sqliteTable,
 text,
 uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
 id: text("id").primaryKey(),
 username: text("username").notNull().unique(),
 passwordHash: text("password_hash").notNull(),
 displayName: text("display_name").notNull(),
});

export const accounts = sqliteTable("accounts", {
 id: text("id").primaryKey(),
 userId: text("user_id")
  .notNull()
  .references(() => users.id),
 iban: text("iban").notNull(),
 currency: text("currency").notNull().default("EUR"),
 balanceCents: integer("balance_cents").notNull(),
});

export const cards = sqliteTable("cards", {
 id: text("id").primaryKey(),
 userId: text("user_id")
  .notNull()
  .references(() => users.id),
 accountId: text("account_id")
  .notNull()
  .references(() => accounts.id),
 panLast4: text("pan_last4").notNull(),
 network: text("network").notNull(),
 cardAlias: text("card_alias").notNull(),
 createdAt: integer("created_at").notNull(),
});

/**
 * A digital credential instance issued into the user's wallet. One card may
 * yield several rows over time (re-issue after expiry); there is no `revoked`
 * state (spec 2). Not every credential has a card behind it — the age
 * attestation is issued to the person.
 */
export const credentials = sqliteTable("credentials", {
 id: text("id").primaryKey(),
 userId: text("user_id")
  .notNull()
  .references(() => users.id),
 /** NULL for a credential with no payment instrument behind it. */
 cardId: text("card_id").references(() => cards.id),
 /**
  * Which credential type foundry issued. Defaulted to the payment credential
  * because that is the only thing this bank issued before age verification
  * existed, which also makes the 0001 migration's backfill automatic. An
  * insert that means something else must say so: `startAvIssuance` does.
  *
  * `av` is no longer legacy: it once was the age credential's only spelling,
  * then nothing issued it, and it is now that credential's Google Wallet
  * format. Widening this list is free — the column is plain `text` and the
  * 0001 migration emits no CHECK constraint, so the enum is a TypeScript claim
  * about the data, not a database one. `wero` was added on exactly those
  * terms, with no migration, and `sparkassen_auth` after it.
  */
 credentialTypeId: text("credential_type_id", {
  enum: [
   "com.emvco.dpc.card",
   "sparkassencard",
   "wero",
   "sparkassen_auth",
   "av",
   "av-sparkasse",
  ],
 })
  .notNull()
  .default("com.emvco.dpc.card"),
 /**
  * The opaque value a payment credential carries — the loop's join key with
  * the merchant. The DPC spells it `credential_id`; `sparkassencard` has no
  * such claim and spells the same role `psu_id`. Both land here, so
  * `processPayment` has one lookup rather than one per format.
  *
  * NULL for an age credential, which has no payment join key and discloses no
  * identifier at all. SQLite treats NULLs as distinct under a UNIQUE index, so
  * the uniqueness invariant is untouched, and `processPayment`'s
  * `credential_id = ?` lookup can never match a NULL row.
  */
 credentialId: text("credential_id").unique(),
 foundryTxId: text("foundry_tx_id"),
 state: text("state", { enum: ["offered", "active", "failed"] }).notNull(),
 issuedAt: integer("issued_at"),
 createdAt: integer("created_at").notNull(),
});

export const transactions = sqliteTable(
 "transactions",
 {
  id: text("id").primaryKey(),
  accountId: text("account_id")
   .notNull()
   .references(() => accounts.id),
  /** Negative for a debit, positive for a credit. Always integer cents. */
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("EUR"),
  counterparty: text("counterparty").notNull(),
  reference: text("reference").notNull(),
  bookedAt: integer("booked_at").notNull(),
  /** Set when a wallet presentation authorized this transaction. */
  credentialId: text("credential_id"),
  /** Merchant payment-session id; makes POST /api/payments idempotent. */
  idempotencyKey: text("idempotency_key"),
 },
 (table) => [
  uniqueIndex("transactions_idempotency_key_unique").on(table.idempotencyKey),
 ],
);

/**
 * The PaSO Proof/Verify §4.1 proof package the merchant forwarded with a debit.
 *
 * A separate table rather than two more columns on `transactions`, because a
 * `vp_token` is kilobytes and `listTransactions` reads a page of twenty rows on
 * every dashboard render. The ledger query must not pay for an artefact only a
 * dialog reads.
 *
 * The primary key IS the transaction id: at most one package per transaction,
 * enforced by the database rather than by a convention in `processPayment`. A
 * replayed debit short-circuits before it can write a second one, and if that
 * ever changed the constraint would say so loudly.
 *
 * The bank STORES this and does not verify it (design D4). None of PaSO §3's
 * checks are run here — no signature verification, no `request_integrity`, no
 * `jti` replay cache — and no UI copy may imply otherwise.
 */
export const transactionProofs = sqliteTable("transaction_proofs", {
 transactionId: text("transaction_id")
  .primaryKey()
  .references(() => transactions.id),
 /** The signed Authorization Request, compact JWS, verbatim. */
 signedRequest: text("signed_request").notNull(),
 /** `JSON.stringify` of the `vp_token` exactly as the wallet produced it. */
 vpTokenJson: text("vp_token_json").notNull(),
 receivedAt: integer("received_at").notNull(),
});

/**
 * One row per wallet-login attempt.
 *
 * `state` is a superset of foundry's own verification state, for the reason
 * the merchant's `payment_sessions` is: foundry knows pending/verified/failed
 * and cannot know WHOSE login this resolved to, nor whether a cookie has
 * already been minted from it.
 *
 * `consumed` is a distinct state from `verified` rather than a boolean beside
 * it, exactly as the merchant splits `verified` from `settling`: collapsing
 * them makes "the credential checked out" indistinguishable from "someone
 * already got a session out of this", and that distinction is the whole of
 * what makes a login session single-use.
 *
 * There is no `expired` state. Expiry is a FAILURE REASON on `failed`,
 * computed from `created_at` at read time — nothing in this project runs a
 * background sweep, so a fifth state would be one nothing could ever write.
 */
export const loginSessions = sqliteTable("login_sessions", {
 id: text("id").primaryKey(),
 foundryVerificationId: text("foundry_verification_id"),
 state: text("state", {
  enum: ["pending", "verified", "consumed", "failed"],
 })
  .notNull()
  .default("pending"),
 openid4vpUri: text("openid4vp_uri"),
 requestUri: text("request_uri"),
 /**
  * Recorded rather than inferred: `openid4vp_uri IS NULL` is ambiguous
  * between a dc_api session and a foundry failure.
  *
  * `dc_api_signed` is the signed-Request-Object form of the DC API
  * (OpenID4VP 1.0 §A.2) and is the DEFAULT for a browser that supports the
  * API; `dc_api` is the unsigned form, reachable only via `?dcapi=unsigned`.
  * The two are separate values rather than one plus a flag because they carry
  * different `dc_api_request_json` shapes.
  *
  * Widening this list needed NO migration: the column has no CHECK constraint
  * (`0002_gorgeous_natasha_romanoff.sql` is plain `text DEFAULT 'request_uri'
  * NOT NULL`), so the `enum:` here is a TypeScript claim about the data, not a
  * database one.
  *
  * On a row that reached foundry this holds the transport foundry ACTUALLY
  * served, which is not always the one asked for — see `startLoginSession`. On
  * a `failed` row it holds what was attempted.
  */
 transport: text("transport", {
  enum: ["request_uri", "dc_api", "dc_api_signed"],
 })
  .notNull()
  .default("request_uri"),
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
 /**
  * Resolved by the gate when the state becomes `verified`; NULL before.
  * `displayName` is deliberately NOT stored beside it — the claim re-reads
  * it from `users`, so a name edited mid-flow cannot be served stale.
  */
 userId: text("user_id").references(() => users.id),
 failureReason: text("failure_reason"),
 createdAt: integer("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type TransactionProof = typeof transactionProofs.$inferSelect;
export type CredentialState = Credential["state"];
export type LoginSession = typeof loginSessions.$inferSelect;
export type LoginSessionState = LoginSession["state"];
