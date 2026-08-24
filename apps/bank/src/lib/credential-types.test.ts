import { describe, expect, it } from "vitest";
import {
  AGE_CREDENTIAL_TYPE_IDS,
  AV_CREDENTIAL_TYPE_ID,
  AV_GOOGLE_CREDENTIAL_TYPE_ID,
  CARD_FORMAT_TYPE_IDS,
  DPC_CREDENTIAL_TYPE_ID,
  PAYMENT_CREDENTIAL_TYPE_IDS,
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  WERO_CREDENTIAL_TYPE_ID,
  isAgeCredentialType,
  isAuthenticatorCredentialType,
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

  it("spells the Wero credential as foundry's admin API names it", () => {
    expect(WERO_CREDENTIAL_TYPE_ID).toBe("wero");
  });

  it("spells the Sparkassen Authenticator with an underscore, as foundry's admin API names it", () => {
    // Not `sparkassen-auth` and not `sparkassenauth`. Every other id in this
    // module is either dotted or a bare word, so the underscore is the one
    // thing about this spelling nothing else here would predict.
    expect(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID).toBe("sparkassen_auth");
  });
});

describe("CARD_FORMAT_TYPE_IDS", () => {
  /**
   * The girocard's formats, which is a strictly narrower question than "what
   * can pay". Wero is payable but it is not a format of the girocard, and
   * conflating the two would make the card tile's face read "In wallet"
   * because a Wero credential exists.
   */
  it("lists exactly the two girocard formats", () => {
    expect([...CARD_FORMAT_TYPE_IDS]).toEqual([
      DPC_CREDENTIAL_TYPE_ID,
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
    ]);
  });

  it("excludes Wero, which is payable but is not the girocard", () => {
    expect([...CARD_FORMAT_TYPE_IDS]).not.toContain(WERO_CREDENTIAL_TYPE_ID);
  });

  it("excludes the authenticator, which is not a card in any sense", () => {
    // Scoping `listCards` to this list is what keeps the girocard's face from
    // reading "In wallet" because some other credential exists. The
    // authenticator has no card behind it at all, so its presence here would
    // be doubly wrong.
    expect([...CARD_FORMAT_TYPE_IDS]).not.toContain(
      SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
    );
  });

  it("is a subset of the payment types", () => {
    // Every format of the card must be spendable. The reverse does not hold.
    for (const typeId of CARD_FORMAT_TYPE_IDS) {
      expect(isPaymentCredentialType(typeId)).toBe(true);
    }
  });
});

describe("isPaymentCredentialType", () => {
  it("lists the two card formats and Wero as payment types", () => {
    // Order is the order each is presented: the girocard's two formats on the
    // card tile, then Wero on its own.
    expect([...PAYMENT_CREDENTIAL_TYPE_IDS]).toEqual([
      DPC_CREDENTIAL_TYPE_ID,
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
      WERO_CREDENTIAL_TYPE_ID,
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

  it("accepts the Wero credential", () => {
    // This is what lets `processPayment` debit against a Wero credential. It is
    // not a girocard format, but it is money.
    expect(isPaymentCredentialType(WERO_CREDENTIAL_TYPE_ID)).toBe(true);
  });

  it("rejects the age credential — an attestation is not a payment instrument", () => {
    expect(isPaymentCredentialType(AV_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects the age credential's Google Wallet format too", () => {
    expect(isPaymentCredentialType(AV_GOOGLE_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects the authenticator — proving who you are is not authorizing a debit", () => {
    // This is the guard `processPayment` reads. An authenticator credential
    // that answered true here could move money, which is precisely what it
    // must never be able to do.
    expect(isPaymentCredentialType(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID)).toBe(
      false,
    );
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

  it("rejects every payment type — money is not an age attestation", () => {
    expect(isAgeCredentialType(DPC_CREDENTIAL_TYPE_ID)).toBe(false);
    expect(isAgeCredentialType(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)).toBe(false);
    expect(isAgeCredentialType(WERO_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("rejects the authenticator, which attests identity rather than an age", () => {
    expect(isAgeCredentialType(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID)).toBe(false);
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

describe("isAuthenticatorCredentialType", () => {
  /**
   * The third predicate, and the third disjoint capability: this one gates
   * neither money nor an age claim. It exists as a named predicate rather than
   * an inline `=== "sparkassen_auth"` for the same reason the other two do —
   * the comparison has to be identical everywhere it is asked.
   */
  it("accepts the Sparkassen Authenticator", () => {
    expect(
      isAuthenticatorCredentialType(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID),
    ).toBe(true);
  });

  it("rejects every payment type", () => {
    for (const typeId of PAYMENT_CREDENTIAL_TYPE_IDS) {
      expect(isAuthenticatorCredentialType(typeId)).toBe(false);
    }
  });

  it("rejects both age formats", () => {
    for (const typeId of AGE_CREDENTIAL_TYPE_IDS) {
      expect(isAuthenticatorCredentialType(typeId)).toBe(false);
    }
  });

  it("rejects an id this bank does not issue", () => {
    expect(isAuthenticatorCredentialType("com.example.other")).toBe(false);
  });

  it("is disjoint from both other predicates in both directions", () => {
    // Three predicates, three capabilities, no overlap. An id answering true
    // to two of them would let one credential do another's job — and one of
    // those jobs is spending money.
    expect(isPaymentCredentialType(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID)).toBe(
      false,
    );
    expect(isAgeCredentialType(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID)).toBe(false);
    for (const typeId of [
      ...PAYMENT_CREDENTIAL_TYPE_IDS,
      ...AGE_CREDENTIAL_TYPE_IDS,
    ]) {
      expect(isAuthenticatorCredentialType(typeId)).toBe(false);
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

  it("is false for the Wero credential", () => {
    // Same reason, and it is worth pinning per type rather than trusting the
    // negation: the cost of getting it wrong is a `failed` issuance row.
    expect(sendsDpcDisplayMetadata(WERO_CREDENTIAL_TYPE_ID)).toBe(false);
  });

  it("is false for every payment type except the DPC", () => {
    for (const typeId of PAYMENT_CREDENTIAL_TYPE_IDS) {
      expect(sendsDpcDisplayMetadata(typeId)).toBe(
        typeId === DPC_CREDENTIAL_TYPE_ID,
      );
    }
  });
});
