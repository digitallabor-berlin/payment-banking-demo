import { describe, expect, it } from "vitest";
import { formatBookedAt, formatEuroCents, formatIban } from "./format.js";

/** Non-breaking and narrow-no-break spaces vary by ICU build; normalise them. */
function normalise(value: string): string {
  return value.replace(/\u00a0|\u202f/g, " ");
}

describe("formatEuroCents", () => {
  it("formats a positive amount with a German decimal comma", () => {
    expect(normalise(formatEuroCents(348_712))).toBe("3.487,12 €");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(normalise(formatEuroCents(-4_215))).toBe("-42,15 €");
  });

  it("formats zero", () => {
    expect(normalise(formatEuroCents(0))).toBe("0,00 €");
  });

  it("always shows two decimal places", () => {
    expect(normalise(formatEuroCents(100))).toBe("1,00 €");
    expect(normalise(formatEuroCents(5))).toBe("0,05 €");
  });
});

describe("formatIban", () => {
  it("groups an IBAN in blocks of four", () => {
    expect(formatIban("DE02120300000000202051")).toBe("DE02 1203 0000 0000 2020 51");
  });

  it("leaves an already-short value alone", () => {
    expect(formatIban("DE02")).toBe("DE02");
  });

  it("strips existing whitespace before regrouping", () => {
    expect(formatIban("DE02 1203 0000")).toBe("DE02 1203 0000");
  });
});

describe("formatBookedAt", () => {
  it("formats as dd.MM.yyyy", () => {
    const ms = Date.UTC(2026, 7, 5, 12, 0, 0);
    expect(formatBookedAt(ms)).toBe("05.08.2026");
  });
});