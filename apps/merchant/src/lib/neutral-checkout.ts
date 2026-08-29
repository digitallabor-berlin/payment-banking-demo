/**
 * The demo trigger for the neutral checkout flow.
 *
 * A shopper who checks out under this name gets two things at once: the
 * UNSIGNED DC API wire form, and the payment sheet in the shop's own styling
 * rather than EudiPay's. They are one decision deliberately — a sheet that
 * dropped the EudiPay branding while still sending a signed request object
 * would be showing a neutral face over a wire form the demo is not trying to
 * demonstrate, and the two would drift the first time either was changed alone.
 *
 * Lives here rather than inside `CheckoutForm` because every vitest project in
 * this repo runs `environment: "node"` with `include: ["src/**` `/*.test.ts"]`,
 * so a comparison written in a `.tsx` file is never covered. Same reason
 * `parseDcApiForm` and `cardFaceState` are not components either.
 *
 * The value is read from the ORDER ROW everywhere it matters, never carried
 * from the browser: `orders.customer_name` is already persisted, so the sheet's
 * two constructors can each re-derive the answer instead of threading a third
 * copy of it through the client — which is exactly how `dcApiProtocol` went
 * missing once already.
 */

/** Lowercase because the comparison is case-insensitive; not user-facing copy. */
const NEUTRAL_CHECKOUT_CUSTOMER = "john smith";

/**
 * True for the demo customer, false for everyone else.
 *
 * Trims the ends and folds case, and does nothing else — inner whitespace is
 * significant, so `John  Smith` is a different name. Widening that would make
 * the trigger catch names it was never meant to.
 */
export function isNeutralCheckoutCustomer(name: string): boolean {
 return name.trim().toLowerCase() === NEUTRAL_CHECKOUT_CUSTOMER;
}
