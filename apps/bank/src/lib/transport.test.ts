import { describe, expect, it } from "vitest";
import { selectTransport } from "./transport.js";

describe("selectTransport", () => {
  it("asks for dc_api when the browser supports it", () => {
    expect(selectTransport(true)).toBe("dc_api");
  });

  it("asks for request_uri when the browser does not", () => {
    expect(selectTransport(false)).toBe("request_uri");
  });

  it("asks for request_uri while detection is still unresolved", () => {
    // null is "not yet known", NOT "unavailable". The QR transport is the safe
    // default because it works in every browser.
    expect(selectTransport(null)).toBe("request_uri");
  });
});