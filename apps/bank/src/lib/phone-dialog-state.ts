import { isSamePhoneNumber, isValidPhoneNumber } from "./phone-validation.js";

/**
 * Every branching decision the phone-change dialog makes, extracted from the
 * component.
 *
 * vitest is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary inside a `.tsx` file is never covered — and branching inside a
 * component is exactly how a defect in one state stays invisible from the
 * others. Same reasoning as `limit-dialog-state.ts` and `card-state.ts`.
 *
 * A SIBLING of `limit-dialog-state.ts`, not an extension of it. What the two
 * genuinely share — `needsQrRecovery`, and `selectLoginAffordance` across the
 * three transports — the dialog IMPORTS from there and from
 * `login-dialog-state.ts` rather than copying, because a second copy of either
 * could only ever drift.
 */

/**
 * What the dialog is showing.
 *
 * The first phase is named **`form`** rather than the limit dialog's `choose`:
 * this one asks for a value rather than offering a choice, and two modules in
 * one codebase using one name for two different first screens is how a reader
 * starts assuming they are interchangeable.
 */
export type PhonePhase = "form" | "waiting" | "success" | "error";

/** A key into `MESSAGES[locale].phones`. */
export type PhoneFailureKey =
  | "expired"
  | "unknownCredential"
  | "phoneChanged"
  | "invalidPhone"
  | "phoneUnchanged"
  | "verificationFailed";

/**
 * Whether the poll should stop.
 *
 * `verified` counts as terminal even though the flow is not over: the APPLY
 * takes over at that point, and polling on would only re-read a row nothing
 * will change until that POST lands.
 *
 * Fails OPEN on an unrecognised state — an unknown value keeps polling rather
 * than silently ending the flow, and the client's own timeout is the backstop.
 */
export function isPhoneTerminal(state: string): boolean {
  return state === "verified" || state === "applied" || state === "failed";
}

/**
 * Which face the dialog wears.
 *
 * `null` means no session has been created yet, which is the form — and once a
 * session exists the dialog never returns to it, because Continue against a
 * session already in the wallet's hands would open a second one.
 *
 * BUT `pollFailed` is consulted BEFORE that, because a start that FAILED also
 * has no session and must not read as "nothing has happened yet". The limit
 * change shipped exactly that bug: checking `state === null` first made a
 * failed start render the form again — the holder pressed Continue, the button
 * greyed out for a moment and came back, with no message anywhere. That is
 * every local attempt, since no local foundry declares `sparkassen_auth`.
 *
 * `verified` is deliberately still `waiting`: the number is NOT written until
 * the client's POST to `…/apply` returns 2xx, and that POST can still refuse
 * with `phone_changed`. Showing success on `verified` would name a number the
 * customer's row does not hold.
 *
 * A successful apply outranks everything, so a late poll failure cannot undo a
 * number that is already written.
 */
export function selectPhonePhase(
  state: string | null,
  applied: boolean,
  pollFailed: boolean,
): PhonePhase {
  if (applied) return "success";
  if (state === "failed") return "error";
  if (pollFailed) return "error";
  if (state === null) return "form";
  return "waiting";
}

/**
 * Maps a failure reason to a copy key.
 *
 * Reasons reach this from THREE places, which is why it takes a plain string:
 * the `error` member of a non-2xx start response, the `error` member of a
 * non-2xx apply response, and `failure_reason` on the polled session.
 * `phone_changed` only ever arrives by the second route and `invalid_phone` /
 * `phone_unchanged` only by the first — the poll structurally cannot write any
 * of the three — so a dialog that fed this only the session's reason would
 * leave that copy dead and show the generic message for the failures a holder
 * can actually act on.
 *
 * Everything unrecognised falls through to the generic message.
 * `wrong_customer` in particular must NOT be spelled out: it would tell
 * whoever is holding the phone that their presentation was valid but for
 * somebody else's account.
 */
export function phoneFailureKey(
  failureReason: string | undefined,
): PhoneFailureKey {
  if (failureReason === "expired") return "expired";
  if (failureReason === "unknown_credential") return "unknownCredential";
  if (failureReason === "phone_changed") return "phoneChanged";
  if (failureReason === "invalid_phone") return "invalidPhone";
  if (failureReason === "phone_unchanged") return "phoneUnchanged";
  return "verificationFailed";
}

/**
 * Whether Continue is enabled: a plausible number that is not the one already
 * in force.
 *
 * An affordance only — `startPhoneChange` runs both checks again against the
 * live row, and it is the authority. This exists so the holder is not sent to
 * their wallet for a refusal the browser could already see.
 *
 * Both halves delegate to `phone-validation.ts` rather than restating a regex,
 * so the dialog and the server cannot disagree about what a number is.
 */
export function canSubmitPhone(typed: string, current: string): boolean {
  return isValidPhoneNumber(typed) && !isSamePhoneNumber(typed, current);
}