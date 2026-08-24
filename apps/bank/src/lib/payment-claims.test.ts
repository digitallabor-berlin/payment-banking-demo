import { describe, expect, it } from "vitest";
import {
  DPC_CREDENTIAL_TYPE_ID,
  PAYMENT_CREDENTIAL_TYPE_IDS,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  WERO_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";
import { buildPaymentClaims, maskIban } from "./payment-claims.js";

const CARD = { id: "card_anna", network: "girocard" };
const IBAN = "DE02120300000000202051";

const INPUT = {
  card: CARD,
  iban: IBAN,
  joinKey: "join_key_value",
  subjectId: "5f7c2f3e-0a1b-4c2d-8e3f-9a0b1c2d3e4f",
};

describe("maskIban", () => {
  it("keeps the country code and the last four digits, masking the rest", () => {
    expect(maskIban(IBAN)).toBe("DE** **** 2051");
  });

  it("ignores the grouping spaces a printed IBAN carries", () => {
    expect(maskIban("DE02 1203 0000 0000 2020 51")).toBe("DE** **** 2051");
  });

  it("upper-cases the country code", () => {
    expect(maskIban("de02120300000000202051")).toBe("DE** **** 2051");
  });

  it("shows the same four digits the DPC's card.last_four does", () => {
    // One derivation, two credentials: maskIban delegates its tail to
    // ibanLastFour rather than slicing again, so the formats cannot disagree
    // about which digits the holder sees.
    expect(maskIban(IBAN).endsWith("2051")).toBe(true);
  });

  it("throws for an IBAN that does not end in four digits", () => {
    expect(() => maskIban("DE0212030000000020AB")).toThrow(/four digits/);
  });
});

describe("buildPaymentClaims", () => {
  it("gives the DPC exactly the three claims its vct declares", () => {
    expect(buildPaymentClaims(DPC_CREDENTIAL_TYPE_ID, INPUT)).toEqual({
      credential_id: "join_key_value",
      network: "girocard",
      card_id: "card_anna",
    });
  });

  it("gives the Sparkasse card exactly the three claims its vct declares", () => {
    expect(
      buildPaymentClaims(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID, INPUT),
    ).toEqual({
      sub: "5f7c2f3e-0a1b-4c2d-8e3f-9a0b1c2d3e4f",
      masked_iban: "DE** **** 2051",
      psu_id: "join_key_value",
    });
  });

  it("puts the join key in psu_id for the Sparkasse card, not credential_id", () => {
    // The whole reason processPayment needs no second lookup path: whichever
    // claim name a format uses, the value in the row's credential_id column is
    // the one the wallet will disclose.
    const claims = buildPaymentClaims(
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
      INPUT,
    );
    expect(claims.psu_id).toBe("join_key_value");
    expect(claims.credential_id).toBeUndefined();
  });

  it("does not leak a psu_id onto the DPC", () => {
    const claims = buildPaymentClaims(DPC_CREDENTIAL_TYPE_ID, INPUT);
    expect(claims.psu_id).toBeUndefined();
    expect(claims.masked_iban).toBeUndefined();
  });

  it("gives Wero the account-shaped claim set", () => {
    // Wero is account-to-account, so a masked IBAN and a PSU id are the
    // coherent shape — the same one the Sparkasse card declares. This is an
    // assumption about foundry's `wero` type, which declares nothing here yet:
    // see AGENTS.md.
    expect(buildPaymentClaims(WERO_CREDENTIAL_TYPE_ID, INPUT)).toEqual({
      sub: "5f7c2f3e-0a1b-4c2d-8e3f-9a0b1c2d3e4f",
      masked_iban: "DE** **** 2051",
      psu_id: "join_key_value",
    });
  });

  it("gives Wero no card-shaped claim", () => {
    // A card_id or a network on an account-to-account credential would be a
    // claim its vct never declared, which foundry rejects outright — a `failed`
    // row, not a missing field.
    const claims = buildPaymentClaims(WERO_CREDENTIAL_TYPE_ID, INPUT);
    expect(claims.credential_id).toBeUndefined();
    expect(claims.card_id).toBeUndefined();
    expect(claims.network).toBeUndefined();
  });

  it("puts the join key in psu_id for Wero too", () => {
    // Same single-lookup guarantee as the Sparkasse card: whatever the format
    // calls it, the value is the one in the row's credential_id column.
    expect(buildPaymentClaims(WERO_CREDENTIAL_TYPE_ID, INPUT).psu_id).toBe(
      "join_key_value",
    );
  });

  it("never discloses a full IBAN", () => {
    // Asked of every payment type, so a new instrument cannot be added without
    // this negative being asked of it.
    for (const typeId of PAYMENT_CREDENTIAL_TYPE_IDS) {
      const serialized = JSON.stringify(buildPaymentClaims(typeId, INPUT));
      expect(serialized).not.toContain(IBAN);
    }
  });

  it("propagates the IBAN failure for Wero as well", () => {
    expect(() =>
      buildPaymentClaims(WERO_CREDENTIAL_TYPE_ID, {
        ...INPUT,
        iban: "DE0212030000000020AB",
      }),
    ).toThrow(/four digits/);
  });

  it("propagates the IBAN failure for the Sparkasse card", () => {
    // Must throw rather than emit a malformed claim: startIssuance builds
    // claims inside its try, so this degrades to a visible `failed` row exactly
    // as a foundry rejection does.
    expect(() =>
      buildPaymentClaims(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID, {
        ...INPUT,
        iban: "DE0212030000000020AB",
      }),
    ).toThrow(/four digits/);
  });

  it("does not touch the IBAN for the DPC", () => {
    // The DPC's four digits travel in its display metadata, not its claims, so
    // a bad IBAN must not fail here — display-metadata.ts owns that guard.
    expect(() =>
      buildPaymentClaims(DPC_CREDENTIAL_TYPE_ID, {
        ...INPUT,
        iban: "DE0212030000000020AB",
      }),
    ).not.toThrow();
  });
});
