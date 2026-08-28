import { describe, expect, it } from "vitest";
import { PROOF_GRACE_MS, shouldWaitForProof } from "./proof-wait.js";

describe("shouldWaitForProof", () => {
  it("does not wait once the package is here", () => {
    expect(shouldWaitForProof(true, 1_000, 1_000)).toBe(false);
  });

  it("waits while the package is missing and the window is open", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS - 1)).toBe(
      true,
    );
  });

  it("stops waiting exactly at the boundary", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS)).toBe(
      false,
    );
  });

  it("stops waiting after the window", () => {
    expect(shouldWaitForProof(false, 1_000, 1_000 + PROOF_GRACE_MS + 1)).toBe(
      false,
    );
  });

  it("does not wait when there is no verified_at to measure from", () => {
    // Fail FORWARD. A row written before this column existed, or by a path that
    // never set it, has no window — and stalling a payment forever is a far
    // worse failure than settling without a proof package.
    expect(shouldWaitForProof(false, null, 999_999)).toBe(false);
  });

  it("does not wait when the clock appears to have gone backwards", () => {
    expect(shouldWaitForProof(false, 5_000, 1_000)).toBe(false);
  });

  it("has a grace window of six seconds", () => {
    // Pinned deliberately: three of the browser's ~2s polls. A reviewer
    // changing this should have to change a test that says why.
    expect(PROOF_GRACE_MS).toBe(6_000);
  });
});
