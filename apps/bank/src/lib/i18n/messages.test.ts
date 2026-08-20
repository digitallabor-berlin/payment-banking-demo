import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "./locale.js";
import { IDENTICAL_BY_DESIGN, MESSAGES } from "./messages.js";

/**
 * Flatten a catalog to `{ "nav.overview": "Overview", … }`.
 *
 * Function entries are invoked with a marker argument so an interpolated
 * string can be compared like any other. The marker is deliberately
 * language-neutral so it cannot itself trip the umlaut or distinctness checks.
 */
function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  if (typeof value === "function") {
    return { [prefix]: String((value as (arg: unknown) => unknown)("X")) };
  }
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    Object.assign(out, flatten(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

const FLAT: Record<Locale, Record<string, string>> = {
  en: flatten(MESSAGES.en),
  de: flatten(MESSAGES.de),
};

describe("message catalogs", () => {
  it("covers every supported locale", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...LOCALES].sort());
  });

  // TypeScript already guarantees matching keys. This asserts it at runtime
  // too, so a future `as Messages` cast cannot quietly defeat the guarantee.
  it("has identical key sets in both locales", () => {
    expect(Object.keys(FLAT.en).sort()).toEqual(Object.keys(FLAT.de).sort());
  });

  it("has no empty leaf in either locale", () => {
    for (const locale of LOCALES) {
      for (const [path, value] of Object.entries(FLAT[locale])) {
        expect(value.trim(), `${locale}:${path} is empty`).not.toBe("");
      }
    }
  });

  // The realistic failure mode for this change is a half-finished translation:
  // a German string left sitting in the English catalog. An umlaut is the
  // cheapest reliable signal of one.
  it("has no German orthography in the English catalog", () => {
    for (const [path, value] of Object.entries(FLAT.en)) {
      expect(value, `en:${path} contains German orthography`).not.toMatch(
        /[äöüßÄÖÜ]/,
      );
    }
  });

  // The other half of the same failure mode: a string copied across without
  // being translated at all. Proper nouns are hardcoded in components rather
  // than catalogued, so this check can be absolute.
  it("has no leaf that is identical across the two locales", () => {
    for (const [path, value] of Object.entries(FLAT.en)) {
      if (IDENTICAL_BY_DESIGN.includes(path)) continue;
      expect(FLAT.de[path], `${path} is untranslated`).not.toBe(value);
    }
  });

  it("interpolates the dashboard greeting in both locales", () => {
    expect(MESSAGES.en.dashboard.greeting("Anna")).toContain("Anna");
    expect(MESSAGES.de.dashboard.greeting("Anna")).toContain("Anna");
  });

  it("interpolates the page counter in both locales", () => {
    expect(MESSAGES.en.transactions.page(3)).toContain("3");
    expect(MESSAGES.de.transactions.page(3)).toContain("3");
  });
});
