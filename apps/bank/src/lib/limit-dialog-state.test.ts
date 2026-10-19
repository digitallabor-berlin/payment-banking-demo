import { describe, expect, it } from "vitest";
import {
  isLimitTerminal,
  limitFailureKey,
  selectLimitPhase,
} from "./limit-dialog-state.js";

describe("selectLimitPhase", () => {
  it("has not started until a session exists", () => {
    expect(selectLimitPhase(null, false, false)).toBe("choose");
  });

  it("leaves the chooser the moment a session exists", () => {
    expect(selectLimitPhase("pending", false, false)).toBe("waiting");
  });

  it("keeps waiting on a verified session until the apply lands", () => {
    // The same trap the login dialog has: success here would claim a limit
    // that is not written yet. The POST to .../apply is what writes it.
    expect(selectLimitPhase("verified", false, false)).toBe("waiting");
  });

  it("promotes to success only once applied", () => {
    expect(selectLimitPhase("verified", true, false)).toBe("success");
  });

  it("lets a successful apply outrank a late poll failure", () => {
    expect(selectLimitPhase("failed", true, true)).toBe("success");
    expect(selectLimitPhase("verified", true, true)).toBe("success");
  });

  it("reports a failed session as an error", () => {
    expect(selectLimitPhase("failed", false, false)).toBe("error");
  });

  it("reports a poll that gave up as an error", () => {
    expect(selectLimitPhase("pending", false, true)).toBe("error");
  });

  it("never returns to choose once a session exists", () => {
    // A dialog that fell back to the chooser mid-flight would offer Continue
    // against a session already in the wallet's hands.
    for (const state of ["pending", "verified", "applied", "failed", "odd"]) {
      expect(selectLimitPhase(state, false, false)).not.toBe("choose");
    }
  });
});

describe("isLimitTerminal", () => {
  it("stops polling on applied, verified and failed", () => {
    expect(isLimitTerminal("applied")).toBe(true);
    // `verified` is terminal even though the flow is not over: the APPLY takes
    // over at that point, and polling on would re-read a row nothing changes.
    expect(isLimitTerminal("verified")).toBe(true);
    expect(isLimitTerminal("failed")).toBe(true);
    expect(isLimitTerminal("pending")).toBe(false);
  });

  it("keeps polling on an unrecognised state", () => {
    // Fails OPEN. An unknown value must not silently end the flow; the
    // client's own timeout is the backstop.
    expect(isLimitTerminal("something_new")).toBe(false);
    expect(isLimitTerminal("")).toBe(false);
  });
});

describe("limitFailureKey", () => {
  it.each([
    ["expired", "expired"],
    ["unknown_credential", "unknownCredential"],
    ["limit_changed", "limitChanged"],
    ["wrong_customer", "verificationFailed"],
    ["transaction_data_binding_failed", "verificationFailed"],
    ["metadata_unavailable", "verificationFailed"],
    ["foundry_unavailable", "verificationFailed"],
    ["verification_failed", "verificationFailed"],
    ["not_verified", "verificationFailed"],
    ["something_new", "verificationFailed"],
    [undefined, "verificationFailed"],
  ])("maps %s to %s", (reason, key) => {
    expect(limitFailureKey(reason)).toBe(key);
  });

  it("names a remedy only for the three the holder can act on", () => {
    // Everything else falls through to the generic message deliberately. A
    // reason the holder cannot act on should not be spelled out to them —
    // wrong_customer in particular tells an attacker their presentation was
    // valid but for the wrong account.
    const named = [
      "expired",
      "unknown_credential",
      "limit_changed",
    ] as const;
    for (const reason of named) {
      expect(limitFailureKey(reason)).not.toBe("verificationFailed");
    }
  });
});