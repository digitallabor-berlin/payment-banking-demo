import { describe, expect, it } from "vitest";
import {
  isLoginTerminal,
  loginFailureKey,
  selectLoginAffordance,
  selectLoginPhase,
  showsQr,
  showsWalletButton,
  type LoginAffordance,
} from "./login-dialog-state.js";

/** Every value the affordance can take, so the invariants below are total. */
const ALL_AFFORDANCES: LoginAffordance[] = [
  "preparing",
  "dc-api",
  "deep-link",
  "qr",
];

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

/*
 * `pointer: coarse` cannot answer "is a wallet installed on this device", and
 * no browser API can. The old rendering treated the button and the QR as
 * mutually exclusive branches, so touch got the deep link and NOTHING else.
 * Reported from a real iPad: the button opened `openid4vp://`, which no iPad
 * app claims, and there was no QR anywhere to fall back to.
 */
describe("showsWalletButton / showsQr", () => {
  it("offers the wallet button on touch only", () => {
    expect(showsWalletButton("deep-link")).toBe(true);
    expect(showsWalletButton("qr")).toBe(false);
  });

  it("offers the QR on touch as well as on a pointer device", () => {
    // This is the whole fix: "deep-link" used to exclude the QR.
    expect(showsQr("deep-link")).toBe(true);
    expect(showsQr("qr")).toBe(true);
  });

  it("offers neither while preparing", () => {
    // `null` detection is "not yet known". Drawing either here flashes it on
    // Android before it disappears.
    expect(showsWalletButton("preparing")).toBe(false);
    expect(showsQr("preparing")).toBe(false);
  });

  it("offers neither during a DC API handover", () => {
    // A DC API session inlines its request object and has no URI at all, so
    // both a link and a QR would be drawn over an empty string.
    expect(showsWalletButton("dc-api")).toBe(false);
    expect(showsQr("dc-api")).toBe(false);
  });

  it("NEVER offers the wallet button without a QR beside it", () => {
    // The invariant the iPad bug violated. Narrowing `showsQr` back to
    // `a === "qr"` fails here rather than only in a browser.
    for (const affordance of ALL_AFFORDANCES) {
      if (showsWalletButton(affordance)) {
        expect(showsQr(affordance)).toBe(true);
      }
    }
  });

  it("agrees with selectLoginAffordance that touch gets both", () => {
    const affordance = selectLoginAffordance(false, null, true);
    expect(showsWalletButton(affordance)).toBe(true);
    expect(showsQr(affordance)).toBe(true);
  });

  it("agrees that a pointer device gets the QR alone", () => {
    const affordance = selectLoginAffordance(false, null, false);
    expect(showsWalletButton(affordance)).toBe(false);
    expect(showsQr(affordance)).toBe(true);
  });
});