const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents to a German-locale euro string. */
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100);
}

/** Groups an IBAN in blocks of four for readability. */
export function formatIban(iban: string): string {
  return (iban.replace(/\s+/g, "").match(/.{1,4}/g) ?? []).join(" ");
}

/** dd.MM.yyyy in UTC, so a test is not tied to the runner's timezone. */
export function formatBookedAt(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

const weekday = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  timeZone: "UTC",
});

/**
 * "Fr, 01.08.2025" — the label on a ledger day rail. UTC for the same reason
 * as formatBookedAt.
 */
export function formatDayLabel(ms: number): string {
  return `${weekday.format(new Date(ms))}, ${formatBookedAt(ms)}`;
}

const majorUnits = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

export interface EuroParts {
  /** "−" (U+2212, a real minus) for debits, empty otherwise. */
  sign: string;
  /** Grouped euros, e.g. "3.487". */
  major: string;
  /** Always two digits, e.g. "12". */
  minor: string;
}

/**
 * Splits an amount into the parts the balance display sets at different sizes.
 * The magnitude should land first, so euros are large and cents step back —
 * which is only possible if they are separate elements.
 */
export function splitEuroCents(cents: number): EuroParts {
  const absolute = Math.abs(cents);
  return {
    sign: cents < 0 ? "\u2212" : "",
    major: majorUnits.format(Math.trunc(absolute / 100)),
    minor: String(absolute % 100).padStart(2, "0"),
  };
}