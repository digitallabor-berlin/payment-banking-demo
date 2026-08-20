import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, resolveLocale } from "./locale.js";

describe("locale constants", () => {
  it("defaults to English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("lists exactly the two supported locales", () => {
    expect([...LOCALES]).toEqual(["en", "de"]);
  });

  it("names the cookie the switcher writes", () => {
    expect(LOCALE_COOKIE).toBe("bank_locale");
  });
});

describe("resolveLocale", () => {
  it("returns the default when no cookie is present", () => {
    expect(resolveLocale(undefined)).toBe("en");
  });

  it("returns the default for an empty value", () => {
    expect(resolveLocale("")).toBe("en");
  });

  it("passes English through", () => {
    expect(resolveLocale("en")).toBe("en");
  });

  it("recognises German", () => {
    expect(resolveLocale("de")).toBe("de");
  });

  it("is case-insensitive", () => {
    expect(resolveLocale("DE")).toBe("de");
  });

  it("ignores surrounding whitespace", () => {
    expect(resolveLocale(" de ")).toBe("de");
  });

  // Normalisation is deliberately shallow. Our own switcher only ever writes a
  // bare "de" or "en", so a BCP-47-shaped value is tampering or staleness, and
  // the default is the safe answer. No language-tag parsing for two locales.
  it("does not accept a full language tag", () => {
    expect(resolveLocale("de-DE")).toBe("en");
  });

  it("returns the default for an unsupported language", () => {
    expect(resolveLocale("fr")).toBe("en");
  });

  it("returns the default for a junk value rather than throwing", () => {
    expect(resolveLocale("<script>alert(1)</script>")).toBe("en");
  });
});