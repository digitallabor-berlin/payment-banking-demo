import { describe, expect, it } from "vitest";
import { isoCurrencyAmountString } from "./iso-currency-amount.js";

/**
 * The rule under test is subtle and its failure mode is total: a wallet that
 * cannot parse this string refuses the WHOLE presentation rather than
 * degrading one label. See the module's own doc comment for the citation.
 */
describe("isoCurrencyAmountString", () => {
  it("puts the amount first and the currency code last", () => {
    expect(isoCurrencyAmountString(100_000)).toBe("1000.00 EUR");
  });

  it("always carries two fractional digits", () => {
    expect(isoCurrencyAmountString(5)).toBe("0.05 EUR");
    expect(isoCurrencyAmountString(250_000)).toBe("2500.00 EUR");
  });

  it("never groups thousands, in any locale", () => {
    expect(isoCurrencyAmountString(1_234_567)).toBe("12345.67 EUR");
  });
});