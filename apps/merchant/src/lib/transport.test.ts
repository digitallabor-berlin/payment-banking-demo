import { describe, expect, it } from "vitest";
import { selectTransport } from "./transport.js";

describe("selectTransport", () => {
  it("chooses dc_api when the browser supports it", () => {
    expect(selectTransport(true)).toBe("dc_api");
  });

  it("chooses request_uri when the browser does not", () => {
    expect(selectTransport(false)).toBe("request_uri");
  });

  // `null` means detection has not resolved yet. Falling back to the QR
  // transport is the safe answer: it works everywhere.
  it("chooses request_uri when support is still unknown", () => {
    expect(selectTransport(null)).toBe("request_uri");
  });
});