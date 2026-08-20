/**
 * The bank's supported UI languages.
 *
 * English is the default because this app is demonstrated to audiences who do
 * not read German. German remains the app's native voice — the branding, the
 * typeface and the merchant-facing copy are all German — but it is now opt-in.
 *
 * A closed union rather than a string: adding a third language should be a
 * compile-error-guided exercise, not a runtime lookup that silently misses.
 */
export type Locale = "en" | "de";

export const LOCALES: readonly Locale[] = ["en", "de"];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * The cookie the switcher writes. Deliberately NOT HttpOnly, unlike
 * `bank_session`: it carries no authority, and making it HttpOnly would force a
 * round trip through a route handler to change a display preference.
 */
export const LOCALE_COOKIE = "bank_locale";

/**
 * Collapse a raw cookie value into a supported locale.
 *
 * Pure and total — it never throws, and any value it does not recognise becomes
 * `DEFAULT_LOCALE`. Normalisation is deliberately shallow: it trims and
 * lowercases, so `"DE"` and `" de "` are German, but `"de-DE"` is not. Our own
 * switcher only ever writes a bare `"de"` or `"en"`, so a language-tag-shaped
 * value can only be tampering or staleness, and falling back is the safe
 * answer. Two locales do not justify a BCP-47 parser.
 */
export function resolveLocale(raw: string | undefined): Locale {
  const normalised = (raw ?? "").trim().toLowerCase();
  return LOCALES.includes(normalised as Locale)
    ? (normalised as Locale)
    : DEFAULT_LOCALE;
}