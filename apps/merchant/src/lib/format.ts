const euro = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Integer cents to an English-locale euro string, e.g. "€47.98". */
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100);
}

/**
 * Integer cents to the plain decimal string foundry's `transaction_data.amount`
 * expects (spec §6.2 step 3) — no currency symbol, no thousands separator.
 * `toFixed` rather than `Intl` deliberately: this value is machine-read by
 * foundry, not displayed, and must never localize.
 */
export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}