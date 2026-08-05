import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
 * A digital credential instance derived from a card. One card may yield several
 * rows over time (re-issue after expiry); there is no `revoked` state (spec 2).
 */
export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  cardId: text("card_id")
    .notNull()
    .references(() => cards.id),
  /** The opaque value carried in the DPC credential — the loop's join key. */
  credentialId: text("credential_id").notNull().unique(),
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