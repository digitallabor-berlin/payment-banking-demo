import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  loadCheckoutSession,
  sheetSessionFromStart,
} from "./checkout-session.js";
import type { StartedPaymentSession } from "./payment-sessions.js";

let dir: string;
let db: Db;

const NOW = 1_700_000_000_000;

function insertOrder(
  id: string,
  totalCents: number,
  customerName = "Ada Lovelace",
): void {
  db.insert(orders)
    .values({
      id,
      totalCents,
      currency: "EUR",
      customerName,
      customerEmail: "ada@example.test",
      status: "pending",
      createdAt: NOW,
    })
    .run();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-cs-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadCheckoutSession", () => {
  it("returns the sheet's props for a live request_uri session", () => {
    insertOrder("ord_1", 1747);
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "pending",
        openid4vpUri:
          "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
        transport: "request_uri",
        namedQueryRef: "payment",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_1")).toEqual({
      sessionId: "sess_1",
      orderId: "ord_1",
      amountCents: 1747,
      openid4vpUri:
        "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
      transport: "request_uri",
      ageRequested: false,
      dcApiRequest: null,
      dcApiProtocol: null,
      neutralChrome: false,
      initialState: "pending",
    });
  });

  /**
   * The demo flag is derived from the order this session belongs to, not stored
   * on the session — there is no column for it, and adding one would let a row
   * disagree with the name printed on its own order. The only cost is that
   * renaming the customer after the fact would change the sheet's chrome, which
   * nothing in this app can do.
   */
  it("derives neutralChrome from the order's customer name", () => {
    insertOrder("ord_neutral", 2500, "John Smith");
    db.insert(paymentSessions)
      .values({
        id: "sess_neutral",
        orderId: "ord_neutral",
        state: "pending",
        transport: "dc_api",
        dcApiRequestJson: '{"nonce":"n1"}',
        dcApiProtocol: "openid4vp-v1-unsigned",
        namedQueryRef: "payment",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_neutral")?.neutralChrome).toBe(true);
  });

  // A deep link or a reload has to rebuild the DC API call from the row alone,
  // and the protocol identifier is half of that call's contract — a signed
  // request object replayed under the unsigned identifier fails inside the
  // wallet with no server-side trace.
  it("carries the signed session's protocol identifier back out of the row", () => {
    insertOrder("ord_signed", 500);
    db.insert(paymentSessions)
      .values({
        id: "sess_signed",
        orderId: "ord_signed",
        state: "pending",
        transport: "dc_api_signed",
        dcApiRequestJson: '{"request":"eyJ0.eyJ1.sig"}',
        dcApiProtocol: "openid4vp-v1-signed",
        namedQueryRef: "payment",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_signed")).toMatchObject({
      // Empty string, not the row's NULL uri: the sheet takes a string prop and
      // a DC API session has no URI to navigate to.
      openid4vpUri: "",
      transport: "dc_api_signed",
      dcApiRequest: { request: "eyJ0.eyJ1.sig" },
      dcApiProtocol: "openid4vp-v1-signed",
    });
  });

  it("reports ageRequested from the recorded named query", () => {
    insertOrder("ord_2", 899);
    db.insert(paymentSessions)
      .values({
        id: "sess_2",
        orderId: "ord_2",
        state: "pending",
        openid4vpUri: "openid4vp://x",
        transport: "request_uri",
        namedQueryRef: "payment_av",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_2")?.ageRequested).toBe(true);
  });

  it("parses the stored dc_api request object and has no uri", () => {
    insertOrder("ord_3", 500);
    db.insert(paymentSessions)
      .values({
        id: "sess_3",
        orderId: "ord_3",
        state: "pending",
        transport: "dc_api",
        namedQueryRef: "payment",
        dcApiRequestJson: JSON.stringify({ response_mode: "dc_api.jwt" }),
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_3");
    expect(loaded?.transport).toBe("dc_api");
    expect(loaded?.openid4vpUri).toBe("");
    expect(loaded?.dcApiRequest).toEqual({ response_mode: "dc_api.jwt" });
  });

  it("carries a terminal state and its failure reason", () => {
    insertOrder("ord_4", 300);
    db.insert(paymentSessions)
      .values({
        id: "sess_4",
        orderId: "ord_4",
        state: "failed",
        failureReason: "insufficient_funds",
        transport: "request_uri",
        namedQueryRef: "payment",
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_4");
    expect(loaded?.initialState).toBe("failed");
    expect(loaded?.initialFailureReason).toBe("insufficient_funds");
  });

  it("returns null for an unknown session id", () => {
    expect(loadCheckoutSession(db, "sess_nope")).toBeNull();
  });
});

/**
 * The SECOND constructor of `SheetSession`, and the reason it is a named
 * function rather than an object literal in a route handler.
 *
 * A freshly created session is answered over HTTP before any row is read back,
 * because the sheet needs its props immediately — the DC API payload must
 * already be a prop when the click arrives, since Chrome consumes the click's
 * transient activation. So there are unavoidably two ways to build one
 * `SheetSession`: from a `startPaymentSession` result, and from a stored row.
 *
 * The literal this replaced silently lost `dcApiProtocol` for a commit, which
 * broke every merchant DC API payment on its first attempt while a reload
 * appeared to fix it — a reload takes the OTHER constructor. Naming the
 * projection is what makes the return type enforceable.
 */
describe("sheetSessionFromStart", () => {
  const startedRequestUri: StartedPaymentSession = {
    ok: true,
    sessionId: "sess_new",
    uri: "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F9",
    orderId: "ord_new",
    amountCents: 4_798,
    transport: "request_uri",
    ageRequested: false,
    dcApiRequest: null,
    dcApiProtocol: null,
    neutralChrome: false,
    state: "pending",
  };

  // The two renames are the whole reason a third hand-written mapping used to
  // exist in CheckoutForm: `uri` -> `openid4vpUri`, `state` -> `initialState`.
  it("renames the result's uri and state to the sheet's prop names", () => {
    expect(sheetSessionFromStart(startedRequestUri)).toEqual({
      sessionId: "sess_new",
      orderId: "ord_new",
      amountCents: 4_798,
      openid4vpUri:
        "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F9",
      transport: "request_uri",
      ageRequested: false,
      dcApiRequest: null,
      dcApiProtocol: null,
      neutralChrome: false,
      initialState: "pending",
    });
  });

  // Forwarded verbatim, not re-derived: this constructor has no order row to
  // read, so `startPaymentSession` is the one place that consults the name.
  it("forwards the neutral chrome flag", () => {
    expect(
      sheetSessionFromStart({ ...startedRequestUri, neutralChrome: true }),
    ).toMatchObject({ neutralChrome: true });
  });

  it("empties a null uri and carries the signed protocol identifier", () => {
    expect(
      sheetSessionFromStart({
        ...startedRequestUri,
        uri: null,
        transport: "dc_api_signed",
        dcApiRequest: { request: "eyJ0.eyJ1.sig" },
        dcApiProtocol: "openid4vp-v1-signed",
      }),
    ).toMatchObject({
      // A string prop, not the result's null: a DC API session has no URI to
      // navigate to, and the sheet's QR branch is chosen by transport anyway.
      openid4vpUri: "",
      dcApiProtocol: "openid4vp-v1-signed",
    });
  });

  // `state` is the literal "pending" on this branch, so the member has nothing
  // to report and its absence is the honest answer rather than an empty string.
  it("omits initialFailureReason — no session is born failed", () => {
    expect(Object.keys(sheetSessionFromStart(startedRequestUri))).not.toContain(
      "initialFailureReason",
    );
  });

  /**
   * The point of the whole exercise. The sheet is built by this function when a
   * session is created and by `loadCheckoutSession` on every reload of the same
   * session, so the two must agree member for member — a shopper must not get a
   * different sheet for the same payment depending on how they arrived at it.
   * This is the assertion the lost `dcApiProtocol` would have failed.
   */
  it("agrees member for member with loadCheckoutSession", () => {
    insertOrder("ord_agree", 4_798);
    db.insert(paymentSessions)
      .values({
        id: "sess_agree",
        orderId: "ord_agree",
        state: "pending",
        transport: "dc_api_signed",
        dcApiRequestJson: '{"request":"eyJ0.eyJ1.sig"}',
        dcApiProtocol: "openid4vp-v1-signed",
        namedQueryRef: "payment",
        createdAt: NOW,
      })
      .run();

    const fromStart = sheetSessionFromStart({
      ok: true,
      sessionId: "sess_agree",
      uri: null,
      orderId: "ord_agree",
      amountCents: 4_798,
      transport: "dc_api_signed",
      ageRequested: false,
      dcApiRequest: { request: "eyJ0.eyJ1.sig" },
      dcApiProtocol: "openid4vp-v1-signed",
      neutralChrome: false,
      state: "pending",
    });

    expect(fromStart).toEqual(loadCheckoutSession(db, "sess_agree"));
  });
});
