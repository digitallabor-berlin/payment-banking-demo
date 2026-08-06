import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createOrder } from "./orders.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-ord-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const customer = { name: "Ada Lovelace", email: "ada@example.com" };

describe("createOrder", () => {
  it("computes the total from the products table, not from the caller", () => {
    // cheese is 449 cents, berries 349 cents (see db/seed.ts fixtures).
    const result = createOrder(
      db,
      [
        { productId: "cheese", quantity: 2 },
        { productId: "berries", quantity: 1 },
      ],
      customer,
    );
    expect(result).toEqual({
      ok: true,
      orderId: expect.any(String),
      totalCents: 449 * 2 + 349,
    });
  });

  it("persists a pending order with the computed total", () => {
    const result = createOrder(db, [{ productId: "cheese", quantity: 1 }], customer);
    if (!result.ok) throw new Error("expected success");
    const row = db.select().from(orders).where(eq(orders.id, result.orderId)).get();
    expect(row?.status).toBe("pending");
    expect(row?.totalCents).toBe(449);
    expect(row?.customerName).toBe("Ada Lovelace");
    expect(row?.customerEmail).toBe("ada@example.com");
  });

  it("multiplies price by quantity for each line", () => {
    const result = createOrder(db, [{ productId: "water", quantity: 3 }], customer);
    expect(result).toMatchObject({ ok: true, totalCents: 89 * 3 });
  });

  it("rejects an empty cart", () => {
    expect(createOrder(db, [], customer)).toEqual({ ok: false, reason: "empty_cart" });
  });

  it("rejects a reference to a product that does not exist", () => {
    const result = createOrder(
      db,
      [
        { productId: "cheese", quantity: 1 },
        { productId: "prod_nope", quantity: 1 },
      ],
      customer,
    );
    expect(result).toEqual({ ok: false, reason: "unknown_product" });
  });

  it("does not insert a row when rejecting", () => {
    createOrder(db, [], customer);
    createOrder(db, [{ productId: "prod_nope", quantity: 1 }], customer);
    expect(db.select().from(orders).all()).toHaveLength(0);
  });
});