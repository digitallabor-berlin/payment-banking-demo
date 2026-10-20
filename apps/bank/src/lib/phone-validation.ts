/**
 * Server-side validation for a mobile number change. No database, no network.
 *
 * The dialog validates too, but that is an affordance. A logged-in caller with
 * `curl` is the real input surface, so the route trusts these tested
 * predicates rather than the form — the same doctrine `transfer-validation.ts`
 * and `isValidNewLimit` already follow. Every rule fails closed.
 *
 * **Explicit non-goals.** No country-prefix table, no carrier lookup, no check
 * that the number is reachable, and no check that it is a *mobile* rather than
 * a landline. None of those can be done offline, and a demo that pretended to
 * do them would be claiming a guarantee it cannot keep. What this module does
 * is reject a string that is not plausibly a telephone number at all.
 */

/**
 * The ONE regex, applied to the NORMALISED string and nothing else: a leading
 * `+`, then digits and single spaces, ending in a digit.
 *
 * Nothing is pre-stripped before it runs, for the reason `parseAmountCents`
 * records at length: a pre-strip that removed spaces "to simplify the check"
 * would also accept `+49 171 ABC 555` right up until the digit count ran, and
 * a pre-strip that removed punctuation would silently accept `+49-171-555`
 * as if the customer had typed something else. The regex rejects every sign
 * character, every bracket and every letter at once.
 *
 * The leading `+` is REQUIRED, by decision (the design marks this as the
 * author's call). A demo whose entire point is a human comparing two numbers
 * on a wallet screen should not also ask them to reconcile `0171 …` against
 * `+49 171 …`.
 */
const PHONE_PATTERN = /^\+[0-9](?:[0-9 ]*[0-9])?$/;

/** E.164's maximum. */
const MAX_DIGITS = 15;

/** The shortest thing worth calling a telephone number. */
const MIN_DIGITS = 7;

/**
 * A typed number, trimmed, with runs of internal whitespace collapsed to one
 * space. `null` for a non-string.
 *
 * This is the ONLY transformation applied to a number that is stored or sent.
 * The column, the signed `transaction_data` payload and the dashboard row are
 * all this exact string, so there is no derivation between what the holder
 * approved and what the bank wrote down.
 */
export function normalisePhoneNumber(input: unknown): string | null {
  if (typeof input !== "string") return null;
  return input.trim().replace(/\s+/g, " ");
}

/**
 * Whether a value is a storable mobile number.
 *
 * A type predicate rather than a plain boolean so a caller holding an
 * `unknown` straight off the wire — `startPhoneChange` does — can narrow it
 * without a cast. Note what it narrows to is the RAW string: the caller must
 * still normalise before storing, because this accepts `"  +49 171  555 5555 "`
 * on the strength of its collapsed form.
 */
export function isValidPhoneNumber(value: unknown): value is string {
  const normalised = normalisePhoneNumber(value);
  if (normalised === null) return false;
  if (!PHONE_PATTERN.test(normalised)) return false;

  const digits = normalised.replace(/[^0-9]/g, "").length;
  return digits >= MIN_DIGITS && digits <= MAX_DIGITS;
}

/**
 * Whether two numbers are the same number differently formatted.
 *
 * **The one place in this feature where a number is normalised beyond
 * whitespace** — author's call, per the design. Everything but `+` and the
 * digits is stripped from both sides before comparing.
 *
 * Without it, retyping the stored number without its spaces passes
 * `startPhoneChange`'s `phone_unchanged` gate, and the wallet then asks a
 * human to approve a change from `+49 171 5555555` to `+491715555555` — two
 * renderings of one number, which is exactly the screen this feature exists to
 * make meaningful.
 *
 * It cannot leak into the payload: the result is a boolean, never a value that
 * is stored or sent. The `+` deliberately survives the strip, so this does not
 * guess that `0171 …` and `+49 171 …` are the same — no country table, as
 * above.
 */
export function isSamePhoneNumber(a: string, b: string): boolean {
  const digits = (value: string): string => value.replace(/[^+0-9]/g, "");
  return digits(a) === digits(b);
}