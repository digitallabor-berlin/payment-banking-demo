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
 * disappears.
 *
 * `"deep-link"` means "ALSO offer the deep link", not "offer it instead of the
 * QR" — see `showsWalletButton` / `showsQr` below, which is where that is
 * decided. The name is kept because the touch case is still the only one that
 * carries a link at all.
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
 * Whether to draw the `openid4vp://` deep link. Touch only — on a pointer
 * device there is no wallet to hand over to on this machine.
 */
export function showsWalletButton(affordance: LoginAffordance): boolean {
  return affordance === "deep-link";
}

/**
 * Whether to draw the QR. TRUE on touch as well as on a pointer device, and
 * that is the whole of the iPad fix.
 *
 * These used to be one mutually-exclusive branch per affordance inside each
 * dialog's JSX, so `"deep-link"` structurally excluded the QR. `pointer:
 * coarse` was being read as "a wallet lives on this device", which it cannot
 * answer — no browser API can. It is false for an iPad, for a touchscreen
 * laptop, and for any phone without the wallet installed.
 *
 * Reported from a real iPad (Safari 18.7.5, which has no Digital Credentials
 * API at all, so the session was correctly `request_uri`): the dialog drew a
 * button that opened `openid4vp://`, which no iPad app claims, and offered no
 * QR anywhere. Offering both costs a phone holder nothing — the link is still
 * first — and gives a tablet holder something to scan with their phone.
 *
 * Still false for `dc-api`: that session inlines its request object and has no
 * URI, so a QR there would encode an empty string.
 */
export function showsQr(affordance: LoginAffordance): boolean {
  return affordance === "qr" || affordance === "deep-link";
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