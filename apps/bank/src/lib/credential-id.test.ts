import { describe, expect, it } from "vitest";
import {
  DPC_CREDENTIAL_TYPE_ID,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";
import { mintCredentialId, mintJoinKey } from "./credential-id.js";

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

describe("mintJoinKey", () => {
  it("keeps the prefixed opaque form for the DPC's credential_id", () => {
    expect(mintJoinKey(DPC_CREDENTIAL_TYPE_ID)).toMatch(
      /^dpc_[A-Za-z0-9_-]{24}$/,
    );
  });

  it("mints a bare UUID for the Sparkasse card's psu_id", () => {
    // The vct declares psu_id as a UUID; a `dpc_` prefix would be malformed.
    expect(mintJoinKey(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("is unique across many mints for either format", () => {
    const seen = new Set([
      ...Array.from({ length: 500 }, () => mintJoinKey(DPC_CREDENTIAL_TYPE_ID)),
      ...Array.from({ length: 500 }, () =>
        mintJoinKey(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID),
      ),
    ]);
    expect(seen.size).toBe(1000);
  });
});