"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DC_API_PRESENTATION_PROTOCOL,
  QrCanvas,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useDcApiSupport,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  isLoginTerminal,
  loginFailureKey,
  selectLoginAffordance,
  selectLoginPhase,
  type LoginDcError,
} from "@/lib/login-dialog-state.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

export interface WalletLoginDialogProps {
  sessionId: string;
  /** Null under dc_api — foundry inlines the request object instead. */
  uri: string | null;
  dcApiRequest: unknown;
  locale: Locale;
  onClose: () => void;
}

interface PollState {
  state: string;
  failureReason?: string;
}

export function WalletLoginDialog({
  sessionId,
  uri,
  dcApiRequest,
  locale,
  onClose,
}: WalletLoginDialogProps) {
  const router = useRouter();
  const t = MESSAGES[locale].walletLogin;
  const isTouch = useIsTouch();
  const dcSupported = useDcApiSupport("get", DC_API_PRESENTATION_PROTOCOL);
  const [dcError, setDcError] = useState<LoginDcError>(null);
  const [claimed, setClaimed] = useState(false);

  const fetchOnce = useCallback<() => Promise<PollState>>(async () => {
    const response = await fetch(`/api/auth/wallet-login/${sessionId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason:
        typeof body.failureReason === "string" ? body.failureReason : undefined,
    };
  }, [sessionId]);

  const isTerminal = useCallback(
    (value: PollState) => isLoginTerminal(value.state),
    [],
  );

  const { value, outcome } = useStatusPoll<PollState>({ fetchOnce, isTerminal });

  // The claim is a SEPARATE request from the poll, and it is a POST. A GET
  // that minted a session would be consumed by a prefetch or a double-poll.
  useEffect(() => {
    if (value?.state !== "verified" || claimed) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/auth/wallet-login/${sessionId}/claim`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (!response.ok) {
          // KNOWN GAP: the poll is already terminal on `verified`, so a refused
          // claim leaves the dialog on its waiting face until the holder
          // cancels. Reaching here needs the state to change between the poll
          // reading it and this POST — the race the route's 409 exists to
          // close — so it is rare rather than impossible.
          setDcError(null);
          return;
        }
        setClaimed(true);
        // Let the success state be seen, then land on the dashboard. The
        // cookie already exists at this point, so / will not bounce back.
        setTimeout(() => {
          router.replace("/");
          router.refresh();
        }, 1200);
      } catch {
        if (!cancelled) setDcError("failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [value, claimed, sessionId, router]);

  const pollFailed =
    outcome !== null &&
    outcome.status !== "aborted" &&
    outcome.status !== "terminal";

  const phase = selectLoginPhase(value?.state ?? null, claimed, pollFailed);
  const affordance = selectLoginAffordance(dcSupported, dcError, isTouch);
  const failureBody = t[loginFailureKey(value?.failureReason)];

  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. dcApiRequest is already a prop.
  async function signInViaDcApi() {
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(dcApiRequest, DC_API_PRESENTATION_PROTOCOL),
      );
      await fetch(`/api/auth/wallet-login/${sessionId}/dc-api-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: data.response }),
      });
      // The poll already running picks up the verdict on its next tick.
    } catch (err) {
      setDcError(isDcApiNotSupportedError(err) ? "unsupported" : "failed");
    }
  }

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
    >
      <div className="dialog-card px-7 py-8">
        {phase === "waiting" ? (
          <>
            <h2 className="panel-title">{t.title}</h2>

            {affordance === "preparing" ? (
              <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t.preparing}
              </p>
            ) : null}

            {affordance === "dc-api" ? (
              <>
                <button
                  type="button"
                  onClick={signInViaDcApi}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
                  {t.approve}
                </button>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {affordance === "deep-link" && uri ? (
              <>
                <a href={uri} className="btn btn-primary mt-6 px-5 py-3">
                  {t.openInWallet}
                </a>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {affordance === "qr" && uri ? (
              <>
                <div className="qr-frame mt-6 p-3">
                  <QrCanvas
                    value={uri}
                    size={220}
                    darkColor={QR_DARK}
                    ariaLabel={t.qrAlt}
                  />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.scanCode}
                </p>
              </>
            ) : null}

            <p className="eyebrow mt-4">{t.waiting}</p>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-quiet mt-5 px-3 py-2"
            >
              {t.cancel}
            </button>
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <CheckMark className="mx-auto h-12 w-12 text-[var(--color-success)]" />
            <h2 className="panel-title mt-4 text-[var(--color-success)]">
              {t.successTitle}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
              {t.successBody}
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <AlertMark className="mx-auto h-12 w-12 text-[var(--color-destructive)]" />
            <h2 className="panel-title mt-4">{t.failedTitle}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {failureBody}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary mt-6 px-5 py-2.5"
            >
              {t.close}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}