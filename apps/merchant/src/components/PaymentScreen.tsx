"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { QrCanvas, useIsTouch, useStatusPoll } from "@demo/ui";
import { formatEuroCents } from "@/lib/format.js";
import { EudiPayLogo } from "./EudiPayLogo.js";

/** EudiPay brand blue — also the QR's dark modules (spec §9.5). */
const BRAND_BLUE = "#004DD7";

export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
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
  initialState,
  initialFailureReason,
}: PaymentScreenProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const [redirecting, setRedirecting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

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
  useEffect(() => {
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [isTouch, terminalAtRender, redirecting, openid4vpUri]);

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
        body: JSON.stringify({ orderId }),
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
      <div className="eudipay-card">
        <EudiPayLogo className="mx-auto h-[100px] w-[100px]" />
        <h1 className="eudipay-headline mt-2">EudiPay</h1>

        <p className="eudipay-amount mt-4">{formatEuroCents(amountCents)}</p>
        <p className="eudipay-muted text-sm">
          {merchantName} · Order {orderId}
        </p>

        {state === "completed" ? (
          <>
            <div className="mt-6 text-5xl" aria-hidden="true">
              🇪🇺
            </div>
            <p className="mt-3 text-lg font-bold" style={{ color: BRAND_BLUE }}>
              Payment Successful
            </p>
          </>
        ) : showError ? (
          <>
            <div className="mt-6 text-5xl" aria-hidden="true">
              ⚠️
            </div>
            <p className="mt-3 text-lg font-bold">Payment failed</p>
            <p className="eudipay-muted mt-1 text-sm">{errorMessage}</p>
            {failedChecks.length > 0 ? (
              <p className="eudipay-muted mt-2 text-xs">
                Failed checks: <span className="font-mono">{failedChecks.join(", ")}</span>
              </p>
            ) : null}
            {retryError ? (
              <p role="alert" className="mt-2 text-sm text-[#b91c1c]">
                {retryError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col gap-2">
              {failureReason === "cancelled" ? null : (
                <button
                  type="button"
                  onClick={tryAgain}
                  className="eudipay-button eudipay-button-primary"
                >
                  Try Again
                </button>
              )}
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="eudipay-button eudipay-button-secondary"
              >
                Back to shop
              </button>
            </div>
          </>
        ) : redirecting ? (
          <>
            <div className="eudipay-spinner mt-6" />
            <p className="eudipay-muted mt-4 text-sm">Opening your wallet…</p>
            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-4"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <p className="eudipay-badge mt-4">
              {state === "settling" ? "Contacting your bank…" : "Waiting for your wallet"}
            </p>

            <div className="eudipay-qr-frame mt-5">
              <QrCanvas
                value={openid4vpUri}
                size={240}
                darkColor={BRAND_BLUE}
                ariaLabel="QR code for the payment request"
              />
            </div>

            <p className="eudipay-muted mt-4 text-sm">
              Scan this code with your EUDI Wallet app to authorize the payment.
            </p>

            <button
              type="button"
              onClick={cancel}
              className="eudipay-button eudipay-button-secondary mt-5"
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}