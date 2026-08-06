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

/**
 * The unit price shown beneath a shelf ticket, e.g. "€11.63/kg".
 *
 * EU Directive 98/6/EC obliges a retailer to display the price per kilogram or
 * litre alongside the selling price, so shoppers can compare pack sizes. It is
 * computed from priceCents rather than stored, so it can never disagree with
 * the price actually charged.
 *
 * Returns an empty string for a non-positive quantity: a shelf ticket with no
 * unit price is correct, one reading "€Infinity/kg" is not.
 */
export function formatUnitPrice(
  priceCents: number,
  baseQuantity: number,
  baseUnit: "kg" | "l" | "pc",
): string {
  if (!(baseQuantity > 0)) return "";
  return `${euro.format(priceCents / baseQuantity / 100)}/${baseUnit}`;
}