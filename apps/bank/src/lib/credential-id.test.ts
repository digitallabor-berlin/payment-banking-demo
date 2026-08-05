import { describe, expect, it } from "vitest";
import { mintCredentialId } from "./credential-id.js";

describe("mintCredentialId", () => {
  it("is prefixed with dpc_", () => {
    expect(mintCredentialId().startsWith("dpc_")).toBe(true);
  });

  it("has 24 characters after the prefix", () => {
    expect(mintCredentialId().slice(4)).toHaveLength(24);
  });

  it("uses only URL-safe base64url characters", () => {
    expect(mintCredentialId()).toMatch(/^dpc_[A-Za-z0-9_-]{24}$/);
  });

  it("is unique across many mints", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => mintCredentialId()));
    expect(seen.size).toBe(2000);
  });
});