import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { seed } from "../db/seed.js";
import { getProduct, listAisles, listProducts } from "./queries.js";

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
  it("returns every seeded product", () => {
    expect(listProducts(db)).toHaveLength(15);
  });

  it("exposes the fields the storefront renders", () => {
    // imageUrl is part of the DTO now that the shelf shows photography; the
    // pack fields carry the EU-mandated unit price (Directive 98/6/EC).
    const [first] = listProducts(db);
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "ageRestricted",
      "baseQuantity",
      "baseUnit",
      "category",
      "description",
      "id",
      "imageUrl",
      "name",
      "packLabel",
      "priceCents",
    ]);
  });

  it("points every product at an image under /products/", () => {
    for (const product of listProducts(db)) {
      expect(product.imageUrl).toMatch(/^\/products\/[\w-]+\.jpg$/);
    }
  });

  it("gives every product a positive pack quantity so a unit price exists", () => {
    for (const product of listProducts(db)) {
      expect(product.baseQuantity).toBeGreaterThan(0);
      expect(["kg", "l", "pc"]).toContain(product.baseUnit);
    }
  });

  it("marks exactly the three age-restricted products", () => {
    const restricted = listProducts(db)
      .filter((product) => product.ageRestricted)
      .map((product) => product.id)
      .sort();
    expect(restricted).toEqual(["aperitif", "beer", "wine"]);
  });
});

describe("getProduct", () => {
  it("returns a seeded product by id", () => {
    const product = getProduct(db, "cheese");
    expect(product?.name).toBe("Aged Gouda");
    expect(product?.priceCents).toBe(449);
    expect(product?.packLabel).toBe("200 g");
  });

  it("returns null for an unknown id", () => {
    expect(getProduct(db, "prod_nope")).toBeNull();
  });
});

describe("listAisles", () => {
  it("groups the catalogue by category", () => {
    expect(listAisles(db).map((aisle) => aisle.name)).toEqual([
      "Produce",
      "Bakery",
      "Dairy",
      "Pantry",
      "Snacks",
      "Drinks",
    ]);
  });

  it("keeps every product, in the merchandiser's order", () => {
    const aisles = listAisles(db);
    expect(aisles.flatMap((aisle) => aisle.products)).toHaveLength(15);
    expect(aisles[0]?.products.map((p) => p.id)).toEqual([
      "tomatoes",
      "avocado",
      "berries",
    ]);
  });

  it("puts every product in the aisle named by its own category", () => {
    for (const aisle of listAisles(db)) {
      for (const product of aisle.products) {
        expect(product.category).toBe(aisle.name);
      }
    }
  });
});