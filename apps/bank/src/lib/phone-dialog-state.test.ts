import { describe, expect, it } from "vitest";
import {
  canSubmitPhone,
  isPhoneTerminal,
  phoneFailureKey,
  selectPhonePhase,
} from "./phone-dialog-state.js";

describe("isPhoneTerminal", () => {
  it("stops on verified, applied and failed", () => {
    expect(isPhoneTerminal("verified")).toBe(true);
    expect(isPhoneTerminal("applied")).toBe(true);
    expect(isPhoneTerminal("failed")).toBe(true);
  });

  it("keeps polling on pending", () => {
    expect(isPhoneTerminal("pending")).toBe(false);
  });

  it("keeps polling on an unrecognised state", () => {
    // Fails OPEN: an unknown value keeps polling rather than silently ending
    // the flow, and the client's own timeout is the backstop.
    expect(isPhoneTerminal("")).toBe(false);
    expect(isPhoneTerminal("whatever")).toBe(false);
  });
});

describe("selectPhonePhase", () => {
  it("shows the form before a session exists", () => {
    expect(selectPhonePhase(null, false, false)).toBe("form");
  });

  /**
   * The limit change shipped this bug once: checking `state === null` first
   * made a failed start re-render the form with no message anywhere — and
   * locally that is EVERY attempt, since no local foundry declares
   * `sparkassen_auth`.
   */
  it("puts startFailed AHEAD of the null check", () => {
    expect(selectPhonePhase(null, false, true)).toBe("error");
  });

  it("waits while the session is pending", () => {
    expect(selectPhonePhase("pending", false, false)).toBe("waiting");
  });

  it("keeps verified on waiting, not success", () => {
    // No number changes until the apply POST returns 2xx, and apply can still
    // refuse with phone_changed.
    expect(selectPhonePhase("verified", false, false)).toBe("waiting");
  });

  it("shows success only once applied", () => {
    expect(selectPhonePhase("applied", false, false)).toBe("waiting");
    expect(selectPhonePhase("verified", true, false)).toBe("success");
  });

  it("shows error on a failed session", () => {
    expect(selectPhonePhase("failed", false, false)).toBe("error");
  });

  it("lets a successful apply outrank a late poll failure", () => {
    expect(selectPhonePhase("failed", true, true)).toBe("success");
  });
});

describe("phoneFailureKey", () => {
  it("maps expired, unknown_credential, phone_changed, invalid_phone, phone_unchanged", () => {
    expect(phoneFailureKey("expired")).toBe("expired");
    expect(phoneFailureKey("unknown_credential")).toBe("unknownCredential");
    expect(phoneFailureKey("phone_changed")).toBe("phoneChanged");
    expect(phoneFailureKey("invalid_phone")).toBe("invalidPhone");
    expect(phoneFailureKey("phone_unchanged")).toBe("phoneUnchanged");
  });

  /**
   * Spelling `wrong_customer` out would tell whoever is holding the phone that
   * their presentation was valid but for somebody else's account.
   */
  it("falls wrong_customer through to the generic message", () => {
    expect(phoneFailureKey("wrong_customer")).toBe("verificationFailed");
  });

  it("falls metadata_unavailable and undefined through to the generic message", () => {
    expect(phoneFailureKey("metadata_unavailable")).toBe("verificationFailed");
    expect(phoneFailureKey("foundry_unavailable")).toBe("verificationFailed");
    expect(phoneFailureKey("transaction_data_binding_failed")).toBe(
      "verificationFailed",
    );
    expect(phoneFailureKey(undefined)).toBe("verificationFailed");
  });
});

describe("canSubmitPhone", () => {
  const current = "+49 171 5555555";

  it("accepts a different, well-formed number", () => {
    expect(canSubmitPhone("+49 172 66666666", current)).toBe(true);
  });

  it("refuses the number already in force, in any format", () => {
    expect(canSubmitPhone(current, current)).toBe(false);
    expect(canSubmitPhone("+491715555555", current)).toBe(false);
    expect(canSubmitPhone("  +49 171  5555555 ", current)).toBe(false);
  });

  it("refuses an empty or malformed entry", () => {
    expect(canSubmitPhone("", current)).toBe(false);
    expect(canSubmitPhone("   ", current)).toBe(false);
    expect(canSubmitPhone("0172 66666666", current)).toBe(false);
    expect(canSubmitPhone("+49 172 ABCDEFG", current)).toBe(false);
  });
});