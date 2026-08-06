import { describe, expect, it } from "vitest";
import { centsToDecimalString, formatEuroCents } from "./format.js";

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