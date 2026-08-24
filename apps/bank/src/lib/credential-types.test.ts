import { describe, expect, it } from "vitest";
import {
  AGE_CREDENTIAL_TYPE_IDS,
  AV_CREDENTIAL_TYPE_ID,
  AV_GOOGLE_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
  PAYMENT_CREDENTIAL_TYPE_IDS,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  isAgeCredentialType,
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

  it("spells the age credential's EUDI format 'av-sparkasse'", () => {
    expect(AV_CREDENTIAL_TYPE_ID).toBe("av-sparkasse");
  });

  it("spells the age credential's Google Wallet format as the bare 'av' profile", () => {
    expect(AV_GOOGLE_CREDENTIAL_TYPE_ID).toBe("av");
  });

  it("keeps the two age formats distinct", () => {
    // They are two credential types on foundry's side, not one id spelled two
    // ways, which is what makes per-format tile state meaningful at all.
    expect(AV_CREDENTIAL_TYPE_ID).not.toBe(AV_GOOGLE_CREDENTIAL_TYPE_ID);
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

  it("rejects the age credential's Google Wallet format too", () => {
    expect(isPaymentCredentialType(AV_GOOGLE_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects an id this bank does not issue", () => {
    expect(isPaymentCredentialType("com.example.other")).toBe(false);
  });
});

describe("isAgeCredentialType", () => {
  it("lists exactly the two age formats, EUDI first", () => {
    // The order is the order the tile presents them in: the bank's own EUDI
    // button, then the Google Wallet badge.
    expect([...AGE_CREDENTIAL_TYPE_IDS]).toEqual([
      AV_CREDENTIAL_TYPE_ID,
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    ]);
  });

  it("accepts the EUDI age format", () => {
    expect(isAgeCredentialType(AV_CREDENTIAL_TYPE_ID)).toBe(true);
  });

  it("accepts the Google Wallet age format", () => {
    expect(isAgeCredentialType(AV_GOOGLE_CREDENTIAL_TYPE_ID)).toBe(true);
  });

  it("rejects both payment formats — a card is not an age attestation", () => {
    expect(isAgeCredentialType(DPC_CREDENTIAL_TYPE_ID)).toBe(false);
    expect(isAgeCredentialType(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects the mdoc docType, which is foundry's own name and not an id", () => {
    expect(isAgeCredentialType("eu.europa.ec.av.1")).toBe(false);
  });

  it("shares no id with the payment types", () => {
    // The two predicates gate different capabilities — one of them authorizes
    // money to move — so an id answering true to both would be a defect.
    for (const typeId of AGE_CREDENTIAL_TYPE_IDS) {
      expect(isPaymentCredentialType(typeId)).toBe(false);
    }
    for (const typeId of PAYMENT_CREDENTIAL_TYPE_IDS) {
      expect(isAgeCredentialType(typeId)).toBe(false);
    }
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
