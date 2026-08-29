import { describe, expect, it } from "vitest";
import { selectSheetView, type SheetInput } from "./sheet-state.js";

const base: SheetInput = {
  state: "pending",
  transport: "request_uri",
  ageRequested: false,
  redirecting: false,
  dcBusy: false,
  dcSubmitted: false,
  dcError: null,
  pollStatus: "running",
};

describe("selectSheetView — waiting states", () => {
  it("shows a QR and the waiting pill for a request_uri session", () => {
    const view = selectSheetView(base);
    expect(view.phase).toBe("waiting");
    expect(view.showQr).toBe(true);
    expect(view.showWalletButton).toBe(false);
    expect(view.pill).toBe("Waiting for your wallet");
    expect(view.litStars).toBe(6);
    expect(view.animate).toBe(true);
    expect(view.glyph).toBe("card");
    expect(view.showCancel).toBe(true);
    expect(view.primaryAction).toBeNull();
  });

  it("shows no QR while redirecting to a wallet deep link", () => {
    const view = selectSheetView({ ...base, redirecting: true });
    expect(view.showQr).toBe(false);
    expect(view.pill).toBe("Opening your wallet…");
    expect(view.body).toBe(
      "Approve the payment in your EUDI Wallet, then come back to this tab.",
    );
  });

  it("offers the wallet button and no pill before a dc_api press", () => {
    const view = selectSheetView({ ...base, transport: "dc_api" });
    expect(view.phase).toBe("authorise");
    expect(view.showQr).toBe(false);
    expect(view.showWalletButton).toBe(true);
    expect(view.primaryAction).toBe("approve");
    // Nothing is waiting until the button is pressed.
    expect(view.pill).toBeNull();
    expect(view.litStars).toBe(4);
    expect(view.animate).toBe(false);
  });

  // The signed form is the DEFAULT DC API transport, so this branch is the one
  // most sessions take. A bare `transport === "dc_api"` would miss it and fall
  // through to the QR branch — rendering a QR of an empty string, because a DC
  // API session has no URI at all.
  it("offers the wallet button for a dc_api_signed session too", () => {
    const view = selectSheetView({ ...base, transport: "dc_api_signed" });
    expect(view.phase).toBe("authorise");
    expect(view.showQr).toBe(false);
    expect(view.showWalletButton).toBe(true);
    expect(view.primaryAction).toBe("approve");
  });

  it("moves to waiting once a dc_api_signed call is in flight", () => {
    const view = selectSheetView({
      ...base,
      transport: "dc_api_signed",
      dcBusy: true,
    });
    expect(view.phase).toBe("waiting");
    expect(view.showWalletButton).toBe(false);
  });

  it("moves to waiting once the dc_api call is in flight", () => {
    const view = selectSheetView({
      ...base,
      transport: "dc_api",
      dcBusy: true,
    });
    expect(view.phase).toBe("waiting");
    expect(view.pill).toBe("Opening your wallet…");
    expect(view.animate).toBe(true);
    expect(view.litStars).toBe(6);
    expect(view.showWalletButton).toBe(false);
  });
});

/**
 * The gap between the wallet answering and the server saying so.
 *
 * Reported from a real payment: for the 2–3s after a successful approval the
 * sheet offered a live "Approve in your wallet" button and a motionless ring.
 * `payViaDcApi` cleared `dcBusy` in a `finally`, so it fired on the SUCCESS
 * path too, while the row stayed `pending` until the poll's next tick — and
 * with `dcBusy: false` and a DC API transport this function fell straight
 * through to `authorise`.
 *
 * `dcSubmitted` is that missing state, and it is deliberately a SECOND flag
 * rather than a `dcBusy` that is never cleared: the two windows want different
 * copy. "Opening your wallet…" is false once the wallet has closed.
 */
describe("selectSheetView — the wallet answered, the verdict has not", () => {
  const submitted: SheetInput = {
    ...base,
    transport: "dc_api_signed",
    dcBusy: false,
    dcSubmitted: true,
  };

  // The bug, stated as the shopper saw it: a second press was possible.
  it("withdraws the wallet button rather than merely disabling it", () => {
    const view = selectSheetView(submitted);
    expect(view.phase).toBe("waiting");
    expect(view.showWalletButton).toBe(false);
    expect(view.primaryAction).toBeNull();
  });

  // The other half of the report: the indicator had stopped.
  it("keeps the indicator running", () => {
    const view = selectSheetView(submitted);
    expect(view.animate).toBe(true);
    expect(view.litStars).toBe(6);
    expect(view.glyph).toBe("card");
  });

  it("says the wallet is done and the payment is being confirmed", () => {
    expect(selectSheetView(submitted).pill).toBe("Confirming your payment…");
  });

  // Distinct copy is the whole reason this is not just a sticky `dcBusy`.
  it("does not reuse the opening-your-wallet pill", () => {
    expect(selectSheetView({ ...submitted, dcBusy: true }).pill).toBe(
      "Opening your wallet…",
    );
  });

  it("applies to the unsigned form too", () => {
    const view = selectSheetView({ ...submitted, transport: "dc_api" });
    expect(view.phase).toBe("waiting");
    expect(view.showWalletButton).toBe(false);
    expect(view.pill).toBe("Confirming your payment…");
  });

  // Cancel stays: the money is not in flight yet — `settling` is where that
  // becomes true, and this state is strictly before it.
  it("still offers cancel, unlike settling", () => {
    expect(selectSheetView(submitted).showCancel).toBe(true);
  });

  /**
   * Ordering. `dcSubmitted` is never cleared, so every later state must
   * outrank it — otherwise the sheet would report "Confirming your payment…"
   * over a completed or declined payment forever.
   */
  it("is outranked by settling", () => {
    const view = selectSheetView({ ...submitted, state: "settling" });
    expect(view.phase).toBe("settling");
    expect(view.pill).toBe("Contacting your bank…");
  });

  it("is outranked by a completed payment", () => {
    const view = selectSheetView({ ...submitted, state: "completed" });
    expect(view.phase).toBe("approved");
    expect(view.headline).toBe("Payment approved");
  });

  it("is outranked by a failed payment", () => {
    const view = selectSheetView({
      ...submitted,
      state: "failed",
      failureReason: "insufficient_funds",
    });
    expect(view.phase).toBe("declined");
    expect(view.primaryAction).toBe("retry");
  });

  // A relay that failed sets dcError, and that must win — otherwise the
  // sticky flag hides the one view offering a way out.
  it("is outranked by a dc error, which is the only way out", () => {
    const view = selectSheetView({ ...submitted, dcError: "failed" });
    expect(view.phase).toBe("declined");
    expect(view.primaryAction).toBe("show-qr");
  });

  // The QR flow never reaches this state: nothing sets dcSubmitted without a
  // DC API call. Pinned so a future refactor cannot leak it across.
  it("has no effect on a request_uri session", () => {
    const view = selectSheetView({ ...base, dcSubmitted: true });
    expect(view.showQr).toBe(true);
    expect(view.pill).toBe("Waiting for your wallet");
  });
});

describe("selectSheetView — settling", () => {
  it("lights eleven stars and withdraws cancel", () => {
    const view = selectSheetView({ ...base, state: "settling" });
    expect(view.phase).toBe("settling");
    expect(view.litStars).toBe(11);
    expect(view.pill).toBe("Contacting your bank…");
    // The money is in flight; a cancel that cannot cancel is a lie.
    expect(view.showCancel).toBe(false);
    expect(view.showQr).toBe(false);
  });
});

describe("selectSheetView — terminal states", () => {
  it("completes the ring and flips the eyebrow on success", () => {
    const view = selectSheetView({
      ...base,
      state: "completed",
      pollStatus: null,
    });
    expect(view.phase).toBe("approved");
    expect(view.eyebrow).toBe("Paid");
    expect(view.litStars).toBe(12);
    expect(view.glyph).toBe("check");
    expect(view.headline).toBe("Payment approved");
    expect(view.showCancel).toBe(false);
    expect(view.showBackToShop).toBe(false);
  });

  it("empties the ring and offers a retry on a decline", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "insufficient_funds",
      pollStatus: null,
    });
    expect(view.phase).toBe("declined");
    expect(view.eyebrow).toBe("Not paid");
    expect(view.litStars).toBe(0);
    expect(view.glyph).toBe("alert");
    expect(view.headline).toBe("Payment declined");
    expect(view.body).toBe("Payment was declined by your bank.");
    expect(view.primaryAction).toBe("retry");
    expect(view.showBackToShop).toBe(true);
    expect(view.showCancel).toBe(false);
  });

  it("offers no retry for a payment the shopper cancelled", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "cancelled",
      pollStatus: null,
    });
    expect(view.primaryAction).toBeNull();
    expect(view.showBackToShop).toBe(true);
  });

  it("declines with a connection message when polling fails", () => {
    const view = selectSheetView({ ...base, pollStatus: "failed" });
    expect(view.phase).toBe("declined");
    expect(view.body).toBe("Lost connection to the payment service.");
  });

  it("declines with an expiry message when polling times out", () => {
    const view = selectSheetView({ ...base, pollStatus: "timeout" });
    expect(view.phase).toBe("declined");
    expect(view.body).toBe("This payment request expired.");
  });

  it("falls back to a generic message for an unmapped failure reason", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "something_new",
      pollStatus: null,
    });
    expect(view.body).toBe("The payment could not be completed.");
  });
});

describe("selectSheetView — dc_api recovery", () => {
  it("offers the QR fallback when the browser cannot open a wallet", () => {
    const view = selectSheetView({
      ...base,
      transport: "dc_api",
      dcError: "unsupported",
    });
    expect(view.phase).toBe("declined");
    expect(view.headline).toBe("Couldn't open your wallet");
    expect(view.body).toBe(
      "This browser does not support the Digital Credentials API.",
    );
    expect(view.primaryAction).toBe("show-qr");
    // A dc_api session is bound to response_mode dc_api.jwt and can never be
    // re-rendered as a QR; recovery is a fresh request_uri session.
    expect(view.showQr).toBe(false);
    expect(view.showWalletButton).toBe(false);
  });

  it("distinguishes a failed invocation from an unsupported browser", () => {
    const view = selectSheetView({
      ...base,
      transport: "dc_api",
      dcError: "failed",
    });
    expect(view.body).toBe("Could not open your wallet on this device.");
    expect(view.primaryAction).toBe("show-qr");
  });
});

describe("selectSheetView — the age clause", () => {
  it("adds the age clause to the QR instruction and changes nothing else", () => {
    const plain = selectSheetView(base);
    const aged = selectSheetView({ ...base, ageRequested: true });
    expect(plain.body).toBe(
      "Scan with your EUDI Wallet to approve the payment.",
    );
    expect(aged.body).toBe(
      "Scan with your EUDI Wallet to approve the payment and confirm you're over 18.",
    );
    // Only `body` may differ — the age clause is copy, not a layout change.
    expect({ ...aged, body: plain.body }).toEqual(plain);
  });

  it("adds the age clause to the same-device instruction", () => {
    const aged = selectSheetView({
      ...base,
      transport: "dc_api",
      ageRequested: true,
    });
    expect(aged.body).toBe(
      "Your wallet will confirm the amount and that you're over 18.",
    );
  });
});
