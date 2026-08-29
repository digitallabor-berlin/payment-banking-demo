import { describe, expect, it } from "vitest";
import { isNeutralCheckoutCustomer } from "./neutral-checkout.js";

/**
 * One predicate drives TWO effects — the unsigned DC API wire form and the
 * shop-styled sheet chrome — so the cases below are the whole definition of
 * when a shopper gets the neutral flow. Splitting the two decisions apart is
 * how they would come to disagree.
 */
describe("isNeutralCheckoutCustomer", () => {
  it("matches the demo name exactly as typed", () => {
    expect(isNeutralCheckoutCustomer("John Smith")).toBe(true);
  });

  // A demo name typed by hand at a keyboard, so case is not a signal.
  it("ignores case", () => {
    expect(isNeutralCheckoutCustomer("john smith")).toBe(true);
    expect(isNeutralCheckoutCustomer("JOHN SMITH")).toBe(true);
    expect(isNeutralCheckoutCustomer("JoHn SmItH")).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isNeutralCheckoutCustomer("  John Smith\t")).toBe(true);
  });

  /**
   * Trimming is at the ends only. Pinned rather than left to chance: a shopper
   * who double-taps the space bar gets the ordinary EudiPay flow, and that
   * being a surprise is better than a `replace(/\s+/g)` nobody asked for
   * quietly widening the trigger to names it was never meant to catch.
   */
  it("does not collapse whitespace inside the name", () => {
    expect(isNeutralCheckoutCustomer("John  Smith")).toBe(false);
  });

  it("rejects every other customer", () => {
    expect(isNeutralCheckoutCustomer("Ada Lovelace")).toBe(false);
    expect(isNeutralCheckoutCustomer("Johnny Smith")).toBe(false);
    expect(isNeutralCheckoutCustomer("John Smithson")).toBe(false);
    expect(isNeutralCheckoutCustomer("Smith John")).toBe(false);
    expect(isNeutralCheckoutCustomer("John")).toBe(false);
  });

  // The name field is empty on first render, and the form reads it live to pick
  // the wire form before anything is submitted.
  it("rejects an empty name", () => {
    expect(isNeutralCheckoutCustomer("")).toBe(false);
    expect(isNeutralCheckoutCustomer("   ")).toBe(false);
  });
});
