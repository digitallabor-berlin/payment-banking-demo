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

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type Credential = typeof credentials.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type CredentialState = Credential["state"];
