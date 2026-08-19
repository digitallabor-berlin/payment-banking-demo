"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DC_API_PRESENTATION_PROTOCOL,
  QrCanvas,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
import { formatEuroCents } from "@/lib/format.js";
import { selectSheetView, type DcError } from "@/lib/sheet-state.js";
import { useCart } from "@/lib/useCart.js";
// NB: EudiPayLogo is deliberately NOT imported. The ring draws its own card
// glyph at the centre, so importing the standalone mark here would both put two
// cards on one sheet and trip `noUnusedLocals`.
import { EudiPayRing } from "./EudiPayRing.js";

/** EudiPay brand blue — also the QR's dark modules (spec §9.5). */
const BRAND_BLUE = "#004DD7";

export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  /** True when this session presents `dpc_av`; adds one clause to the copy. */
  ageRequested: boolean;
  dcApiRequest: unknown;
  /** A session that was already terminal when the page rendered. */
  initialState: string;
  initialFailureReason?: string;
  /**
   * Close the sheet and return to the page underneath. Present only when the
   * sheet is a modal on /checkout — /pay/[sessionId] is a server component and
   * cannot pass a function, so there it falls back to navigating home.
   */
  onClose?: () => void;
}

interface SessionStatus {
  state: string;
  failureReason?: string;
  failedChecks: string[];
}

export function PaymentScreen({
  sessionId,
  orderId,
  amountCents,
  merchantName,
  openid4vpUri,
  transport,
  ageRequested,
  dcApiRequest,
  initialState,
  initialFailureReason,
  onClose,
}: PaymentScreenProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const { clear } = useCart();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [dcError, setDcError] = useState<DcError>(null);
  const [dcBusy, setDcBusy] = useState(false);

  const terminalAtRender = initialState === "completed" || initialState === "failed";

  const fetchOnce = useCallback<() => Promise<SessionStatus>>(async () => {
    const response = await fetch(`/api/payment-sessions/${sessionId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
      checks?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason:
        typeof body.failureReason === "string" ? body.failureReason : undefined,
      // Spec §6.3 requires a failed verification to name the checks that
      // failed, so they are carried through rather than discarded.
      failedChecks: Array.isArray(body.checks)
        ? body.checks.flatMap((entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as { passed?: unknown }).passed === false &&
            typeof (entry as { check?: unknown }).check === "string"
              ? [(entry as { check: string }).check]
              : [],
          )
        : [],
    };
  }, [sessionId]);

  const isTerminal = useCallback(
    (value: SessionStatus) => value.state === "completed" || value.state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<SessionStatus>({
    fetchOnce,
    isTerminal,
    enabled: !terminalAtRender,
  });

  const state = value?.state ?? initialState;
  const failureReason = value?.failureReason ?? initialFailureReason;
  const failedChecks = value?.failedChecks ?? [];

  const view = selectSheetView({
    state,
    transport,
    ageRequested,
    redirecting,
    dcBusy,
    dcError,
    // PollOutcome's union is "terminal" | "timeout" | "failed" | "aborted".
    // Only two of those change what the sheet shows: `terminal` is already
    // expressed by `state` becoming completed/failed, and `aborted` only fires
    // on unmount, when nothing renders anyway.
    pollStatus:
      outcome?.status === "failed"
        ? "failed"
        : outcome?.status === "timeout"
          ? "timeout"
          : terminalAtRender
            ? null
            : "running",
    failureReason,
  });

  // On a touch device the wallet lives on this same phone, so follow the deep
  // link rather than rendering a QR nobody can scan (spec §9.5). Under dc_api
  // there is no URI to navigate to, and the gesture requirement forbids an
  // on-mount action anyway.
  useEffect(() => {
    if (transport !== "request_uri") return;
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [transport, isTouch, terminalAtRender, redirecting, openid4vpUri]);

  // The cart is cleared HERE, not when the form was submitted: the basket is
  // the content this sheet sits over, and a declined payment must leave it
  // intact so "Back to the shop" is recoverable.
  useEffect(() => {
    if (state !== "completed") return;
    clear();
    const timer = setTimeout(() => router.replace(`/success?orderId=${orderId}`), 1500);
    return () => clearTimeout(timer);
  }, [state, router, orderId, clear]);

  // Modal behaviour (spec §5.6): real focusable content now sits behind this
  // dialog, so focus must be captured, moved in, and handed back.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => restoreFocusTo.current?.focus();
  }, []);

  const cancel = useCallback(async () => {
    await fetch(`/api/payment-sessions/${sessionId}/cancel`, { method: "POST" });
    if (onClose) onClose();
    else router.replace("/");
  }, [sessionId, onClose, router]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && view.showCancel) {
      event.preventDefault();
      void cancel();
      return;
    }
    if (event.key !== "Tab") return;
    // A minimal trap: cycle within the sheet rather than escaping to the inert
    // page behind it.
    const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** A fresh presentation for the same still-pending order (spec §6.3). */
  async function startFreshSession(dcApi: boolean) {
    setRetryError(null);
    try {
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, dcApi }),
      });
      if (!response.ok) {
        setRetryError("Could not start a new payment. Please start over from the shop.");
        return;
      }
      const body = (await response.json()) as { sessionId: string };
      router.replace(`/checkout?session=${body.sessionId}`);
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    }
  }

  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. dcApiRequest is already a prop.
  async function payViaDcApi() {
    setDcBusy(true);
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(dcApiRequest, DC_API_PRESENTATION_PROTOCOL),
      );
      await fetch(`/api/payment-sessions/${sessionId}/dc-api-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: data.response }),
      });
      // The poll already running picks up the verdict on its next tick.
    } catch (err) {
      setDcError(isDcApiNotSupportedError(err) ? "unsupported" : "failed");
    } finally {
      setDcBusy(false);
    }
  }

  function onPrimaryAction() {
    if (view.primaryAction === "approve") void payViaDcApi();
    // A dc_api session cannot be re-rendered as a QR: it is bound to
    // response_mode dc_api.jwt with an inlined request object. Recovery is a
    // fresh request_uri session for the same still-pending order.
    else if (view.primaryAction === "show-qr") void startFreshSession(false);
    // A dc_api session existing at all proves detection said yes on this
    // browser, so a retry keeps the preferred transport (spec D1).
    else if (view.primaryAction === "retry") void startFreshSession(transport === "dc_api");
  }

  const primaryLabel =
    view.primaryAction === "approve"
      ? dcBusy
        ? "Opening your wallet…"
        : "Approve in your wallet"
      : view.primaryAction === "show-qr"
        ? "Show QR code"
        : "Try again";

  return (
    <div className="eudipay-overlay">
      <div
        ref={sheetRef}
        className="eudipay-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="EudiPay payment"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <EudiPayRing
          litStars={view.litStars}
          animate={view.animate}
          glyph={view.glyph}
          className="mx-auto block h-28 w-28"
        />
        <p className="eudipay-mark">EudiPay</p>

        <div className="eudipay-rule" />

        <p className={view.phase === "declined" ? "eudipay-eyebrow is-alarm" : "eudipay-eyebrow"}>
          {view.eyebrow}
        </p>
        {/* The amount is the largest thing on the sheet in every state: the
            shopper's question is always "what happened to my €17.47". */}
        <p className={view.showQr ? "eudipay-amount is-compact" : "eudipay-amount"}>
          {formatEuroCents(amountCents)}
        </p>

        <div className="eudipay-strip">
          <div className="eudipay-cell">
            <p className="eudipay-cell-k">Payee</p>
            <p className="eudipay-cell-v">{merchantName}</p>
          </div>
          <div className="eudipay-cell">
            <p className="eudipay-cell-k">Order</p>
            <p className="eudipay-cell-v">{orderId}</p>
          </div>
        </div>

        {/* The ring is aria-hidden, so this region is how state reaches a
            screen reader. */}
        <div role="status">
          {view.pill ? <p className="eudipay-pill">{view.pill}</p> : null}
          {view.headline ? <p className="eudipay-headline">{view.headline}</p> : null}
        </div>

        {view.showQr ? (
          <div className="eudipay-qr-frame">
            <QrCanvas
              value={openid4vpUri}
              size={200}
              darkColor={BRAND_BLUE}
              ariaLabel="QR code for the payment request"
            />
          </div>
        ) : null}

        <p className="eudipay-body">{view.body}</p>

        {failedChecks.length > 0 ? (
          <p className="eudipay-checks">failed: {failedChecks.join(", ")}</p>
        ) : null}

        {retryError ? (
          <p role="alert" className="eudipay-body">
            {retryError}
          </p>
        ) : null}

        {view.primaryAction || view.showBackToShop ? (
          <div className="eudipay-actions">
            {view.primaryAction ? (
              <button
                type="button"
                onClick={onPrimaryAction}
                disabled={dcBusy}
                className="eudipay-button eudipay-button-primary"
              >
                {primaryLabel}
              </button>
            ) : null}
            {view.showBackToShop ? (
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="eudipay-button eudipay-button-secondary"
              >
                Back to the shop
              </button>
            ) : null}
          </div>
        ) : null}

        {view.showCancel ? (
          <button type="button" onClick={() => void cancel()} className="eudipay-cancel">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}