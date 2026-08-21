import { describe, expect, it } from "vitest";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
  PAYMENT_CREDENTIAL_TYPE_IDS,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  isPaymentCredentialType,
  sendsDpcDisplayMetadata,
} from "./credential-types.js";

describe("credential type ids", () => {
  it("spells the EMVCo payment credential as foundry's admin API names it", () => {
    expect(DPC_CREDENTIAL_TYPE_ID).toBe("com.emvco.dpc.card");
  });

  it("spells the Sparkasse card credential as foundry's admin API names it", () => {
    expect(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID).toBe("sparkassencard");
  });

  it("spells the age credential 'av-sparkasse', not the bare 'av' it replaced", () => {
    expect(AV_CREDENTIAL_TYPE_ID).toBe("av-sparkasse");
  });
});

describe("isPaymentCredentialType", () => {
  it("lists exactly the two card formats as payment types", () => {
    expect([...PAYMENT_CREDENTIAL_TYPE_IDS]).toEqual([
      DPC_CREDENTIAL_TYPE_ID,
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
    ]);
  });

  it("accepts the EMVCo payment credential", () => {
    expect(isPaymentCredentialType(DPC_CREDENTIAL_TYPE_ID)).toBe(true);
  });

  it("accepts the Sparkasse card credential", () => {
    expect(isPaymentCredentialType(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)).toBe(
      true,
    );
  });

  it("rejects the age credential — an attestation is not a payment instrument", () => {
    expect(isPaymentCredentialType(AV_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects the legacy 'av' rows the column can still hold", () => {
    expect(isPaymentCredentialType("av")).toBe(false);
  });

  it("rejects an id this bank does not issue", () => {
    expect(isPaymentCredentialType("com.example.other")).toBe(false);
  });
});

describe("sendsDpcDisplayMetadata", () => {
  /**
   * foundry gates `offer_display` and `credential_response_display` on the
   * resolved type's vct and REJECTS them for anything else, which lands as a
   * `failed` row rather than a card missing its artwork. `sparkassencard`
   * resolves to `https://creds.digitallabor.dev/vct/sparkassencard`, so it must
   * send neither field.
   */
  it("is true for the EMVCo payment credential", () => {
    expect(sendsDpcDisplayMetadata(DPC_CREDENTIAL_TYPE_ID)).toBe(true);
  });

  it("is false for the Sparkasse card credential", () => {
    expect(sendsDpcDisplayMetadata(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)).toBe(
      false,
    );
  });
});
