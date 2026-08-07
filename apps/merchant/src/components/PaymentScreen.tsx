"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
import { EudiPayLogo } from "./EudiPayLogo.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** EudiPay brand blue — also the QR's dark modules (spec §9.5). */
const BRAND_BLUE = "#004DD7";

export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  dcApiRequest: unknown;
  /** A session that was already terminal when the page rendered. */
  initialState: string;
  initialFailureReason?: string;
}

interface SessionStatus {
  state: string;
  failureReason?: string;
  failedChecks: string[];
}

/** Spec §6.3's failure table, in the user's words rather than the code's. */
const FAILURE_MESSAGE: Record<string, string> = {
  cancelled: "This payment was cancelled.",
  verification_failed: "Your card could not be verified.",
  transaction_data_binding_failed:
    "The amount could not be confirmed against your wallet's approval.",
  insufficient_funds: "Payment was declined by your bank.",
  credential_invalid: "This card is no longer valid.",
  bank_unreachable: "Could not reach your bank. Nothing was charged.",
  foundry_unavailable: "The payment service is unavailable. Please try again.",
};

export function PaymentScreen({
  sessionId,
  orderId,
  amountCents,
  merchantName,
  openid4vpUri,
  transport,
  dcApiRequest,
  initialState,
  initialFailureReason,
}: PaymentScreenProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const [redirecting, setRedirecting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [dcFailed, setDcFailed] = useState(false);
  const [dcMessage, setDcMessage] = useState<string | null>(null);
  const [dcBusy, setDcBusy] = useState(false);

  const terminalAtRender = initialState === "completed" || initialState === "failed";

  const fetchOnce = useCallback<() => Promise<SessionStatus>>(async () => {
    const response = await fetch(`/api/payment-sessions/${sessionId}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
      checks?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined,
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

  // On a touch device the wallet lives on this same phone, so follow the deep
  // link rather than rendering a QR nobody can scan. Previously this was an
  // EUDIPAY_REDIRECT postMessage to a parent frame; with no parent, this route
  // navigates itself (spec §9.5).
  // Under dc_api there is no URI to navigate to, and the gesture requirement
  // forbids an on-mount action anyway.
  useEffect(() => {
    if (transport !== "request_uri") return;
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [transport, isTouch, terminalAtRender, redirecting, openid4vpUri]);

  useEffect(() => {
    if (state !== "completed") return;
    const timer = setTimeout(() => router.replace(`/success?orderId=${orderId}`), 1500);
    return () => clearTimeout(timer);
  }, [state, router, orderId]);

  async function cancel() {
    await fetch(`/api/payment-sessions/${sessionId}/cancel`, { method: "POST" });
    router.replace("/");
  }

  async function tryAgain() {
    setRetryError(null);
    try {
      // A fresh presentation for the same still-pending order (spec §6.3).
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A dc_api session existing at all is proof detection said yes on this
        // browser, so a retry keeps the preferred transport (spec D1).
        body: JSON.stringify({ orderId, dcApi: transport === "dc_api" }),
      });
      if (!response.ok) {
        setRetryError("Could not start a new payment. Please start over from the shop.");
        return;
      }
      const body = (await response.json()) as { sessionId: string };
      router.replace(`/pay/${body.sessionId}`);
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
      setDcMessage(
        isDcApiNotSupportedError(err)
          ? "This browser does not support the Digital Credentials API."
          : "Could not open your wallet on this device.",
      );
      setDcFailed(true);
    } finally {
      setDcBusy(false);
    }
  }

  // A dc_api session cannot be re-rendered as a QR: it is bound to
  // response_mode dc_api.jwt with an inlined request object. Recovery means a
  // fresh request_uri session for the same still-pending order.
  async function showQrInstead() {
    setRetryError(null);
    try {
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, dcApi: false }),
      });
      if (!response.ok) {
        setRetryError("Could not start a new payment. Please start over from the shop.");
        return;
      }
      const body = (await response.json()) as { sessionId: string };
      router.replace(`/pay/${body.sessionId}`);
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    }
  }

  const connectionLost = outcome?.status === "failed";
  const expired = outcome?.status === "timeout";
  const showError = state === "failed" || connectionLost || expired;

  const errorMessage = expired
    ? "This payment request expired."
    : connectionLost
      ? "Lost connection to the payment service."
      : (failureReason && FAILURE_MESSAGE[failureReason]) ||
        "The payment could not be completed.";

  return (
    <div className="eudipay-overlay" role="dialog" aria-modal="true" aria-label="EudiPay payment">
      <div className="eudipay-card px-7 py-8">
        <EudiPayLogo className="mx-auto h-16 w-16" />
        <h1 className="eudipay-headline mt-2.5">EudiPay</h1>

        {/* The amount is what is being consented to, so it is the largest
            thing on the sheet. Merchant and order sit beneath it as context. */}
        <p className="eudipay-amount mt-6">{formatEuroCents(amountCents)}</p>
        <p className="eudipay-muted mt-2 text-sm">
          {merchantName} · Order <span className="font-mono text-xs">{orderId}</span>
        </p>

        {state === "completed" ? (
          <>
            <CheckMark className="mx-auto mt-7 h-12 w-12 text-[#004DD7]" />
            <p className="mt-3 text-lg font-bold" style={{ color: BRAND_BLUE }}>
              Payment successful
            </p>
            <p className="eudipay-muted mt-1 text-sm">Taking you to your receipt…</p>
          </>
        ) : showError ? (
          <>
            <AlertMark className="mx-auto mt-7 h-12 w-12 text-[#b91c1c]" />
            <p className="mt-3 text-lg font-bold">Payment failed</p>
            <p className="eudipay-muted mt-1 text-sm">{errorMessage}</p>
            {failedChecks.length > 0 ? (
              <p className="eudipay-muted mt-3 text-xs">
                Failed checks: <span className="font-mono">{failedChecks.join(", ")}</span>
              </p>
            ) : null}
            {retryError ? (
              <p role="alert" className="mt-2 text-sm text-[#b91c1c]">
                {retryError}
              </p>
            ) : null}
            <div className="mt-7 flex flex-col gap-1.5">
              {failureReason === "cancelled" ? null : (
                <button
                  type="button"
                  onClick={tryAgain}
                  className="eudipay-button eudipay-button-primary py-3"
                >
                  Try again
                </button>
              )}
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="eudipay-button eudipay-button-secondary py-3"
              >
                Back to the shop
              </button>
            </div>
          </>
        ) : redirecting ? (
          <>
            <div className="eudipay-spinner mt-8" />
            <p className="eudipay-muted mt-4 text-sm">Opening your wallet…</p>
            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-5 py-3"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <p className="eudipay-badge mt-5 px-3 py-1.5">
              {state === "settling" ? "Contacting your bank…" : "Waiting for your wallet"}
            </p>

            {transport === "dc_api" && !dcFailed ? (
              <>
                <button
                  type="button"
                  onClick={payViaDcApi}
                  disabled={dcBusy}
                  className="eudipay-button eudipay-button-primary mt-6 py-3"
                >
                  {dcBusy ? "Opening your wallet…" : "Pay with your wallet"}
                </button>
                <p className="eudipay-muted mt-4 text-sm">
                  Approve the payment in your EUDI Wallet.
                </p>
              </>
            ) : transport === "dc_api" ? (
              <>
                <p role="alert" className="mt-6 text-sm font-medium text-[#b91c1c]">
                  {dcMessage}
                </p>
                <button
                  type="button"
                  onClick={showQrInstead}
                  className="eudipay-button eudipay-button-primary mt-4 py-3"
                >
                  Show QR code
                </button>
                {retryError ? (
                  <p role="alert" className="eudipay-muted mt-2 text-sm">
                    {retryError}
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <div className="eudipay-qr-frame mt-5 p-3">
                  <QrCanvas
                    value={openid4vpUri}
                    size={220}
                    darkColor={BRAND_BLUE}
                    ariaLabel="QR code for the payment request"
                  />
                </div>

                <p className="eudipay-muted mt-4 text-sm">
                  Scan this with your EUDI Wallet to approve the payment.
                </p>
              </>
            )}

            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-5 py-3"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}