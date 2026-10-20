/**
 * Every branching decision the send-money dialog makes, extracted from the
 * component.
 *
 * vitest is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary inside a `.tsx` file is never covered — and branching inside a
 * component is exactly how a defect in one state stays invisible from the
 * others. Same reasoning as `limit-dialog-state.ts`, `login-dialog-state.ts`
 * and `card-state.ts`.
 *
 * A SIBLING of `limit-dialog-state.ts`, not an extension of it: the phases
 * differ (this flow opens on a FORM rather than a chooser, and its terminal
 * write moves money rather than a number). What the two share —
 * `selectLoginAffordance` across the three transports, and `needsQrRecovery` —
 * is IMPORTED by the component from where each already lives, never copied: a
 * second copy of either could only ever drift.
 */

/** What the dialog is showing. */
export type TransferPhase = "form" | "waiting" | "success" | "error";

/** A key into `MESSAGES[locale].transfers`. */
export type TransferFailureKey =
  | "expired"
  | "unknownCredential"
  | "limitExceeded"
  | "insufficientFunds"
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
export function isTransferTerminal(state: string): boolean {
  return state === "verified" || state === "applied" || state === "failed";
}

/**
 * Which face the dialog wears.
 *
 * `null` means no session has been created yet, which is the FORM — and once a
 * session exists the dialog never returns to it, because Send against a
 * session already in the wallet's hands would open a second one and ask a
 * human to approve the same transfer twice.
 *
 * BUT `startFailed` is consulted BEFORE that, because a start that FAILED also
 * has no session and must not read as "nothing has happened yet". The limit
 * change shipped exactly this bug once: checking `state === null` first made a
 * failed start render the chooser again — the holder pressed the button, it
 * greyed out for a moment and came back, with no message anywhere. That is
 * EVERY local attempt, since no local foundry declares `sparkassen_auth`, and
 * it is the case the design's anti-goal resolves with "an error message is
 * better than a dialog that looks idle".
 *
 * `verified` is deliberately still `waiting`: no money moves until the
 * client's POST to `…/apply` returns 2xx, and `applied` is that POST's answer
 * rather than the poll's. Showing success on `verified` would tell a holder
 * their money had gone when the debit has not been written — and apply can
 * still refuse, with `limit_exceeded` or `insufficient_funds`.
 *
 * A successful apply outranks everything, so a late poll failure cannot
 * un-debit money that is already gone.
 */
export function selectTransferPhase(
  state: string | null,
  applied: boolean,
  startFailed: boolean,
): TransferPhase {
  if (applied) return "success";
  if (state === "failed") return "error";
  if (startFailed) return "error";
  if (state === null) return "form";
  return "waiting";
}

/**
 * Maps a failure reason to a copy key.
 *
 * Reasons reach this from two places, which is why it takes a plain string:
 * `failure_reason` on the polled session, and the `error` member of a non-2xx
 * start or apply response. `limit_exceeded` and `insufficient_funds` arrive
 * only by the second route — the poll structurally cannot write either — so a
 * dialog that fed this only the session's reason would leave both dead.
 *
 * Everything unrecognised falls through to the generic message. Only the four
 * named here are things the holder can act on: wait and retry, re-add the
 * credential, send less, or top up. `wrong_customer` in particular must NOT be
 * spelled out — it would tell whoever is holding the phone that their
 * presentation was valid but for somebody else's account.
 */
export function transferFailureKey(
  failureReason: string | undefined,
): TransferFailureKey {
  if (failureReason === "expired") return "expired";
  if (failureReason === "unknown_credential") return "unknownCredential";
  if (failureReason === "limit_exceeded") return "limitExceeded";
  if (failureReason === "insufficient_funds") return "insufficientFunds";
  return "verificationFailed";
}