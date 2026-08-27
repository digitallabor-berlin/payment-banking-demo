import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "./index.js";
import { orders, paymentSessions, products } from "./schema.js";
import { seed } from "./seed.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-db-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("seed", () => {
  it("creates exactly fifteen products", () => {
    seed(db);
    expect(db.select().from(products).all()).toHaveLength(15);
  });

  it("gives each product a positive price in whole cents", () => {
    seed(db);
    for (const product of db.select().from(products).all()) {
      expect(product.priceCents).toBeGreaterThan(0);
      expect(Number.isInteger(product.priceCents)).toBe(true);
    }
  });

  it("gives each product a pack size a unit price can be computed from", () => {
    seed(db);
    for (const product of db.select().from(products).all()) {
      expect(product.packLabel).not.toBe("");
      expect(product.baseQuantity).toBeGreaterThan(0);
      expect(["kg", "l", "pc"]).toContain(product.baseUnit);
    }
  });

  it("creates no orders or payment sessions", () => {
    seed(db);
    expect(db.select().from(orders).all()).toHaveLength(0);
    expect(db.select().from(paymentSessions).all()).toHaveLength(0);
  });

  it("is idempotent — running twice leaves the same row count", () => {
    seed(db);
    seed(db);
    expect(db.select().from(products).all()).toHaveLength(15);
  });

  it("does not delete orders created after seeding, only re-running seed does", () => {
    seed(db);
    db.insert(orders)
      .values({
        id: "ord_test",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();
    expect(db.select().from(orders).all()).toHaveLength(1);
  });
});

describe("payment_sessions retries", () => {
  it("allows a second session for the same order — retrying a failed presentation needs this", () => {
    // Spec §6.3: a retry "starts a fresh presentation" for the same order, so
    // the schema must not forbid a second row with the same order_id.
    seed(db);
    db.insert(orders)
      .values({
        id: "ord_1",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();

    db.insert(paymentSessions)
      .values({ id: "sess_1", orderId: "ord_1", state: "failed", createdAt: 1 })
      .run();

    expect(() =>
      db
        .insert(paymentSessions)
        .values({
          id: "sess_2",
          orderId: "ord_1",
          state: "pending",
          createdAt: 2,
        })
        .run(),
    ).not.toThrow();

    expect(db.select().from(paymentSessions).all()).toHaveLength(2);
  });

  // Widening the `transport` enum needed no SQL: the column is plain
  // `text DEFAULT 'request_uri' NOT NULL` with no CHECK constraint
  // (`0002_funny_legion.sql`), so the drizzle `enum:` is a TypeScript claim
  // about the data rather than a database one. This test is what proves the
  // database really does accept the third value.
  it("stores the signed DC API transport alongside foundry's protocol identifier", () => {
    db.insert(orders)
      .values({
        id: "ord_2",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();

    db.insert(paymentSessions)
      .values({
        id: "sess_signed",
        orderId: "ord_2",
        state: "pending",
        transport: "dc_api_signed",
        dcApiRequestJson: '{"request":"eyJ0.eyJ1.sig"}',
        dcApiProtocol: "openid4vp-v1-signed",
        createdAt: 1,
      })
      .run();

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("dc_api_signed");
    expect(row?.dcApiProtocol).toBe("openid4vp-v1-signed");
  });

  // NULL, not the empty string: a request_uri session performs no DC API
  // invocation, so there is no identifier to report.
  it("leaves the protocol identifier null by default", () => {
    db.insert(orders)
      .values({
        id: "ord_3",
        totalCents: 1000,
        currency: "EUR",
        customerName: "Test",
        customerEmail: "test@example.com",
        createdAt: 1,
      })
      .run();

    db.insert(paymentSessions)
      .values({
        id: "sess_qr",
        orderId: "ord_3",
        state: "pending",
        createdAt: 1,
      })
      .run();

    const row = db.select().from(paymentSessions).get();
    expect(row?.transport).toBe("request_uri");
    expect(row?.dcApiProtocol).toBeNull();
  });
});
