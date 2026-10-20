/**
 * Server-side validation for a send-money transfer. No database, no network.
 *
 * The dialog validates too, but that is an affordance. A logged-in caller with
 * `curl` is the real input surface, so the route trusts these tested
 * predicates rather than the form — the same doctrine `isValidNewLimit`
 * already follows for the limit change. Every rule fails closed.
 */

/** The SEPA creditor-name limit. */
export const MAX_PAYEE_NAME_LENGTH = 70;

/** The SEPA unstructured-remittance limit. */
export const MAX_PURPOSE_LENGTH = 140;

/**
 * €1,000,000.00, in cents.
 *
 * A sanity ceiling rather than a product rule — the daily limit and the
 * balance are the gates that matter, and both are checked against the live
 * account in `startTransfer`. This exists so a pasted integer cannot overflow
 * the arithmetic below or produce an amount string no consent screen could
 * render legibly.
 */
export const MAX_AMOUNT_CENTS = 100_000_000;

/**
 * The ONE regex, applied to the trimmed string and nothing else.
 *
 * It is what rejects grouping separators, three decimal places and every sign
 * character at once, which is why nothing is pre-stripped before it runs: a
 * pre-strip that removed `.` to "handle thousands" would turn `1.250,00` into
 * a number this function then has to guess the magnitude of.
 */
const AMOUNT_PATTERN = /^\d+([.,]\d{1,2})?$/;

/** ISO 13616 shape: two letters, two check digits, then 10–30 alphanumerics. */
const IBAN_PATTERN = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

/**
 * A typed amount to integer cents, or `null`.
 *
 * Accepts `.` or `,` as the decimal separator, because the bank's UI is
 * bilingual and a German speaker types `250,00`. Accepts at most two
 * fractional digits and no grouping separators at all.
 *
 * **Integer arithmetic on the two halves, never `parseFloat`.** A float
 * round-trip is how `1.005` becomes 100 cents instead of being refused, and
 * how a grouped `1.250,00` becomes €1.25 — a silent hundredfold error in the
 * one number a defrauded person is meant to check.
 */
export function parseAmountCents(input: unknown): number | null {
  if (typeof input !== "string") return null;

  const trimmed = input.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) return null;

  const [whole = "", fraction = ""] = trimmed.split(/[.,]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  // Zero and negatives: a transfer of nothing is not a transfer, and the regex
  // has already refused every sign character.
  if (cents <= 0) return null;
  if (cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

/**
 * Whitespace stripped, upper-cased. This is the form the database stores.
 *
 * The grouped-in-fours form the holder reads on the consent screen is derived
 * from this at payload-build time via `formatIban`, so one IBAN has one stored
 * source and one deterministic derivation.
 */
export function normaliseIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/**
 * Shape plus the ISO 13616 mod-97 checksum. **Nothing else.**
 *
 * No country length table, no bank directory, no name/IBAN match — those are
 * explicit non-goals. The checksum is in because it is ten lines and it
 * catches exactly the typo the wallet consent screen exists to let a human
 * catch: a single transposed digit passes the shape regex and fails here.
 *
 * The mod-97 is taken CHUNK-WISE over the digit string, seven digits at a
 * time. A remainder is at most two digits, so each step evaluates at most a
 * nine-digit number — comfortably inside `Number.MAX_SAFE_INTEGER`, which is
 * what lets this avoid `BigInt` entirely.
 */
export function isValidIban(input: unknown): boolean {
  if (typeof input !== "string") return false;

  const iban = normaliseIban(input);
  if (!IBAN_PATTERN.test(iban)) return false;

  // Move the first four characters to the end, then map A–Z to 10–35.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let digits = "";
  for (const character of rearranged) {
    digits +=
      character >= "A" && character <= "Z"
        ? String(character.charCodeAt(0) - 55)
        : character;
  }

  let remainder = 0;
  for (let index = 0; index < digits.length; index += 7) {
    remainder = Number(`${remainder}${digits.slice(index, index + 7)}`) % 97;
  }
  return remainder === 1;
}

/** The four values the holder signs over, normalised. */
export interface TransferInput {
  payeeName: string;
  payeeIban: string;
  amountCents: number;
  purpose: string;
}

/**
 * The whole server-side gate, returning the NORMALISED values or `null`.
 *
 * Returning the normalised form rather than a boolean is what keeps the stored
 * row, the signed payload and the consent screen derived from one source: a
 * caller cannot accept this input and then persist the characters the user
 * happened to type.
 *
 * `purpose` is required rather than optional. It is a row on the consent
 * screen, and an empty one renders as a blank line in the middle of the four
 * values a human is being asked to check.
 */
export function validateTransferInput(input: {
  payeeName: unknown;
  payeeIban: unknown;
  amount: unknown;
  purpose: unknown;
}): TransferInput | null {
  if (typeof input.payeeName !== "string") return null;
  if (typeof input.payeeIban !== "string") return null;
  if (typeof input.purpose !== "string") return null;

  const payeeName = input.payeeName.trim();
  if (payeeName.length === 0 || payeeName.length > MAX_PAYEE_NAME_LENGTH) {
    return null;
  }

  const purpose = input.purpose.trim();
  if (purpose.length === 0 || purpose.length > MAX_PURPOSE_LENGTH) return null;

  if (!isValidIban(input.payeeIban)) return null;

  const amountCents = parseAmountCents(input.amount);
  if (amountCents === null) return null;

  return {
    payeeName,
    payeeIban: normaliseIban(input.payeeIban),
    amountCents,
    purpose,
  };
}