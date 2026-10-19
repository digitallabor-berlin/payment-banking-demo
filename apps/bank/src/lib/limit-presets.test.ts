import { describe, expect, it } from "vitest";
import {
  isSelectablePreset,
  isValidNewLimit,
  LIMIT_PRESETS_CENTS,
} from "./limit-presets.js";

describe("LIMIT_PRESETS_CENTS", () => {
  it("offers 500, 1000, 2000 and 5000 euro", () => {
    expect(LIMIT_PRESETS_CENTS).toEqual([50_000, 100_000, 200_000, 500_000]);
  });

  it("holds cents, never formatted copy", () => {
    for (const preset of LIMIT_PRESETS_CENTS) {
      expect(Number.isSafeInteger(preset)).toBe(true);
    }
  });
});

describe("isSelectablePreset", () => {
  it("does not offer the preset equal to the current limit", () => {
    expect(isSelectablePreset(100_000, 100_000)).toBe(false);
    expect(isSelectablePreset(200_000, 100_000)).toBe(true);
  });

  it("leaves exactly three chips selectable at any seeded limit", () => {
    for (const current of LIMIT_PRESETS_CENTS) {
      const selectable = LIMIT_PRESETS_CENTS.filter((preset) =>
        isSelectablePreset(preset, current),
      );
      expect(selectable).toHaveLength(LIMIT_PRESETS_CENTS.length - 1);
    }
  });

  it("offers every preset when the current limit is not one of them", () => {
    // A limit set before these presets existed, or by a future admin tool.
    const selectable = LIMIT_PRESETS_CENTS.filter((preset) =>
      isSelectablePreset(preset, 123_456),
    );
    expect(selectable).toEqual([...LIMIT_PRESETS_CENTS]);
  });
});

describe("isValidNewLimit", () => {
  /**
   * The dialog cannot send any of these — it renders chips built from
   * `LIMIT_PRESETS_CENTS` and filtered by `isSelectablePreset`. A logged-in
   * caller with `curl` can send all of them, and the start route trusts this
   * predicate instead of writing its own guard, so the matrix lives here.
   */
  it.each([
    ["a non-preset amount", 150_000],
    ["the current limit", 100_000],
    ["zero", 0],
    ["a negative amount", -100_000],
    ["a fractional amount", 100_000.5],
    ["a numeric string", "200000"],
    ["null", null],
    ["undefined", undefined],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an object", { valueOf: () => 200_000 }],
    ["an array", [200_000]],
  ])("rejects %s", (_label, value) => {
    expect(isValidNewLimit(value, 100_000)).toBe(false);
  });

  it("accepts a different preset", () => {
    expect(isValidNewLimit(200_000, 100_000)).toBe(true);
  });

  it("accepts every preset but the one already in force", () => {
    for (const current of LIMIT_PRESETS_CENTS) {
      for (const preset of LIMIT_PRESETS_CENTS) {
        expect(isValidNewLimit(preset, current)).toBe(preset !== current);
      }
    }
  });
});