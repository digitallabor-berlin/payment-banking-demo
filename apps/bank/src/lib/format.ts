import type { Locale } from "./i18n/locale.js";

/**
 * The BCP-47 tag behind each of our two-letter locales.
 *
 * `en-IE` rather than `en-US` or `en-GB`: it is the euro-native English locale,
 * so currency placement and grouping come out right with no overrides, and it
 * is day-month-first like German, so switching language never silently
 * reinterprets 01/08 as the eighth of January.
 *
 * This does NOT contradict the root AGENTS.md warning about de-DE vs en-IE.
 * That warning is against REPLACING the bank's de-DE with the merchant's
 * en-IE. Here de-DE remains and en-IE is added beside it.
 */
const TAG: Record<Locale, string> = { en: "en-IE", de: "de-DE" };

// One Intl instance per locale, built once at module scope rather than per
// call — the same reason the originals were module constants.
const euro: Record<Locale, Intl.NumberFormat> = {
 en: new Intl.NumberFormat(TAG.en, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
 }),
 de: new Intl.NumberFormat(TAG.de, {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
 }),
};

const weekday: Record<Locale, Intl.DateTimeFormat> = {
 en: new Intl.DateTimeFormat(TAG.en, { weekday: "short", timeZone: "UTC" }),
 de: new Intl.DateTimeFormat(TAG.de, { weekday: "short", timeZone: "UTC" }),
};

const majorUnits: Record<Locale, Intl.NumberFormat> = {
 en: new Intl.NumberFormat(TAG.en, { maximumFractionDigits: 0 }),
 de: new Intl.NumberFormat(TAG.de, { maximumFractionDigits: 0 }),
};

/** The separator between the parts of a numeric date. */
const DATE_SEPARATOR: Record<Locale, string> = { en: "/", de: "." };

/** Integer cents to a localized euro string. */
export function formatEuroCents(cents: number, locale: Locale): string {
 return euro[locale].format(cents / 100);
}

/**
 * Groups an IBAN in blocks of four for readability.
 *
 * Locale-independent on purpose: blocks of four is an IBAN convention, not a
 * national one.
 */
export function formatIban(iban: string): string {
 return (iban.replace(/\s+/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

/**
 * dd.MM.yyyy (de) or dd/MM/yyyy (en), in UTC.
 *
 * Still hand-rolled on UTC getters rather than Intl.DateTimeFormat, for the
 * original reason: it keeps the test off the runner's timezone. Only the
 * separator varies. Both locales stay day-first, so no MM/DD ambiguity is
 * introduced.
 */
export function formatBookedAt(ms: number, locale: Locale): string {
 const date = new Date(ms);
 const day = String(date.getUTCDate()).padStart(2, "0");
 const month = String(date.getUTCMonth() + 1).padStart(2, "0");
 const sep = DATE_SEPARATOR[locale];
 return `${day}${sep}${month}${sep}${date.getUTCFullYear()}`;
}

/**
 * "28/08/2026, 10:57 UTC" — when the bank received a proof package.
 *
 * Built ON `formatBookedAt` rather than beside it, so the day shown on a
 * package can never drift from the day its transaction shows in the ledger.
 *
 * The zone marker is load-bearing, not decoration. Every other timestamp in
 * this app is a banking DATE, where the hour does not matter; this one is a
 * custody record, where it does — and a bare `10:57` on a receipt reads as
 * local time while being UTC. This repo has already paid for that ambiguity
 * once, on the login `transaction_data` datetime.
 *
 * Minutes, not seconds: enough to place the moment, and the second is noise a
 * reader cannot act on. The stored value keeps full precision either way.
 */
export function formatReceivedAt(ms: number, locale: Locale): string {
 const date = new Date(ms);
 const hours = String(date.getUTCHours()).padStart(2, "0");
 const minutes = String(date.getUTCMinutes()).padStart(2, "0");
 return `${formatBookedAt(ms, locale)}, ${hours}:${minutes} UTC`;
}

/**
 * "Fr, 01.08.2025" / "Fri, 01/08/2025" — the label on a ledger day rail. UTC
 * for the same reason as formatBookedAt.
 */
export function formatDayLabel(ms: number, locale: Locale): string {
 return `${weekday[locale].format(new Date(ms))}, ${formatBookedAt(ms, locale)}`;
}

export interface EuroParts {
 /** "−" (U+2212, a real minus) for debits, empty otherwise. */
 sign: string;
 /** Grouped euros, e.g. "3.487" (de) or "3,487" (en). */
 major: string;
 /** Always two digits, e.g. "12". */
 minor: string;
}

/**
 * Splits an amount into the parts the balance display sets at different sizes.
 * The magnitude should land first, so euros are large and cents step back —
 * which is only possible if they are separate elements.
 */
export function splitEuroCents(cents: number, locale: Locale): EuroParts {
 const absolute = Math.abs(cents);
 return {
  sign: cents < 0 ? "\u2212" : "",
  major: majorUnits[locale].format(Math.trunc(absolute / 100)),
  minor: String(absolute % 100).padStart(2, "0"),
 };
}
