import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseVerifierEvent, verifyWebhookSignature } from "./verifier-events.js";

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
    expect(verifyWebhookSignature('{"a":2}', sign('{"a":1}'), SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });

  it("rejects an absent header", () => {
    expect(verifyWebhookSignature('{"a":1}', null, SECRET)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = '{"a":1}';
    expect(verifyWebhookSignature(body, sign(body).slice(7), SECRET)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual throws on a length mismatch; the wrapper must not.
    expect(verifyWebhookSignature('{"a":1}', "sha256=beef", SECRET)).toBe(false);
  });

  it("rejects a header that is not hex", () => {
    expect(verifyWebhookSignature('{"a":1}', `sha256=${"z".repeat(64)}`, SECRET)).toBe(
      false,
    );
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
    ).toEqual({ event: "verification_completed", txId: "ver_1", vpToken: null });
  });

  it("ignores an event type it does not know", () => {
    // Forward compatibility: a later foundry may add events. An unknown one is
    // not an error, it is not ours.
    expect(parseVerifierEvent({ event: "something_new", tx_id: "ver_1" })).toBeNull();
  });

  it("rejects a body with no tx_id", () => {
    expect(
      parseVerifierEvent({ event: "verification_completed", state: "verified" }),
    ).toBeNull();
  });

  it("rejects a non-object body", () => {
    expect(parseVerifierEvent("nope")).toBeNull();
    expect(parseVerifierEvent(null)).toBeNull();
  });
});