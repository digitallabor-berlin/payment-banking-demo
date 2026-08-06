import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { seed } from "../db/seed.js";
import { getProduct, listProducts } from "./queries.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-q-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listProducts", () => {
  it("returns all six seeded products", () => {
    expect(listProducts(db)).toHaveLength(6);
  });

  it("exposes only the DTO fields, deliberately omitting imageUrl", () => {
    // The column exists because the spec's data model lists it, but nothing
    // renders an image (see Task 3's note), so it must not leak into the API.
    const [first] = listProducts(db);
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "category",
      "description",
      "id",
      "name",
      "priceCents",
    ]);
  });
});

describe("getProduct", () => {
  it("returns a seeded product by id", () => {
    const product = getProduct(db, "prod_1");
    expect(product?.name).toBe("Wireless Headphones");
    expect(product?.priceCents).toBe(12_999);
  });

  it("returns null for an unknown id", () => {
    expect(getProduct(db, "prod_nope")).toBeNull();
  });
});