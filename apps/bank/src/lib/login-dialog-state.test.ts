import { describe, expect, it } from "vitest";
import {
  isLoginTerminal,
  loginFailureKey,
  selectLoginAffordance,
  selectLoginPhase,
} from "./login-dialog-state.js";

describe("isLoginTerminal", () => {
  it("treats verified as terminal — the poll's job ends there", () => {
    // `verified` stops the poll because the CLAIM takes over from that point.
    // Polling on would just re-read a row nothing will change.
    expect(isLoginTerminal("verified")).toBe(true);
  });

  it("treats failed and consumed as terminal", () => {
    expect(isLoginTerminal("failed")).toBe(true);
    expect(isLoginTerminal("consumed")).toBe(true);
  });

  it("keeps polling while pending", () => {
    expect(isLoginTerminal("pending")).toBe(false);
  });

  it("keeps polling on a state it does not recognise", () => {
    // Fail open here, not closed: an unknown state must not silently end the
    // flow. The poll's own timeout is the backstop.
    expect(isLoginTerminal("something-new")).toBe(false);
  });
});

describe("selectLoginAffordance", () => {
  it("shows preparing while detection is unresolved", () => {
    // null is "not yet known". Rendering the QR here flashes it on Android.
    expect(selectLoginAffordance(null, null, false)).toBe("preparing");
    expect(selectLoginAffordance(null, null, true)).toBe("preparing");
  });

  it("offers the DC API button when the browser supports it", () => {
    expect(selectLoginAffordance(true, null, false)).toBe("dc-api");
  });

  it("falls back to the deep link on touch once the DC API failed", () => {
    expect(selectLoginAffordance(true, "failed", true)).toBe("deep-link");
    expect(selectLoginAffordance(true, "unsupported", true)).toBe("deep-link");
  });

  it("falls back to the QR on desktop once the DC API failed", () => {
    expect(selectLoginAffordance(true, "failed", false)).toBe("qr");
  });

  it("uses the deep link on touch without the DC API", () => {
    // The wallet is on this same phone, so a QR nobody can scan is useless.
    expect(selectLoginAffordance(false, null, true)).toBe("deep-link");
  });

  it("uses the QR on desktop without the DC API", () => {
    expect(selectLoginAffordance(false, null, false)).toBe("qr");
  });
});

describe("selectLoginPhase", () => {
  it("waits while pending", () => {
    expect(selectLoginPhase("pending", false, false)).toBe("waiting");
  });

  it("waits while verified but not yet claimed", () => {
    // The claim is in flight. Showing success before the cookie exists would
    // navigate to a page that redirects straight back to /login.
    expect(selectLoginPhase("verified", false, false)).toBe("waiting");
  });

  it("succeeds once the claim returned a cookie", () => {
    expect(selectLoginPhase("verified", true, false)).toBe("success");
  });

  it("errors on a failed session", () => {
    expect(selectLoginPhase("failed", false, false)).toBe("error");
  });

  it("errors when the poll itself gave up", () => {
    expect(selectLoginPhase("pending", false, true)).toBe("error");
  });

  it("waits when nothing is known yet", () => {
    expect(selectLoginPhase(null, false, false)).toBe("waiting");
  });

  it("prefers success over a poll failure", () => {
    // A claim that already succeeded must not be undone by a late poll error.
    expect(selectLoginPhase("verified", true, true)).toBe("success");
  });
});

describe("loginFailureKey", () => {
  it("maps expired", () => {
    expect(loginFailureKey("expired")).toBe("expired");
  });

  it("maps unknown_credential", () => {
    expect(loginFailureKey("unknown_credential")).toBe("unknownCredential");
  });

  it("maps verification_failed", () => {
    expect(loginFailureKey("verification_failed")).toBe("verificationFailed");
  });

  it("maps foundry_unavailable to the generic failure", () => {
    expect(loginFailureKey("foundry_unavailable")).toBe("verificationFailed");
  });

  it("falls back to the generic failure for an unknown reason", () => {
    expect(loginFailureKey("brand_new_reason")).toBe("verificationFailed");
    expect(loginFailureKey(undefined)).toBe("verificationFailed");
  });
});