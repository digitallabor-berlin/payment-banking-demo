import { describe, expect, it } from "vitest";
import {
  formatBookedAt,
  formatDayLabel,
  formatEuroCents,
  formatIban,
  splitEuroCents,
} from "./format.js";

/** Non-breaking and narrow-no-break spaces vary by ICU build; normalise them. */
function normalise(value: string): string {
  return value.replace(/\u00a0|\u202f/g, " ");
}

describe("formatEuroCents", () => {
  it("formats a positive amount with a German decimal comma", () => {
    expect(normalise(formatEuroCents(348_712, "de"))).toBe("3.487,12 €");
  });

  it("formats a negative amount with a leading minus", () => {
    expect(normalise(formatEuroCents(-4_215, "de"))).toBe("-42,15 €");
  });

  it("formats zero", () => {
    expect(normalise(formatEuroCents(0, "de"))).toBe("0,00 €");
  });

  it("always shows two decimal places", () => {
    expect(normalise(formatEuroCents(100, "de"))).toBe("1,00 €");
    expect(normalise(formatEuroCents(5, "de"))).toBe("0,05 €");
  });
});

describe("formatIban", () => {
  it("groups an IBAN in blocks of four", () => {
    expect(formatIban("DE02120300000000202051")).toBe(
      "DE02 1203 0000 0000 2020 51",
    );
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
    expect(formatBookedAt(ms, "de")).toBe("05.08.2026");
  });
});

describe("English formatting", () => {
  it("formats euros in the English convention", () => {
    expect(normalise(formatEuroCents(348_712, "en"))).toBe("€3,487.12");
  });

  // Currency goes through `normalise` for the reason the helper exists: de-DE
  // separates the amount from the sign with U+00A0, not a plain space.
  it("still formats euros in the German convention", () => {
    expect(normalise(formatEuroCents(348_712, "de"))).toBe("3.487,12 €");
  });

  it("groups the major unit with commas in English", () => {
    expect(splitEuroCents(348_712, "en").major).toBe("3,487");
  });

  it("groups the major unit with points in German", () => {
    expect(splitEuroCents(348_712, "de").major).toBe("3.487");
  });

  it("uses a real minus for debits in both locales", () => {
    expect(splitEuroCents(-100, "en").sign).toBe("\u2212");
    expect(splitEuroCents(-100, "de").sign).toBe("\u2212");
  });

  it("separates the English date with slashes", () => {
    expect(formatBookedAt(Date.UTC(2025, 7, 1), "en")).toBe("01/08/2025");
  });

  it("separates the German date with points", () => {
    expect(formatBookedAt(Date.UTC(2025, 7, 1), "de")).toBe("01.08.2025");
  });

  it("labels the day with an English weekday", () => {
    expect(formatDayLabel(Date.UTC(2025, 7, 1), "en")).toBe("Fri, 01/08/2025");
  });

  it("labels the day with a German weekday", () => {
    expect(formatDayLabel(Date.UTC(2025, 7, 1), "de")).toBe("Fr, 01.08.2025");
  });

  it("leaves IBAN grouping locale-independent", () => {
    expect(formatIban("DE02120300000000202051")).toBe(
      "DE02 1203 0000 0000 2020 51",
    );
  });
});
