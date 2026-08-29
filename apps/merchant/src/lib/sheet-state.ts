/**
 * Everything the EudiPay sheet renders, as one pure decision.
 *
 * This used to be a stack of nested ternaries inside PaymentScreen's JSX, which
 * is exactly why a spacing defect in one branch was invisible from the others.
 * Keeping the decision here also makes it testable: every vitest project runs
 * `environment: "node"` and matches only `src/**\/*.test.ts`, so nothing in a
 * `.tsx` file is ever covered.
 *
 * `litStars` is what the ring shows when it is NOT animating. `animate: true`
 * tells the component to cycle 1 -> 12; under prefers-reduced-motion it renders
 * `litStars` instead, which is why the waiting states carry 6 rather than 0.
 */

import { isDcApiTransport, type PresentationTransport } from "./transport.js";

export type SheetPhase =
  | "authorise"
  | "waiting"
  | "settling"
  | "approved"
  | "declined";

export type SheetGlyph = "card" | "check" | "alert";

export type SheetAction = "approve" | "retry" | "show-qr" | null;

/** Why a Digital Credentials API invocation did not produce a credential. */
export type DcError = "unsupported" | "failed" | null;

export interface SheetInput {
  state: string;
  transport: PresentationTransport;
  ageRequested: boolean;
  redirecting: boolean;
  dcBusy: boolean;
  /**
   * The wallet answered and its response has been relayed; the server has not
   * yet said what it thought of it.
   *
   * A SECOND flag rather than a `dcBusy` that is simply never cleared, because
   * the two windows want different copy — "Opening your wallet…" is false once
   * the wallet has closed. Once true it stays true: there is nothing to go back
   * to, and every later state outranks it below.
   *
   * Without it the sheet spent the 2–3s until the poll's next tick in the
   * `authorise` branch — a live "Approve in your wallet" button over a payment
   * that had already been approved, and a motionless ring. Reported from a real
   * payment.
   */
  dcSubmitted: boolean;
  dcError: DcError;
  pollStatus: "running" | "failed" | "timeout" | null;
  failureReason?: string;
}

export interface SheetView {
  phase: SheetPhase;
  eyebrow: string;
  litStars: number;
  glyph: SheetGlyph;
  animate: boolean;
  pill: string | null;
  headline: string | null;
  body: string;
  showQr: boolean;
  showWalletButton: boolean;
  primaryAction: SheetAction;
  showCancel: boolean;
  showBackToShop: boolean;
}

/**
 * Spec §6.3's failure table, in the shopper's words rather than the code's.
 *
 * Deliberately NOT exported: nothing outside this module needs it, and an unused
 * export is something `knip` reports. Tests assert the `body` string that comes
 * out of `selectSheetView`, which is what a shopper actually reads.
 */
const FAILURE_MESSAGE: Record<string, string> = {
  cancelled: "This payment was cancelled.",
  verification_failed: "Your card could not be verified.",
  transaction_data_binding_failed:
    "The amount could not be confirmed against your wallet's approval.",
  age_verification_failed: "Your age could not be confirmed.",
  insufficient_funds: "Payment was declined by your bank.",
  credential_invalid: "This card is no longer valid.",
  bank_unreachable: "Could not reach your bank. Nothing was charged.",
  foundry_unavailable: "The payment service is unavailable. Please try again.",
};

const AUTHORISE = "Amount to authorise";

function declined(
  headline: string,
  body: string,
  action: SheetAction,
): SheetView {
  return {
    phase: "declined",
    eyebrow: "Not paid",
    litStars: 0,
    glyph: "alert",
    animate: false,
    pill: null,
    headline,
    body,
    showQr: false,
    showWalletButton: false,
    primaryAction: action,
    showCancel: false,
    showBackToShop: true,
  };
}

export function selectSheetView(input: SheetInput): SheetView {
  // Terminal outcomes first: a declined payment must never keep offering a QR.
  if (input.pollStatus === "timeout") {
    return declined(
      "Payment declined",
      "This payment request expired.",
      "retry",
    );
  }

  if (input.pollStatus === "failed") {
    return declined(
      "Payment declined",
      "Lost connection to the payment service.",
      "retry",
    );
  }

  if (input.state === "failed") {
    return declined(
      "Payment declined",
      (input.failureReason && FAILURE_MESSAGE[input.failureReason]) ||
        "The payment could not be completed.",
      input.failureReason === "cancelled" ? null : "retry",
    );
  }

  if (input.state === "completed") {
    return {
      phase: "approved",
      eyebrow: "Paid",
      litStars: 12,
      glyph: "check",
      animate: false,
      pill: null,
      headline: "Payment approved",
      body: "Taking you to your receipt…",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      showCancel: false,
      showBackToShop: false,
    };
  }

  // A dc_api session that could not reach a wallet is not a decline, but it
  // reuses the declined layout because the recovery is the same shape.
  if (input.dcError !== null) {
    return declined(
      "Couldn't open your wallet",
      input.dcError === "unsupported"
        ? "This browser does not support the Digital Credentials API."
        : "Could not open your wallet on this device.",
      "show-qr",
    );
  }

  if (input.state === "settling") {
    return {
      phase: "settling",
      eyebrow: AUTHORISE,
      litStars: 11,
      glyph: "card",
      animate: true,
      pill: "Contacting your bank…",
      headline: null,
      body: "Your wallet approved the payment. Don't close this tab.",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      // The money is in flight. There is nothing left to cancel.
      showCancel: false,
      showBackToShop: false,
    };
  }

  if (input.redirecting) {
    return {
      phase: "waiting",
      eyebrow: AUTHORISE,
      litStars: 6,
      glyph: "card",
      animate: true,
      pill: "Opening your wallet…",
      headline: null,
      body: "Approve the payment in your EUDI Wallet, then come back to this tab.",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      showCancel: true,
      showBackToShop: false,
    };
  }

  // Both DC API forms render the wallet button and never a QR: each inlines its
  // request object and has no URI to scan. Asked through the predicate rather
  // than compared to one value, because `transport === "dc_api"` misses the
  // signed form and would silently show a QR of an empty string.
  if (isDcApiTransport(input.transport)) {
    const body = input.ageRequested
      ? "Your wallet will confirm the amount and that you're over 18."
      : "Your wallet will confirm the amount.";

    /*
     * Two windows, one layout. `dcBusy` is "the wallet is open"; `dcSubmitted`
     * is "the wallet answered, the verdict has not". Both withdraw the button
     * outright rather than disabling it — a disabled control still says "this
     * is the thing to press", and there is nothing left to press.
     *
     * `dcBusy` is tested first so the transition reads forwards: the flags
     * overlap for one render, and during it the wallet genuinely is still open.
     */
    if (input.dcBusy || input.dcSubmitted) {
      return {
        phase: "waiting",
        eyebrow: AUTHORISE,
        litStars: 6,
        glyph: "card",
        animate: true,
        pill: input.dcBusy
          ? "Opening your wallet…"
          : "Confirming your payment…",
        headline: null,
        body,
        showQr: false,
        showWalletButton: false,
        primaryAction: null,
        // Cancel stays: the money is not in flight yet. `settling` is where
        // that becomes true, and it is strictly after this.
        showCancel: true,
        showBackToShop: false,
      };
    }

    return {
      phase: "authorise",
      eyebrow: AUTHORISE,
      litStars: 4,
      glyph: "card",
      animate: false,
      // Nothing is waiting until the shopper presses the button.
      pill: null,
      headline: null,
      body,
      showQr: false,
      showWalletButton: true,
      primaryAction: "approve",
      showCancel: true,
      showBackToShop: false,
    };
  }

  return {
    phase: "waiting",
    eyebrow: AUTHORISE,
    litStars: 6,
    glyph: "card",
    animate: true,
    pill: "Waiting for your wallet",
    headline: null,
    body: input.ageRequested
      ? "Scan with your EUDI Wallet to approve the payment and confirm you're over 18."
      : "Scan with your EUDI Wallet to approve the payment.",
    showQr: true,
    showWalletButton: false,
    primaryAction: null,
    showCancel: true,
    showBackToShop: false,
  };
}
