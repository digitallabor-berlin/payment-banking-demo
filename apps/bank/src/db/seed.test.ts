import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ibanLastFour } from "../lib/display-metadata.js";
import { createDb, type Db } from "./index.js";
import { accounts, cards, users } from "./schema.js";
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
