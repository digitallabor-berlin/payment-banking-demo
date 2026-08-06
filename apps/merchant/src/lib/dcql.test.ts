import { describe, expect, it } from "vitest";
import { buildDcqlQuery, buildTransactionData } from "./dcql.js";

describe("buildDcqlQuery", () => {
  it("asks for exactly the com.emvco.dpc.card credential and two claims", () => {
    expect(buildDcqlQuery()).toEqual({
      credentials: [
        {
          id: "card",
          format: "dc+sd-jwt",
          meta: { vct_values: ["com.emvco.dpc.card"] },
          claims: [{ path: ["credential_id"] }, { path: ["network"] }],
        },
      ],
    });
  });
});

describe("buildTransactionData", () => {
  it("carries the amount as a plain decimal string, not a number", () => {
    const data = buildTransactionData("ord_1", 4_798, "Demo Shop");
    expect(data).toEqual([
      {
        type: "payment",
        credential_ids: ["card"],
        amount: "47.98",
        currency: "EUR",
        merchant: "Demo Shop",
        order_id: "ord_1",
      },
    ]);
  });

  it("round-trips a whole-euro amount without dropping decimals", () => {
    const [entry] = buildTransactionData("ord_2", 5_000, "Demo Shop") as Array<{
      amount: string;
    }>;
    expect(entry?.amount).toBe("50.00");
  });
});