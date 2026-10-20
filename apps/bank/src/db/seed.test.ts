import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanLastFour } from "../lib/display-metadata.js";
import { createDb, type Db } from "./index.js";
import { accounts, cards, phoneChangeSessions, users } from "./schema.js";
import { seed, seedIfEmpty } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-seed-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seedIfEmpty", () => {
  it("seeds the fixtures when the users table is empty and reports it did", () => {
    expect(db.select().from(users).all()).toHaveLength(0);

    expect(seedIfEmpty(db)).toBe(true);

    const seeded = db.select().from(users).all();
    expect(seeded).toHaveLength(2);
    expect(seeded.map((u) => u.username).sort()).toEqual(["anna", "ben"]);
  });

  it("leaves a populated database untouched and reports it did nothing", () => {
    db.insert(users)
      .values({
        id: "user_zoe",
        username: "zoe",
        passwordHash: "not-a-real-hash",
        displayName: "Zoe Operator",
      })
      .run();

    expect(seedIfEmpty(db)).toBe(false);

    const after = db.select().from(users).all();
    expect(after).toHaveLength(1);
    expect(after[0]?.username).toBe("zoe");
  });
});

/**
 * These are not fixture trivia. Issuance sends DPC display metadata derived from
 * these exact rows, and foundry validates it all-or-nothing: a `card.last_four`
 * that is not four digits, or a network with no branding asset, is a
 * `400 invalid_request` that kills the whole offer. `seed` is the only writer of
 * `accounts` and `cards`, so asserting here covers every row the app can read.
 */
describe("seed invariants the DPC display metadata depends on", () => {
  beforeEach(() => {
    seed(db);
  });

  it("gives every account an IBAN whose last four characters are digits", () => {
    const rows = db.select().from(accounts).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.iban).toMatch(/[0-9]{4}$/);
      // The consumer itself, not a restated regex: this is what issuance runs.
      expect(() => ibanLastFour(row.iban)).not.toThrow();
    }
  });

  it("gives every card the girocard network the display metadata has a logo for", () => {
    const rows = db.select().from(cards).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((c) => c.network)).toEqual(["girocard", "girocard"]);
  });
});

/**
 * The phone-change flow signs the stored number into `transaction_data` and
 * shows it to the holder as the half of the sentence they check. A fixture
 * with no number would render a blank consent-screen row; two fixtures sharing
 * one number would let a test that means to prove the RIGHT customer's row was
 * written pass by coincidence.
 */
describe("seed invariants the phone-change flow depends on", () => {
  beforeEach(() => {
    seed(db);
  });

  it("gives every fixture a phone number in international form", () => {
    const rows = db.select().from(users).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.phoneNumber).toMatch(/^\+[0-9 ]+$/);
    }
  });

  it("gives the two fixtures different phone numbers", () => {
    const numbers = db
      .select()
      .from(users)
      .all()
      .map((row) => row.phoneNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  /**
   * `phone_change_sessions` has a NOT NULL FK to `users` and `seed()` deletes
   * `users`, so a table left out of `seedWithin` makes the documented reset
   * command throw the first time anything writes to it — and locally that is
   * every attempt, because no local foundry declares `sparkassen_auth`.
   */
  it("reseeds after a phone-change session exists", () => {
    db.insert(phoneChangeSessions)
      .values({
        id: "phone_abandoned",
        startedByUserId: "user_anna",
        oldPhone: "+49 171 5555555",
        newPhone: "+49 172 66666666",
        createdAt: 1000,
      })
      .run();

    expect(() => seed(db)).not.toThrow();

    expect(db.select().from(phoneChangeSessions).all()).toHaveLength(0);
    expect(db.select().from(users).all()).toHaveLength(2);
    expect(db.select().from(accounts).all()).toHaveLength(2);
    expect(db.select().from(cards).all()).toHaveLength(2);
  });
});
