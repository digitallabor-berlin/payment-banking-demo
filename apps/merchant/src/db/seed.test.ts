import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { products } from "./schema.js";
import { seedIfEmpty } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-seed-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seedIfEmpty", () => {
  it("seeds the product fixtures when the products table is empty", () => {
    expect(db.select().from(products).all()).toHaveLength(0);

    expect(seedIfEmpty(db)).toBe(true);

    expect(db.select().from(products).all().length).toBeGreaterThan(0);
  });

  it("leaves a populated catalogue untouched and reports it did nothing", () => {
    db.insert(products)
      .values({
        id: "prod_operator",
        name: "Operator's Placeholder",
        description: "Inserted by hand to prove seedIfEmpty does not clobber it.",
        priceCents: 199,
        imageUrl: "/products/placeholder.jpg",
        category: "test",
        packLabel: "1 pc",
        baseQuantity: 1,
        baseUnit: "pc",
      })
      .run();

    expect(seedIfEmpty(db)).toBe(false);

    const after = db.select().from(products).all();
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe("prod_operator");
  });
});