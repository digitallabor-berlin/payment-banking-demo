import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatEuroCents, formatUnitPrice } from "./format.js";

describe("formatEuroCents", () => {
  it("formats with a euro sign and two decimals", () => {
    expect(formatEuroCents(4_798)).toBe("€47.98");
  });

  it("formats zero", () => {
    expect(formatEuroCents(0)).toBe("€0.00");
  });

  it("formats a value under one euro", () => {
    expect(formatEuroCents(5)).toBe("€0.05");
  });
});

describe("centsToDecimalString", () => {
  it("converts cents to a plain two-decimal string", () => {
    expect(centsToDecimalString(4_798)).toBe("47.98");
  });

  it("never inserts a thousands separator", () => {
    expect(centsToDecimalString(100_000)).toBe("1000.00");
  });

  it("pads a whole-euro amount to two decimals", () => {
    expect(centsToDecimalString(500)).toBe("5.00");
  });
});

describe("formatUnitPrice", () => {
  it("scales a sub-kilogram pack up to a price per kilogram", () => {
    // 300 g at €3.49 → €11.6333…/kg, rounded for display.
    expect(formatUnitPrice(349, 0.3, "kg")).toBe("€11.63/kg");
  });

  it("leaves a one-litre pack at its own price", () => {
    expect(formatUnitPrice(139, 1, "l")).toBe("€1.39/l");
  });

  it("scales a half-litre pack up to a price per litre", () => {
    expect(formatUnitPrice(799, 0.5, "l")).toBe("€15.98/l");
  });

  it("divides a multi-piece pack down to a price per piece", () => {
    expect(formatUnitPrice(229, 2, "pc")).toBe("€1.15/pc");
  });

  it("returns nothing rather than a nonsense price for a zero quantity", () => {
    // A ticket with no unit price is correct; "€Infinity/kg" is not.
    expect(formatUnitPrice(199, 0, "kg")).toBe("");
  });

  it("returns nothing for a negative quantity", () => {
    expect(formatUnitPrice(199, -1, "kg")).toBe("");
  });
});