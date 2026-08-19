import { describe, expect, it } from "vitest";
import {
  AGE_RESTRICTED_PRODUCT_IDS,
  buildTransactionData,
  selectNamedQuery,
} from "./dcql.js";

describe("selectNamedQuery", () => {
  it("asks for dpc when nothing in the basket is age-restricted", () => {
    expect(selectNamedQuery(["cheese", "berries", "water"])).toBe("dpc");
  });

  it("asks for dpc_av when the basket contains lager", () => {
    expect(selectNamedQuery(["cheese", "beer"])).toBe("dpc_av");
  });

  it("asks for dpc_av when the basket contains riesling", () => {
    expect(selectNamedQuery(["wine"])).toBe("dpc_av");
  });

  it("asks for dpc_av when the basket contains the aperitif", () => {
    expect(selectNamedQuery(["aperitif", "chips"])).toBe("dpc_av");
  });

  it("asks for dpc for an empty basket", () => {
    // Not a real checkout — createOrder rejects an empty cart — but the
    // fail-safe direction here is the *narrower* query, never the broader one.
    expect(selectNamedQuery([])).toBe("dpc");
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
        credential_ids: ["dpc"],
        transaction_data_hashes_alg: ["sha-256"],
        payload: {
          payee: { name: "Rock Legends", id: "Payee-id-123" },
          transaction_id: "sess_1234567890",
          amount_display: "€ 592.68",
        },
      },
    ]);
  });

  it("binds to the dpc credential regardless of which named query was used", () => {
    // `dpc` and `dpc_av` both declare a credential with id `dpc`; the age
    // attestation is never what the money is bound to.
    const [entry] = buildTransactionData(payment) as Array<{
      credential_ids: string[];
    }>;
    expect(entry?.credential_ids).toEqual(["dpc"]);
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
