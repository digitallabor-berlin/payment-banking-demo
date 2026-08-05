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