/**
 * Every branching decision the wallet-login dialog makes, extracted from the
 * component.
 *
 * vitest is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary inside a `.tsx` file is never covered — and branching inside a
 * component is exactly how a defect in one state stays invisible from the
 * others. Same reasoning as the merchant's `sheet-state.ts` and the bank's
 * `card-state.ts`.
 */

/** How the browser's DC API attempt ended, if it was attempted at all. */
export type LoginDcError = null | "unsupported" | "failed";

/** What the dialog offers the holder while it waits. */
export type LoginAffordance = "preparing" | "dc-api" | "deep-link" | "qr";

export type LoginPhase = "waiting" | "success" | "error";

/** A key into `MESSAGES[locale].walletLogin`. */
export type LoginFailureKey =
  | "expired"
  | "unknownCredential"
  | "verificationFailed";

/**
 * Whether the poll should stop.
 *
 * `verified` counts as terminal even though the flow is not over: the CLAIM
 * takes over at that point, and polling on would only re-read a row nothing
 * will change.
 *
 * Fails OPEN on an unrecognised state — an unknown value keeps polling rather
 * than silently ending the flow, and the poll's own timeout is the backstop.
 */
export function isLoginTerminal(state: string): boolean {
  return state === "verified" || state === "failed" || state === "consumed";
}

/**
 * Which affordance to draw.
 *
 * `dcSupported === null` means detection has not resolved, which is NOT the
 * same as unsupported — rendering the QR there flashes it on Android before it
 * disappears. On touch the wallet lives on this same phone, so a deep link
 * beats a QR nobody can scan.
 */
export function selectLoginAffordance(
  dcSupported: boolean | null,
  dcError: LoginDcError,
  isTouch: boolean,
): LoginAffordance {
  if (dcSupported === null) return "preparing";
  if (dcSupported && dcError === null) return "dc-api";
  return isTouch ? "deep-link" : "qr";
}

/**
 * Which face the dialog wears.
 *
 * `verified` is deliberately still `waiting`: the claim is in flight and no
 * cookie exists yet, so showing success would navigate to a page that
 * redirects straight back to the login screen. Only `claimed` promotes it.
 *
 * A successful claim outranks a poll failure, so a late poll error cannot undo
 * a session that already exists.
 */
export function selectLoginPhase(
  state: string | null,
  claimed: boolean,
  pollFailed: boolean,
): LoginPhase {
  if (claimed) return "success";
  if (state === "failed") return "error";
  if (pollFailed) return "error";
  return "waiting";
}

/**
 * Maps a `failure_reason` written by `login-sessions.ts` to a copy key.
 *
 * Everything unrecognised — including `foundry_unavailable`, which is true but
 * not the holder's problem — falls back to the generic message. A reason the
 * holder cannot act on should not be spelled out to them.
 */
export function loginFailureKey(
  failureReason: string | undefined,
): LoginFailureKey {
  if (failureReason === "expired") return "expired";
  if (failureReason === "unknown_credential") return "unknownCredential";
  return "verificationFailed";
}