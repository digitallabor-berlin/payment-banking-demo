import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import {
  accounts,
  cards,
  credentials,
  limitChangeSessions,
  loginSessions,
  transactionProofs,
  transferSessions,
  transactions,
  users,
} from "./schema.js";
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

describe("accounts.daily_limit_cents", () => {
  beforeEach(() => {
    db.insert(users)
      .values({
        id: "user_x",
        username: "x",
        passwordHash: "h",
        displayName: "X",
      })
      .run();
  });

  it("defaults daily_limit_cents to 100000", () => {
    db.insert(accounts)
      .values({
        id: "acc_x",
        userId: "user_x",
        iban: "DE02120300000000202051",
        balanceCents: 1_000,
      })
      .run();

    const row = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_x"))
      .get();
    expect(row?.dailyLimitCents).toBe(100_000);
  });

  it("stores an explicit daily_limit_cents", () => {
    db.insert(accounts)
      .values({
        id: "acc_y",
        userId: "user_x",
        iban: "DE02120300000000202051",
        balanceCents: 1_000,
        dailyLimitCents: 200_000,
      })
      .run();

    const row = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_y"))
      .get();
    expect(row?.dailyLimitCents).toBe(200_000);
  });
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

describe("users.phone_number", () => {
  it("stores a phone number on a user", () => {
    db.insert(users)
      .values({
        id: "user_p",
        username: "p",
        passwordHash: "h",
        displayName: "P",
        phoneNumber: "+49 172 66666666",
      })
      .run();

    const row = db.select().from(users).where(eq(users.id, "user_p")).get();
    expect(row?.phoneNumber).toBe("+49 172 66666666");
  });

  // The DEFAULT exists only to backfill a developer's pre-existing rows —
  // `seed()` re-inserts every user, so no seeded row ever carries it. It is a
  // real number rather than an empty string because a NOT NULL empty string
  // would render a blank "Current mobile number" on the consent screen, which
  // is the design's first anti-goal.
  it("backfills phone_number on a user inserted without one", () => {
    db.insert(users)
      .values({
        id: "user_q",
        username: "q",
        passwordHash: "h",
        displayName: "Q",
      })
      .run();

    const row = db.select().from(users).where(eq(users.id, "user_q")).get();
    expect(row?.phoneNumber).toMatch(/^\+[0-9 ]+$/);
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

describe("login_sessions", () => {
  it("defaults a new row to pending / request_uri with no user", () => {
    db.insert(loginSessions).values({ id: "login_1", createdAt: 1000 }).run();

    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.transport).toBe("request_uri");
    expect(row?.userId).toBeNull();
    expect(row?.foundryVerificationId).toBeNull();
    expect(row?.failureReason).toBeNull();
    // NULL, not the empty string: a request_uri session performs no DC API
    // invocation, so there is no protocol identifier to report.
    expect(row?.dcApiProtocol).toBeNull();
  });

  // Widening the `transport` enum needed no SQL: the column is plain
  // `text DEFAULT 'request_uri' NOT NULL` with no CHECK constraint
  // (`0002_gorgeous_natasha_romanoff.sql`), so the drizzle `enum:` is a
  // TypeScript claim about the data rather than a database one. This test is
  // what proves the database really does accept the third value.
  it("stores the signed DC API transport alongside foundry's protocol identifier", () => {
    db.insert(loginSessions)
      .values({
        id: "login_signed",
        transport: "dc_api_signed",
        dcApiRequestJson: '{"request":"eyJ0.eyJ1.sig"}',
        dcApiProtocol: "openid4vp-v1-signed",
        createdAt: 3000,
      })
      .run();

    const row = db.select().from(loginSessions).get();
    expect(row?.transport).toBe("dc_api_signed");
    expect(row?.dcApiProtocol).toBe("openid4vp-v1-signed");
  });

  it("stores a resolved user and the dc_api transport", () => {
    seed(db);
    db.insert(loginSessions)
      .values({
        id: "login_2",
        state: "verified",
        transport: "dc_api",
        userId: "user_anna",
        dcApiRequestJson: '{"a":1}',
        createdAt: 2000,
      })
      .run();

    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("verified");
    expect(row?.transport).toBe("dc_api");
    expect(row?.userId).toBe("user_anna");
    expect(row?.dcApiRequestJson).toBe('{"a":1}');
  });

  it("refuses a user_id that names no user", () => {
    expect(() =>
      db
        .insert(loginSessions)
        .values({ id: "login_3", userId: "nobody", createdAt: 3000 })
        .run(),
    ).toThrow();
  });
});

describe("limit_change_sessions", () => {
  /** A complete row minus whatever the case under test is about. */
  function values(over: Record<string, unknown> = {}) {
    return {
      id: "limit_1",
      startedByUserId: "user_anna",
      accountId: "acc_anna",
      oldLimitCents: 100_000,
      newLimitCents: 200_000,
      createdAt: 1000,
      ...over,
    };
  }

  beforeEach(() => {
    seed(db);
  });

  it("defaults a limit-change session to pending over request_uri", () => {
    db.insert(limitChangeSessions).values(values()).run();

    const row = db.select().from(limitChangeSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.transport).toBe("request_uri");
    expect(row?.foundryVerificationId).toBeNull();
    expect(row?.failureReason).toBeNull();
    // NULL, not the empty string: a request_uri session performs no DC API
    // invocation, so there is no protocol identifier to report.
    expect(row?.dcApiProtocol).toBeNull();
  });

  // The same claim `login_sessions` makes about its own column: the `enum:` is
  // a TypeScript claim about plain `text`, and this is what proves SQLite
  // really accepts all three.
  it("accepts the three transports", () => {
    const transports = ["request_uri", "dc_api", "dc_api_signed"] as const;
    for (const [index, transport] of transports.entries()) {
      db.insert(limitChangeSessions)
        .values(values({ id: `limit_t${index}`, transport }))
        .run();
    }

    expect(
      db
        .select()
        .from(limitChangeSessions)
        .all()
        .map((row) => row.transport),
    ).toEqual([...transports]);
  });

  it("leaves approved_by_user_id null until the gate resolves it", () => {
    db.insert(limitChangeSessions).values(values()).run();

    const row = db.select().from(limitChangeSessions).get();
    // Two user columns, not one. `started_by_user_id` is the cookie's owner at
    // request time; this one is whoever the wallet's `sub` resolved to, and it
    // is the gate's whole output — it cannot be known yet.
    expect(row?.approvedByUserId).toBeNull();
    expect(row?.startedByUserId).toBe("user_anna");
  });

  it("stores a resolved approver", () => {
    db.insert(limitChangeSessions)
      .values(values({ state: "verified", approvedByUserId: "user_anna" }))
      .run();

    const row = db.select().from(limitChangeSessions).get();
    expect(row?.state).toBe("verified");
    expect(row?.approvedByUserId).toBe("user_anna");
  });

  it.each([
    ["started_by_user_id", "startedByUserId"],
    ["account_id", "accountId"],
    ["old_limit_cents", "oldLimitCents"],
    ["new_limit_cents", "newLimitCents"],
  ])("requires %s", (_column, key) => {
    const incomplete = values();
    delete (incomplete as Record<string, unknown>)[key];
    expect(() =>
      db
        .insert(limitChangeSessions)
        .values(incomplete as never)
        .run(),
    ).toThrow();
  });

  it("refuses an account_id that names no account", () => {
    expect(() =>
      db
        .insert(limitChangeSessions)
        .values(values({ accountId: "acc_nobody" }))
        .run(),
    ).toThrow();
  });

  /**
   * Found by the final review and measured before being fixed. `seed()` deletes
   * users and accounts, this table has NOT NULL FKs to both, and `createDb`
   * sets `foreign_keys = ON` — so one abandoned limit-change attempt used to
   * make `pnpm seed` throw partway through, after it had already deleted every
   * transaction, credential and card. Locally that is EVERY attempt, because no
   * local foundry declares `sparkassen_auth`.
   */
  it("does not block a re-seed", () => {
    db.insert(limitChangeSessions)
      .values(values({ state: "failed", failureReason: "metadata_unavailable" }))
      .run();

    expect(() => seed(db)).not.toThrow();
    expect(db.select().from(limitChangeSessions).all()).toHaveLength(0);
  });

  it("leaves the database whole when a re-seed is attempted", () => {
    db.insert(limitChangeSessions).values(values()).run();
    seed(db);

    // The half-wiped state is what made the original defect destructive rather
    // than merely noisy: seed() is not atomic, so a throw on `accounts` left
    // cards and transactions already gone.
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(cards).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(20);
  });

  it("refuses an approved_by_user_id that names no user", () => {
    expect(() =>
      db
        .insert(limitChangeSessions)
        .values(values({ approvedByUserId: "nobody" }))
        .run(),
    ).toThrow();
  });
});

describe("transfer_sessions", () => {
  /** A complete row minus whatever the case under test is about. */
  function values(over: Record<string, unknown> = {}) {
    return {
      id: "transfer_1",
      startedByUserId: "user_anna",
      accountId: "acc_anna",
      payeeName: "Max Mustermann",
      payeeIban: "DE89370400440532013000",
      amountCents: 25_000,
      purpose: "Rent October",
      createdAt: 1000,
      ...over,
    };
  }

  beforeEach(() => {
    seed(db);
  });

  it("rejects a transfer session with no started_by_user_id", () => {
    const incomplete = values();
    delete (incomplete as Record<string, unknown>).startedByUserId;
    expect(() =>
      db
        .insert(transferSessions)
        .values(incomplete as never)
        .run(),
    ).toThrow();
  });

  it("rejects a transfer session with no account_id", () => {
    const incomplete = values();
    delete (incomplete as Record<string, unknown>).accountId;
    expect(() =>
      db
        .insert(transferSessions)
        .values(incomplete as never)
        .run(),
    ).toThrow();
  });

  it("rejects a transfer session whose account_id is not an account", () => {
    expect(() =>
      db
        .insert(transferSessions)
        .values(values({ accountId: "acc_nobody" }))
        .run(),
    ).toThrow();
  });

  it("defaults state to pending and transport to request_uri", () => {
    db.insert(transferSessions).values(values()).run();

    const row = db.select().from(transferSessions).get();
    expect(row?.state).toBe("pending");
    expect(row?.transport).toBe("request_uri");
    expect(row?.foundryVerificationId).toBeNull();
    expect(row?.failureReason).toBeNull();
    // NULL, not the empty string: a request_uri session performs no DC API
    // invocation, so there is no protocol identifier to report.
    expect(row?.dcApiProtocol).toBeNull();
  });

  it("accepts a null approved_by_user_id and a null transaction_id", () => {
    db.insert(transferSessions).values(values()).run();

    const row = db.select().from(transferSessions).get();
    // Two user columns, not one, for the reason `limit_change_sessions`
    // documents: "who asked" and "who approved" are distinct facts, and the
    // ownership gate is precisely that they must be equal. The gate has not
    // run yet, so its output cannot be known.
    expect(row?.approvedByUserId).toBeNull();
    expect(row?.startedByUserId).toBe("user_anna");
    // NULL until applied. It is written in the SAME transaction as the debit,
    // so a session and its transaction can never disagree about whether the
    // money moved.
    expect(row?.transactionId).toBeNull();
  });

  it("stores amount_cents as an integer and the three text fields verbatim", () => {
    db.insert(transferSessions).values(values()).run();

    const row = db.select().from(transferSessions).get();
    expect(row?.amountCents).toBe(25_000);
    expect(row?.payeeName).toBe("Max Mustermann");
    // The NORMALISED form is what is stored. The grouped-in-fours rendering
    // the holder reads on the consent screen is derived from this at build
    // time, so there is one source and one derivation.
    expect(row?.payeeIban).toBe("DE89370400440532013000");
    expect(row?.purpose).toBe("Rent October");
  });

  /**
   * The same regression `limit_change_sessions` records above, reached by the
   * same route: NOT NULL FKs to both `users` and `accounts`, and `createDb`
   * sets `foreign_keys = ON`. One abandoned transfer attempt is enough — and
   * locally that is EVERY attempt, because no local foundry declares
   * `sparkassen_auth`.
   */
  it("does not block a re-seed", () => {
    db.insert(transferSessions)
      .values(values({ state: "failed", failureReason: "metadata_unavailable" }))
      .run();

    expect(() => seed(db)).not.toThrow();
    expect(db.select().from(transferSessions).all()).toHaveLength(0);
  });

  it("leaves the database whole when a re-seed is attempted", () => {
    db.insert(transferSessions).values(values()).run();
    seed(db);

    // The half-wiped state is the damage, not the throw: without the atomic
    // wrapper a throw on `accounts` leaves cards and transactions already gone,
    // and the documented reset command produces a dashboard holding accounts
    // and nothing else.
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(cards).all()).toHaveLength(2);
    expect(db.select().from(transactions).all()).toHaveLength(20);
  });
});

describe("transaction_proofs", () => {
  it("holds at most one package per transaction", () => {
    seed(db);
    const txId = db.select().from(transactions).all()[0]!.id;

    db.insert(transactionProofs)
      .values({
        transactionId: txId,
        signedRequest: "a.b.c",
        vpTokenJson: '{"dpc":["x"]}',
        receivedAt: 5,
      })
      .run();

    expect(() =>
      db
        .insert(transactionProofs)
        .values({
          transactionId: txId,
          signedRequest: "d.e.f",
          vpTokenJson: "{}",
          receivedAt: 6,
        })
        .run(),
    ).toThrow();
  });

  it("refuses a package for a transaction that does not exist", () => {
    // The foreign key is what makes "at most one package per transaction" mean
    // anything: without it a proof could name any string.
    expect(() =>
      db
        .insert(transactionProofs)
        .values({
          transactionId: "tx_nope",
          signedRequest: "a.b.c",
          vpTokenJson: "{}",
          receivedAt: 5,
        })
        .run(),
    ).toThrow();
  });
});
