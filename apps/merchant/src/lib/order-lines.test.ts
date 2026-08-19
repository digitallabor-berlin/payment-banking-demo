import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { products } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createOrder } from "./orders.js";
import { listOrderLines } from "./order-lines.js";

let dir: string;
let db: Db;

const customer = { name: "Ada Lovelace", email: "ada@example.test" };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-ol-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listOrderLines", () => {
  it("returns a display name, quantity and line total per line", () => {
    const created = createOrder(
      db,
      [
        { productId: "cheese", quantity: 2 },
        { productId: "sourdough", quantity: 1 },
      ],
      customer,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const lines = listOrderLines(db, created.orderId);
    expect(lines).toEqual([
      {
        productId: "cheese",
        name: "Aged Gouda",
        quantity: 2,
        unitPriceCents: 449,
        lineTotalCents: 898,
        ageRestricted: false,
      },
      {
        productId: "sourdough",
        name: "Sourdough Loaf",
        quantity: 1,
        unitPriceCents: 399,
        lineTotalCents: 399,
        ageRestricted: false,
      },
    ]);
  });

  it("marks an age-restricted line", () => {
    const created = createOrder(db, [{ productId: "wine", quantity: 1 }], customer);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(listOrderLines(db, created.orderId)[0]?.ageRestricted).toBe(true);
  });

  it("uses the snapshotted unit price, not the current product price", () => {
    // orders.ts snapshots unitPriceCents deliberately: it records what the
    // customer was charged, which a later price change must not rewrite.
    const created = createOrder(db, [{ productId: "cheese", quantity: 1 }], customer);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    db.update(products).set({ priceCents: 9_999 }).run();

    const [line] = listOrderLines(db, created.orderId);
    expect(line?.unitPriceCents).toBe(449);
    expect(line?.lineTotalCents).toBe(449);
  });

  it("returns an empty list for an unknown order", () => {
    expect(listOrderLines(db, "ord_nope")).toEqual([]);
  });
});