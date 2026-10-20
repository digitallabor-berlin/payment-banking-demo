/**
 * The one place integer cents become a PaSO `iso_currency_amount` string.
 *
 * Extracted from `limit-transaction-data.ts`, where it lived as
 * `limitAmountString`, when the send-money transfer became the second flow
 * needing it. The rule below is subtle, the failure mode is a total wallet
 * refusal, and a second copy could only drift — so there is exactly one.
 */

/**
 * Integer cents to the `"1000.00 EUR"` form paso-view §3 defines: a decimal
 * number, one space, then the ISO 4217 Alpha-3 code.
 *
 * **AMOUNT FIRST. The currency code is LAST.** This was `"EUR 1000.00"` and it
 * made a real wallet refuse every limit change outright (reported 2026-10-20),
 * with `VALUE_TYPE_MISMATCH — claim 'old_limit' is not an '<amount> <ISO4217>'
 * string` in logcat.
 *
 * The spec sentence, verbatim, because the previous constant was justified by a
 * citation that does not exist ("§A.4 uses `EUR 45.00`" — the real example is
 * the reverse):
 *
 * > The value is a string consisting of a decimal number (integer part, decimal
 * > point, fractional digits per [ISO4217]) followed by a space and an
 * > [ISO4217] Alpha-3 currency code (e.g., `"49.99 EUR"`).
 *
 * A consumer parses on the LAST space, so currency-first makes the amount parse
 * as `"EUR"` and throws. Because `value_type` conformance is settled in entry
 * SELECTION (PaSO Core §7.4.2 step 2) rather than in rendering, that is a hard
 * refusal of the whole presentation — not a label that degrades to plain text.
 *
 * `toFixed`, NEVER `Intl`. The string is hashed byte-for-byte into
 * `transaction_data_hashes`, so a German thousands separator baked in here
 * would make the signed artefact depend on the browser's locale — the same
 * rule the merchant's `transaction_data.amount` already follows, and the
 * opposite of what `formatEuroCents` is for.
 *
 * Locale-neutrality is not a loss of presentation: the wallet localises it,
 * wherever a claim declares the `iso_currency_amount` value type over it.
 *
 * This is the ONLY place in the bank where integer cents become a decimal
 * amount string bound for a wallet. `formatEuroCents` is its opposite number
 * and is for human-facing UI only — never for a signed payload.
 */
export function isoCurrencyAmountString(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}