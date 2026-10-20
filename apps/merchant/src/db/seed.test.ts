import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { orderItems, orders, products } from "./schema.js";
import { seed, seedIfEmpty } from "./seed.js";

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

describe("seed", () => {
  /**
   * The regression this exists for. `order_items.product_id` references
   * `products.id` with ON DELETE NO ACTION, and `createDb` sets
   * `foreign_keys = ON` — so `seed()`'s `DELETE FROM products` threw
   * `FOREIGN KEY constraint failed` the moment any order had ever been placed.
   * That is every database a human has ever shopped against, and the failure
   * was permanent: the documented reset command could never run again.
   *
   * Fixing it by deleting `order_items` first — the way the BANK's seed deletes
   * children before parents — would be a symptom fix that breaks this
   * function's stated contract: it deliberately leaves orders alone, because
   * re-seeding mid-demo must not erase an in-progress order.
   */
  function placeOrder(productId: string): void {
    db.insert(orders)
      .values({
        id: "order_1",
        totalCents: 500,
        customerName: "Anna Schmidt",
        customerEmail: "anna@example.com",
        createdAt: 1000,
      })
      .run();
    db.insert(orderItems)
      .values({ orderId: "order_1", productId, quantity: 1, unitPriceCents: 500 })
      .run();
  }

  it("re-seeds a catalogue an order already references", () => {
    seed(db);
    placeOrder(db.select().from(products).all()[0]!.id);

    expect(() => seed(db)).not.toThrow();
  });

  it("leaves the order and its items intact across a re-seed", () => {
    seed(db);
    const productId = db.select().from(products).all()[0]!.id;
    placeOrder(productId);

    seed(db);

    // The whole reason this cannot delete-then-insert: orders are runtime
    // data, not fixtures, and a reset mid-demo must not erase one.
    expect(db.select().from(orders).all()).toHaveLength(1);
    const items = db.select().from(orderItems).all();
    expect(items).toHaveLength(1);
    expect(items[0]?.productId).toBe(productId);
  });

  it("resets a modified fixture back to its documented values", () => {
    seed(db);
    const before = db.select().from(products).all()[0]!;
    db.update(products)
      .set({ name: "Tampered", priceCents: 1 })
      .where(eq(products.id, before.id))
      .run();

    seed(db);

    const after = db
      .select()
      .from(products)
      .where(eq(products.id, before.id))
      .get();
    expect(after).toEqual(before);
  });

  it("seeds every fixture exactly once across repeated runs", () => {
    seed(db);
    const first = db.select().from(products).all().length;
    seed(db);
    seed(db);

    expect(db.select().from(products).all()).toHaveLength(first);
  });
});
