import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { users } from "./schema.js";
import { seedIfEmpty } from "./seed.js";

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