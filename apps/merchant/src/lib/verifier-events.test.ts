import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions, verifierEvents } from "../db/schema.js";
import {
  parseVerifierEvent,
  recordVerifierEvent,
  verifyWebhookSignature,
} from "./verifier-events.js";

const SECRET = "s3cr3t";

/** Exactly what foundry's `sign_body` produces: `sha256=<lowercase hex>`. */
function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyWebhookSignature", () => {
  it("accepts a signature over the exact body bytes", () => {
    const body = '{"event":"verification_completed","tx_id":"ver_1"}';
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body that changed by one byte", () => {
    expect(verifyWebhookSignature('{"a":2}', sign('{"a":1}'), SECRET)).toBe(
      false,
    );
  });

  it("rejects a signature made with a different secret", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body, "other"), SECRET)).toBe(
      false,
    );
  });

  it("rejects an absent header", () => {
    expect(verifyWebhookSignature('{"a":1}', null, SECRET)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body).slice(7), SECRET)).toBe(
      false,
    );
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the wrapper must not.
    expect(verifyWebhookSignature('{"a":1}', "sha256=beef", SECRET)).toBe(
      false,
    );
  });

  it("rejects a header that is not hex", () => {
    expect(
      verifyWebhookSignature('{"a":1}', `sha256=${"z".repeat(64)}`, SECRET),
    ).toBe(false);
  });
});

describe("parseVerifierEvent", () => {
  it("reads a request event carrying a signed request", () => {
    expect(
      parseVerifierEvent({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "request_uri",
        request_object_jws: "a.b.c",
      }),
    ).toEqual({
      event: "presentation_request_delivered",
      txId: "ver_1",
      transport: "request_uri",
      signedRequest: "a.b.c",
    });
  });

  it("normalises an ABSENT request_object_jws to null", () => {
    // foundry uses `skip_serializing_if = Option::is_none`, so with
    // include_raw_artifacts off the KEY IS ABSENT rather than null. Both must
    // land as null so every reader downstream tests one shape.
    expect(
      parseVerifierEvent({
        event: "presentation_request_delivered",
        tx_id: "ver_1",
        transport: "dc_api",
      }),
    ).toEqual({
      event: "presentation_request_delivered",
      txId: "ver_1",
      transport: "dc_api",
      signedRequest: null,
    });
  });

  it("reads a completion event carrying a vp_token", () => {
    expect(
      parseVerifierEvent({
        event: "verification_completed",
        tx_id: "ver_1",
        state: "verified",
        result: { verified: true, checks: [], credentials: [] },
        vp_token: { dpc: ["eyJ..."] },
      }),
    ).toEqual({
      event: "verification_completed",
      txId: "ver_1",
      vpToken: { dpc: ["eyJ..."] },
    });
  });

  it("normalises an absent vp_token to null", () => {
    expect(
      parseVerifierEvent({
        event: "verification_completed",
        tx_id: "ver_1",
        state: "failed",
        result: { verified: false, checks: [], credentials: [] },
      }),
    ).toEqual({
      event: "verification_completed",
      txId: "ver_1",
      vpToken: null,
    });
  });

  it("ignores an event type it does not know", () => {
    // Forward compatibility: a later foundry may add events. An unknown one is
    // not an error, it is not ours.
    expect(
      parseVerifierEvent({ event: "something_new", tx_id: "ver_1" }),
    ).toBeNull();
  });

  it("rejects a body with no tx_id", () => {
    expect(
      parseVerifierEvent({
        event: "verification_completed",
        state: "verified",
      }),
    ).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseVerifierEvent("nope")).toBeNull();
    expect(parseVerifierEvent(null)).toBeNull();
  });
});
describe("recordVerifierEvent", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "merchant-events-"));
    db = createDb(path.join(dir, "test.db"));
    // payment_sessions has a foreign key to orders, so the parent must exist
    // before any session fixture below can be written.
    db.insert(orders)
      .values({
        id: "ord_1",
        totalCents: 1_000,
        currency: "EUR",
        customerName: "Ada",
        customerEmail: "ada@example.com",
        status: "pending",
        createdAt: 1,
      })
      .run();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A session that has already recorded its foundry verification id. */
  function knownSession(txId: string): void {
    db.insert(paymentSessions)
      .values({
        id: `sess_${txId}`,
        orderId: "ord_1",
        state: "pending",
        foundryVerificationId: txId,
        namedQueryRef: "payment",
        createdAt: 1,
      })
      .run();
  }

  it("stores a request event even for a transaction it has never heard of", () => {
    // The event is dispatched INSIDE foundry's create_verification_request, so
    // it can beat our own UPDATE that writes foundry_verification_id. Refusing
    // it would lose the signed request for every DC API payment.
    expect(
      recordVerifierEvent(
        db,
        {
          event: "presentation_request_delivered",
          txId: "ver_unknown",
          transport: "dc_api_signed",
          signedRequest: "a.b.c",
        },
        50,
      ),
    ).toBe("stored");

    const row = db.select().from(verifierEvents).all()[0]!;
    expect(row.txId).toBe("ver_unknown");
    expect(row.signedRequest).toBe("a.b.c");
    expect(row.vpTokenJson).toBeNull();
    expect(row.receivedAt).toBe(50);
  });

  it("stores a completion for a transaction it owns", () => {
    knownSession("ver_mine");

    expect(
      recordVerifierEvent(
        db,
        {
          event: "verification_completed",
          txId: "ver_mine",
          vpToken: { dpc: ["x"] },
        },
        60,
      ),
    ).toBe("stored");

    const row = db.select().from(verifierEvents).all()[0]!;
    expect(row.event).toBe("verification_completed");
    expect(JSON.parse(row.vpTokenJson!)).toEqual({ dpc: ["x"] });
  });

  it("DROPS a completion for a transaction it does not own", () => {
    // Design D8. One foundry serves both apps, and the bank verifies too. An
    // unmatched completion is the BANK's wallet-login vp_token — a holder
    // credential from a flow this app has nothing to do with.
    expect(
      recordVerifierEvent(
        db,
        {
          event: "verification_completed",
          txId: "ver_bank_login",
          vpToken: { sparkassen_auth: ["x"] },
        },
        70,
      ),
    ).toBe("ignored");

    expect(db.select().from(verifierEvents).all()).toHaveLength(0);
  });

  it("stores a completion carrying no vp_token as a NULL artefact", () => {
    knownSession("ver_mine");

    expect(
      recordVerifierEvent(
        db,
        { event: "verification_completed", txId: "ver_mine", vpToken: null },
        80,
      ),
    ).toBe("stored");

    expect(db.select().from(verifierEvents).all()[0]!.vpTokenJson).toBeNull();
  });
});
