import { describe, expect, it } from "vitest";
import {
  DPC_CREDENTIAL_TYPE_ID,
  PAYMENT_CREDENTIAL_TYPE_IDS,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  WERO_CREDENTIAL_TYPE_ID,
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
    const seen = new Set(
      Array.from({ length: 2000 }, () => mintCredentialId()),
    );
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

  it("mints a bare UUID for Wero's psu_id", () => {
    // Wero reuses the Sparkasse card's claim set, so its join key travels as a
    // `psu_id` and must be a UUID for the same reason: a `dpc_` prefix would be
    // both malformed and a lie about which credential minted it.
    expect(mintJoinKey(WERO_CREDENTIAL_TYPE_ID)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("gives the opaque prefixed form to the DPC alone", () => {
    // Asked of every payment type rather than of the two named ones, so a
    // future instrument cannot quietly inherit the DPC's shape.
    for (const typeId of PAYMENT_CREDENTIAL_TYPE_IDS) {
      expect(mintJoinKey(typeId).startsWith("dpc_")).toBe(
        typeId === DPC_CREDENTIAL_TYPE_ID,
      );
    }
  });

  it("is unique across many mints for every format", () => {
    const seen = new Set(
      PAYMENT_CREDENTIAL_TYPE_IDS.flatMap((typeId) =>
        Array.from({ length: 500 }, () => mintJoinKey(typeId)),
      ),
    );
    expect(seen.size).toBe(500 * PAYMENT_CREDENTIAL_TYPE_IDS.length);
  });
});
