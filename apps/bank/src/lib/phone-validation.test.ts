import { describe, expect, it } from "vitest";
import {
  isSamePhoneNumber,
  isValidPhoneNumber,
  normalisePhoneNumber,
} from "./phone-validation.js";

describe("normalisePhoneNumber", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalisePhoneNumber("  +49 171  5555555 ")).toBe("+49 171 5555555");
  });

  it("collapses tabs and newlines too, not only spaces", () => {
    expect(normalisePhoneNumber("+49\t171\n5555555")).toBe("+49 171 5555555");
  });

  it("leaves an already-collapsed number alone", () => {
    expect(normalisePhoneNumber("+49 171 5555555")).toBe("+49 171 5555555");
  });

  it("returns null for a non-string", () => {
    for (const input of [49, null, undefined, {}, [], true]) {
      expect(normalisePhoneNumber(input)).toBeNull();
    }
  });
});

describe("isValidPhoneNumber", () => {
  it("accepts the design's two examples", () => {
    expect(isValidPhoneNumber("+49 171 5555555")).toBe(true);
    expect(isValidPhoneNumber("+49 172 66666666")).toBe(true);
  });

  it("accepts a number with no spaces at all", () => {
    expect(isValidPhoneNumber("+491715555555")).toBe(true);
  });

  it("accepts a number whose surrounding whitespace normalises away", () => {
    expect(isValidPhoneNumber("  +49 171  5555555 ")).toBe(true);
  });

  it("requires a leading plus", () => {
    expect(isValidPhoneNumber("0171 5555555")).toBe(false);
    expect(isValidPhoneNumber("49 171 5555555")).toBe(false);
  });

  it("rejects a second plus", () => {
    expect(isValidPhoneNumber("++491715555555")).toBe(false);
    expect(isValidPhoneNumber("+49+1715555555")).toBe(false);
  });

  it("rejects letters, punctuation and parentheses", () => {
    expect(isValidPhoneNumber("+49 (0)171 5555555")).toBe(false);
    expect(isValidPhoneNumber("+49-171-5555555")).toBe(false);
    expect(isValidPhoneNumber("+49 171 ABCDEFG")).toBe(false);
  });

  it("rejects trailing junk after an otherwise valid number", () => {
    expect(isValidPhoneNumber("+49 171 5555555 x")).toBe(false);
  });

  it("rejects a number that is nothing but a plus", () => {
    expect(isValidPhoneNumber("+")).toBe(false);
    expect(isValidPhoneNumber("")).toBe(false);
  });

  it("rejects fewer than 7 digits", () => {
    // Six digits: one short of the floor.
    expect(isValidPhoneNumber("+49 1715")).toBe(false);
    // Seven is the floor itself, and passes.
    expect(isValidPhoneNumber("+49 17155")).toBe(true);
  });

  it("rejects more than 15 digits", () => {
    // 15 is E.164's maximum and passes; 16 does not.
    expect(isValidPhoneNumber("+" + "1".repeat(15))).toBe(true);
    expect(isValidPhoneNumber("+" + "1".repeat(16))).toBe(false);
  });

  it("rejects a non-string", () => {
    for (const input of [491715555555, null, undefined, {}, [], true]) {
      expect(isValidPhoneNumber(input)).toBe(false);
    }
  });
});

describe("isSamePhoneNumber", () => {
  it("sees through formatting", () => {
    expect(isSamePhoneNumber("+49 171 5555555", "+491715555555")).toBe(true);
  });

  it("distinguishes different numbers", () => {
    expect(isSamePhoneNumber("+49 171 5555555", "+49 172 66666666")).toBe(
      false,
    );
  });

  it("does not treat a national form as the same as an international one", () => {
    // The `+` survives the strip deliberately: `0171 …` and `+49 171 …` are
    // not the same string of digits and this predicate does not guess.
    expect(isSamePhoneNumber("+491715555555", "01715555555")).toBe(false);
  });
});