/**
 * Every branching decision the limit-change dialog makes, extracted from the
 * component.
 *
 * vitest is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary inside a `.tsx` file is never covered — and branching inside a
 * component is exactly how a defect in one state stays invisible from the
 * others. Same reasoning as `login-dialog-state.ts` and `card-state.ts`.
 *
 * A SIBLING of `login-dialog-state.ts`, not an extension of it: the phases
 * differ (this flow has a chooser before the wallet opens, and a success that
 * depends on a write rather than on a cookie). What the two DO share —
 * affordance selection across the three transports, and the touch rule — is
 * imported from there unchanged by the component, because a second copy of
 * `selectLoginAffordance` could only ever drift.
 */

/** What the dialog is showing. */
export type LimitPhase = "choose" | "waiting" | "success" | "error";

/** A key into `MESSAGES[locale].limits`. */
export type LimitFailureKey =
  | "expired"
  | "unknownCredential"
  | "limitChanged"
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
export function isLimitTerminal(state: string): boolean {
  return state === "verified" || state === "applied" || state === "failed";
}

/**
 * Which face the dialog wears.
 *
 * `null` means no session has been created yet, which is the chooser — and
 * once a session exists the dialog never returns to it, because Continue
 * against a session already in the wallet's hands would open a second one.
 *
 * `verified` is deliberately still `waiting`: the limit is NOT written until
 * the client's POST to `…/apply` returns 2xx, and `applied` is that POST's
 * answer rather than the poll's. Showing success on `verified` would name an
 * amount the account does not hold.
 *
 * A successful apply outranks everything, so a late poll failure cannot undo a
 * limit that is already written.
 */
export function selectLimitPhase(
  state: string | null,
  applied: boolean,
  pollFailed: boolean,
): LimitPhase {
  if (applied) return "success";
  if (state === null) return "choose";
  if (state === "failed") return "error";
  if (pollFailed) return "error";
  return "waiting";
}

/**
 * Maps a failure reason to a copy key.
 *
 * Reasons reach this from two places, which is why it takes a plain string:
 * `failure_reason` on the polled session, and the `error` member of a non-2xx
 * apply response. `limit_changed` only ever arrives by the second route — the
 * poll structurally cannot write it — so a dialog that fed it only the session's
 * reason would leave that copy dead.
 *
 * Everything unrecognised falls through to the generic message. Only `expired`,
 * `unknownCredential` and `limitChanged` name a remedy, because only those
 * three are things the holder can act on: wait and retry, re-add the
 * credential, start again. `wrong_customer` in particular must NOT be spelled
 * out — it would tell whoever is holding the phone that their presentation was
 * valid but for somebody else's account.
 */
export function limitFailureKey(
  failureReason: string | undefined,
): LimitFailureKey {
  if (failureReason === "expired") return "expired";
  if (failureReason === "unknown_credential") return "unknownCredential";
  if (failureReason === "limit_changed") return "limitChanged";
  return "verificationFailed";
}