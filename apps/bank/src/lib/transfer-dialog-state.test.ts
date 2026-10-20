import { describe, expect, it } from "vitest";
import {
  isTransferTerminal,
  selectTransferPhase,
  transferFailureKey,
} from "./transfer-dialog-state.js";

describe("isTransferTerminal", () => {
  it("stops on verified, applied and failed", () => {
    // `verified` counts as terminal even though the flow is not over: the
    // APPLY takes over there, and polling on would only re-read a row nothing
    // will change until that POST lands.
    for (const state of ["verified", "applied", "failed"]) {
      expect(isTransferTerminal(state)).toBe(true);
    }
  });

  it("keeps polling on pending and on anything unrecognised", () => {
    // Fails OPEN: an unknown value keeps polling rather than silently ending
    // the flow, and the client's own timeout is the backstop.
    for (const state of ["pending", "", "nonsense", "APPLIED"]) {
      expect(isTransferTerminal(state)).toBe(false);
    }
  });
});

describe("selectTransferPhase", () => {
  it("shows the form before a session exists", () => {
    expect(selectTransferPhase(null, false, false)).toBe("form");
  });

  it("shows error for a FAILED START, not the form again", () => {
    // The bug the limit change shipped once: checking `state === null` first
    // made a failed start render the chooser again — the holder pressed Send,
    // the button greyed out for a moment and came back, with no message
    // anywhere. That is EVERY local attempt, since no local foundry declares
    // `sparkassen_auth`.
    expect(selectTransferPhase(null, false, true)).toBe("error");
  });

  it("shows error on a failed session", () => {
    expect(selectTransferPhase("failed", false, false)).toBe("error");
  });

  it("waits while the session is pending", () => {
    expect(selectTransferPhase("pending", false, false)).toBe("waiting");
  });

  it("keeps verified on waiting — the money is not moved until apply returns", () => {
    // Showing success on `verified` would tell the holder money had moved
    // when the debit has not been written. `applied` is the APPLY's answer,
    // not the poll's.
    expect(selectTransferPhase("verified", false, false)).toBe("waiting");
  });

  it("shows success only once applied", () => {
    expect(selectTransferPhase("verified", true, false)).toBe("success");
    expect(selectTransferPhase("applied", true, false)).toBe("success");
  });

  it("lets a successful apply outrank a late poll failure", () => {
    // The money is already gone. A late failure cannot un-debit it.
    expect(selectTransferPhase("failed", true, true)).toBe("success");
  });
});

describe("transferFailureKey", () => {
  it("names the four reasons a holder can act on", () => {
    expect(transferFailureKey("expired")).toBe("expired");
    expect(transferFailureKey("unknown_credential")).toBe("unknownCredential");
    expect(transferFailureKey("limit_exceeded")).toBe("limitExceeded");
    expect(transferFailureKey("insufficient_funds")).toBe("insufficientFunds");
  });

  it("falls everything else through to verificationFailed", () => {
    // `wrong_customer` in particular must NOT be spelled out: it would tell
    // whoever is holding the phone that their presentation was valid but for
    // somebody else's account.
    for (const reason of [
      "wrong_customer",
      "metadata_unavailable",
      "transaction_data_binding_failed",
      "foundry_unavailable",
      "verification_failed",
      "invalid_request",
      undefined,
      "nonsense",
    ]) {
      expect(transferFailureKey(reason)).toBe("verificationFailed");
    }
  });
});