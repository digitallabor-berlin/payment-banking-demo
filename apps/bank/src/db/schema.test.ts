import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { accounts, cards, credentials, transactions, users } from "./schema.js";
import { seed } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-db-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seed", () => {
  it("creates exactly two users with accounts and cards", () => {
    seed(db);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(cards).all()).toHaveLength(2);
  });

  it("creates ten historical transactions per account, none wallet-paid", () => {
    seed(db);
    const rows = db.select().from(transactions).all();
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.credentialId === null)).toBe(true);
    expect(rows.every((row) => row.idempotencyKey === null)).toBe(true);
  });

  it("issues no credentials, so cards start out not in the wallet", () => {
    seed(db);
    expect(db.select().from(credentials).all()).toHaveLength(0);
  });

  it("is idempotent — running twice leaves the same row counts", () => {
    seed(db);
    seed(db);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(20);
  });

  it("gives each account a positive balance in whole cents", () => {
    seed(db);
    for (const account of db.select().from(accounts).all()) {
      expect(account.balanceCents).toBeGreaterThan(0);
      expect(Number.isInteger(account.balanceCents)).toBe(true);
    }
  });

  it("links every card to an account owned by the same user", () => {
    seed(db);
    for (const card of db.select().from(cards).all()) {
      const account = db
        .select()
        .from(accounts)
        .where(eq(accounts.id, card.accountId))
        .get();
      expect(account?.userId).toBe(card.userId);
    }
  });
});

describe("transactions.idempotency_key", () => {
  it("rejects a duplicate non-null key", () => {
    seed(db);
    const account = db.select().from(accounts).all()[0];
    expect(account).toBeDefined();

    const row = {
      accountId: account!.id,
      amountCents: -100,
      currency: "EUR",
      counterparty: "Demo Shop",
      reference: "Order #1",
      bookedAt: 1,
      credentialId: "dpc_x",
      idempotencyKey: "sess_1",
    };

    db.insert(transactions)
      .values({ id: "t_1", ...row })
      .run();
    expect(() =>
      db
        .insert(transactions)
        .values({ id: "t_2", ...row })
        .run(),
    ).toThrowError(/UNIQUE/i);
  });

  it("allows many null keys, so seeded history is unconstrained", () => {
    seed(db);
    const account = db.select().from(accounts).all()[0];
    db.insert(transactions)
      .values({
        id: "t_null_1",
        accountId: account!.id,
        amountCents: -1,
        currency: "EUR",
        counterparty: "x",
        reference: "y",
        bookedAt: 1,
      })
      .run();
    expect(db.select().from(transactions).all()).toHaveLength(21);
  });
});

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/** The project's migration tags, in the order drizzle's journal applies them. */
function migrationTags(): string[] {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS_FOLDER, "meta", "_journal.json"), "utf8"),
  ) as { entries: { tag: string }[] };
  return journal.entries.map((entry) => entry.tag);
}

/**
 * Applies exactly the named migrations to a raw better-sqlite3 handle.
 *
 * Takes an explicit tag list rather than an "all" / "all but the last" flag so
 * a test can stop, write a row, and then apply only what remains — re-running
 * an already-applied migration fails on `table accounts already exists`.
 *
 * Drizzle separates statements with `--> statement-breakpoint`, which
 * better-sqlite3's exec() does not understand, so they are split and run
 * individually.
 */
function applyMigrations(sqlite: Database.Database, tags: string[]): void {
  for (const tag of tags) {
    const file = readFileSync(
      path.join(MIGRATIONS_FOLDER, `${tag}.sql`),
      "utf8",
    );
    for (const statement of file.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) sqlite.exec(trimmed);
    }
  }
}

describe("credentials shape", () => {
  it("carries an existing row through the newest migration, defaulting its type", () => {
    // The point of this test: 0001 relaxes two NOT NULLs, which SQLite can only
    // do by rebuilding the table. A rebuild that drops rows, or that leaves
    // credential_type_id empty, would be silent.
    const sqlite = new Database(path.join(dir, "migrate.db"));
    const tags = migrationTags();
    expect(tags.length).toBeGreaterThan(1);
    applyMigrations(sqlite, tags.slice(0, -1));

    sqlite.exec(`
      INSERT INTO users (id, username, password_hash, display_name)
        VALUES ('u1', 'u1', 'h', 'U One');
      INSERT INTO accounts (id, user_id, iban, currency, balance_cents)
        VALUES ('a1', 'u1', 'DE02120300000000202051', 'EUR', 1000);
      INSERT INTO cards (id, user_id, account_id, pan_last4, network, card_alias, created_at)
        VALUES ('c1', 'u1', 'a1', '4242', 'girocard', 'girocard', 1);
      INSERT INTO credentials (id, user_id, card_id, credential_id, foundry_tx_id, state, issued_at, created_at)
        VALUES ('cr1', 'u1', 'c1', 'dpc_legacy_1', 'tx1', 'active', 2, 1);
    `);

    applyMigrations(sqlite, tags.slice(-1));

    const row = sqlite
      .prepare(`SELECT * FROM credentials WHERE id = 'cr1'`)
      .get() as Record<string, unknown>;
    expect(row.credential_id).toBe("dpc_legacy_1");
    expect(row.state).toBe("active");
    expect(row.credential_type_id).toBe("com.emvco.dpc.card");
    sqlite.close();
  });

  it("defaults credentialTypeId to the payment credential", () => {
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_default",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_default_1",
        state: "offered",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_default"))
      .get();
    expect(row?.credentialTypeId).toBe("com.emvco.dpc.card");
  });

  it("accepts an age credential with no card and no credential id", () => {
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_av",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av-sparkasse",
        credentialId: null,
        state: "offered",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_av"))
      .get();
    expect(row?.cardId).toBeNull();
    expect(row?.credentialId).toBeNull();
    expect(row?.credentialTypeId).toBe("av-sparkasse");
  });

  it("accepts a Wero credential with a card and a join key", () => {
    // Wero is payable, so unlike the age credential it carries both: the card
    // `processPayment` debits and the join key it is looked up by. The column is
    // plain `text` with no CHECK, so widening the drizzle enum was the whole of
    // what this row needed — no migration.
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_wero",
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "wero",
        credentialId: "11111111-2222-3333-4444-555555555555",
        state: "active",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_wero"))
      .get();
    expect(row?.credentialTypeId).toBe("wero");
    expect(row?.cardId).toBe("card_anna");
    expect(row?.credentialId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("accepts a Sparkassen Authenticator credential with no card and no credential id", () => {
    // The authenticator takes the age credential's shape rather than Wero's: it
    // attests something about the person, so there is no card to debit and no
    // join key for a merchant to present. Widening the drizzle enum was again
    // the whole of what this row needed — the column is plain `text` with no
    // CHECK constraint, so no migration.
    seed(db);
    db.insert(credentials)
      .values({
        id: "cred_auth",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "sparkassen_auth",
        credentialId: null,
        state: "offered",
        createdAt: 1,
      })
      .run();
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, "cred_auth"))
      .get();
    expect(row?.credentialTypeId).toBe("sparkassen_auth");
    expect(row?.cardId).toBeNull();
    expect(row?.credentialId).toBeNull();
  });

  it("permits several rows with a null credential id", () => {
    // SQLite treats NULLs as distinct under a UNIQUE index. Two age credentials
    // must coexist even though neither has a join key.
    seed(db);
    for (const id of ["cred_av_1", "cred_av_2"]) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: null,
          credentialTypeId: "av-sparkasse",
          credentialId: null,
          state: "offered",
          createdAt: 1,
        })
        .run();
    }
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });

  it("still rejects a duplicate credential id", () => {
    seed(db);
    const insert = (id: string) =>
      db
        .insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: "dpc_dupe",
          state: "offered",
          createdAt: 1,
        })
        .run();
    insert("cred_a");
    expect(() => insert("cred_b")).toThrow();
  });
});
