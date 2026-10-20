import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_CENTS,
  MAX_PAYEE_NAME_LENGTH,
  MAX_PURPOSE_LENGTH,
  isValidIban,
  normaliseIban,
  parseAmountCents,
  validateTransferInput,
} from "./transfer-validation.js";

/**
 * Client-side validation is an affordance; THIS is the truth. A logged-in
 * caller with `curl` is the real input surface, so every rule here fails
 * closed and the route trusts these predicates rather than the dialog.
 */
describe("parseAmountCents", () => {
  it("accepts a dot decimal separator", () => {
    expect(parseAmountCents("250.00")).toBe(25_000);
  });

  it("accepts a German comma decimal separator", () => {
    // The bank's UI is bilingual and a German speaker types `250,00`.
    expect(parseAmountCents("250,00")).toBe(25_000);
  });

  it("accepts a whole number with no separator", () => {
    expect(parseAmountCents("250")).toBe(25_000);
  });

  it("accepts one fractional digit", () => {
    expect(parseAmountCents("0.5")).toBe(50);
  });

  it("rejects grouping separators", () => {
    // The trap this exists for: a float round-trip reads `1.250,00` as 1.25
    // and silently debits €1.25 for a €1,250 transfer.
    expect(parseAmountCents("1.250,00")).toBeNull();
    expect(parseAmountCents("1,250.00")).toBeNull();
  });

  it("rejects more than two fractional digits", () => {
    expect(parseAmountCents("1.005")).toBeNull();
  });

  it("rejects zero and negatives", () => {
    expect(parseAmountCents("0")).toBeNull();
    expect(parseAmountCents("0.00")).toBeNull();
    expect(parseAmountCents("-5.00")).toBeNull();
  });

  it("rejects a non-string, NaN and Infinity", () => {
    for (const bad of [null, undefined, 250, {}, "abc", "NaN", "Infinity"]) {
      expect(parseAmountCents(bad)).toBeNull();
    }
  });

  it("rejects an amount above the ceiling", () => {
    expect(parseAmountCents("1000000.01")).toBeNull();
  });

  it("accepts an amount exactly at the ceiling", () => {
    expect(parseAmountCents("1000000.00")).toBe(MAX_AMOUNT_CENTS);
  });

  it("ignores surrounding whitespace but not internal whitespace", () => {
    expect(parseAmountCents("  250.00 ")).toBe(25_000);
    expect(parseAmountCents("2 50.00")).toBeNull();
  });
});

describe("normaliseIban", () => {
  it("strips every space and upper-cases", () => {
    expect(normaliseIban("de89 3704 0044 0532 0130 00")).toBe(
      "DE89370400440532013000",
    );
  });
});

describe("isValidIban", () => {
  it("accepts a correct German IBAN, spaced or not", () => {
    expect(isValidIban("DE89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("DE89370400440532013000")).toBe(true);
  });

  it("accepts lower case", () => {
    expect(isValidIban("de89370400440532013000")).toBe(true);
  });

  it("rejects one transposed digit", () => {
    // Passes the shape regex, fails mod-97. This is the exact typo the wallet
    // consent screen exists to let a human catch — and the reason the checksum
    // is in at all, since it is ten lines.
    expect(isValidIban("DE89370400440532013100")).toBe(false);
  });

  it("rejects a wrong shape", () => {
    for (const bad of [
      "",
      "DE",
      "1234567890",
      "DEXX370400440532013000",
      "DE89-3704",
    ]) {
      expect(isValidIban(bad)).toBe(false);
    }
  });

  it("rejects a non-string", () => {
    expect(isValidIban(42)).toBe(false);
    expect(isValidIban(null)).toBe(false);
    expect(isValidIban(undefined)).toBe(false);
  });
});

describe("validateTransferInput", () => {
  /** A complete, valid input minus whatever the case under test is about. */
  function input(over: Record<string, unknown> = {}) {
    return {
      payeeName: "Max Mustermann",
      payeeIban: "DE89370400440532013000",
      amount: "250.00",
      purpose: "Rent October",
      ...over,
    };
  }

  it("returns normalised values", () => {
    expect(
      validateTransferInput({
        payeeName: "  Max Mustermann ",
        payeeIban: "de89 3704 0044 0532 0130 00",
        amount: "250,00",
        purpose: " Rent October ",
      }),
    ).toEqual({
      payeeName: "Max Mustermann",
      payeeIban: "DE89370400440532013000",
      amountCents: 25_000,
      purpose: "Rent October",
    });
  });

  it("rejects an empty name or purpose after trimming", () => {
    expect(validateTransferInput(input({ payeeName: "   " }))).toBeNull();
    expect(validateTransferInput(input({ purpose: "" }))).toBeNull();
  });

  it("rejects a name over 70 or a purpose over 140 characters", () => {
    expect(
      validateTransferInput(
        input({ payeeName: "x".repeat(MAX_PAYEE_NAME_LENGTH + 1) }),
      ),
    ).toBeNull();
    expect(
      validateTransferInput(
        input({ purpose: "x".repeat(MAX_PURPOSE_LENGTH + 1) }),
      ),
    ).toBeNull();
    // The SEPA limits themselves are allowed.
    expect(
      validateTransferInput(
        input({ payeeName: "x".repeat(MAX_PAYEE_NAME_LENGTH) }),
      ),
    ).not.toBeNull();
    expect(
      validateTransferInput(
        input({ purpose: "x".repeat(MAX_PURPOSE_LENGTH) }),
      ),
    ).not.toBeNull();
  });

  it("rejects an IBAN that fails the checksum", () => {
    expect(
      validateTransferInput(input({ payeeIban: "DE89370400440532013100" })),
    ).toBeNull();
  });

  it("fails closed on every non-string field", () => {
    for (const key of ["payeeName", "payeeIban", "amount", "purpose"]) {
      for (const bad of [null, undefined, 42, {}, []]) {
        expect(validateTransferInput(input({ [key]: bad }))).toBeNull();
      }
    }
  });
});