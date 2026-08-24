import { describe, expect, it } from "vitest";
import {
  AGE_RESTRICTED_PRODUCT_IDS,
  buildTransactionData,
  isAgeRestricted,
  selectNamedQuery,
} from "./dcql.js";

describe("isAgeRestricted", () => {
  it("is true for exactly the three restricted products", () => {
    for (const id of ["beer", "wine", "aperitif"]) {
      expect(isAgeRestricted(id)).toBe(true);
    }
  });

  it("is false for every other seeded product", () => {
    const ordinary = [
      "tomatoes",
      "avocado",
      "berries",
      "sourdough",
      "milk",
      "yogurt",
      "cheese",
      "pasta",
      "olive-oil",
      "chocolate",
      "chips",
      "water",
    ];
    for (const id of ordinary) {
      expect(isAgeRestricted(id)).toBe(false);
    }
  });

  it("agrees with selectNamedQuery — one source of truth", () => {
    // The shelf tag and the payment -> payment_av escalation must never
    // disagree.
    for (const id of ["beer", "wine", "aperitif", "cheese", "water"]) {
      expect(selectNamedQuery([id]) === "payment_av").toBe(isAgeRestricted(id));
    }
  });
});

describe("selectNamedQuery", () => {
  it("asks for payment when nothing in the basket is age-restricted", () => {
    expect(selectNamedQuery(["cheese", "berries", "water"])).toBe("payment");
  });

  it("asks for payment_av when the basket contains lager", () => {
    expect(selectNamedQuery(["cheese", "beer"])).toBe("payment_av");
  });

  it("asks for payment_av when the basket contains riesling", () => {
    expect(selectNamedQuery(["wine"])).toBe("payment_av");
  });

  it("asks for payment_av when the basket contains the aperitif", () => {
    expect(selectNamedQuery(["aperitif", "chips"])).toBe("payment_av");
  });

  it("asks for payment for an empty basket", () => {
    // Not a real checkout — createOrder rejects an empty cart — but the
    // fail-safe direction here is the *narrower* query, never the broader one.
    expect(selectNamedQuery([])).toBe("payment");
  });

  it("names exactly the three restricted products", () => {
    expect([...AGE_RESTRICTED_PRODUCT_IDS].sort()).toEqual([
      "aperitif",
      "beer",
      "wine",
    ]);
  });
});

const payment = {
  transactionId: "sess_1234567890",
  amountCents: 59_268,
  payeeName: "Rock Legends",
  payeeId: "Payee-id-123",
};

describe("buildTransactionData", () => {
  it("emits the urn:eudi:sca:payment:1 entry foundry expects", () => {
    expect(buildTransactionData(payment)).toEqual([
      {
        type: "urn:eudi:sca:payment:1",
        credential_ids: ["dpc", "sparkassencard"],
        transaction_data_hashes_alg: ["sha-256"],
        payload: {
          payee: { name: "Rock Legends", id: "Payee-id-123" },
          transaction_id: "sess_1234567890",
          amount_display: "€ 592.68",
        },
      },
    ]);
  });

  it("binds to both payment credentials and to neither age credential", () => {
    // `payment` and `payment_av` both declare `dpc` and `sparkassencard` as the
    // two options of one required credential_set, and the holder picks which to
    // answer with. Naming only one would leave the amount unbound whenever the
    // wallet answered with the other. `payment_av`'s `av_sdjwt`/`av_mdoc` are
    // deliberately absent: an age attestation is not what moves money.
    const [entry] = buildTransactionData(payment) as Array<{
      credential_ids: string[];
    }>;
    expect(entry?.credential_ids).toEqual(["dpc", "sparkassencard"]);
  });

  it("renders a whole-euro amount without dropping decimals", () => {
    const [entry] = buildTransactionData({
      ...payment,
      amountCents: 5_000,
    }) as Array<{
      payload: { amount_display: string };
    }>;
    expect(entry?.payload.amount_display).toBe("€ 50.00");
  });

  it("renders sub-euro amounts with a leading zero", () => {
    const [entry] = buildTransactionData({
      ...payment,
      amountCents: 89,
    }) as Array<{
      payload: { amount_display: string };
    }>;
    expect(entry?.payload.amount_display).toBe("€ 0.89");
  });

  it("never localizes the amount — no thousands separator, always a dot", () => {
    // This string is hashed into transaction_data_hashes, so it has to be
    // byte-identical on every host regardless of ICU locale data.
    const [entry] = buildTransactionData({
      ...payment,
      amountCents: 1_234_567,
    }) as Array<{
      payload: { amount_display: string };
    }>;
    expect(entry?.payload.amount_display).toBe("€ 12345.67");
  });
});
