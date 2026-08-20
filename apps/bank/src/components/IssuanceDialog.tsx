"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DC_API_ISSUANCE_PROTOCOL,
  QrCanvas,
  invokeDcCreate,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useDcApiSupport,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
import type { IssuanceCopy } from "@/lib/credential-copy.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

type Phase = "waiting" | "success" | "error";

export interface IssuanceDialogProps {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
  copy: IssuanceCopy;
  locale: Locale;
  onClose: () => void;
}

export function IssuanceDialog({
  sessionId,
  offerUri,
  dcApiOffer,
  copy,
  locale,
  onClose,
}: IssuanceDialogProps) {
  const router = useRouter();
  const t = MESSAGES[locale];
  const isTouch = useIsTouch();
  const dcSupported = useDcApiSupport("create", DC_API_ISSUANCE_PROTOCOL);
  const [dcFailed, setDcFailed] = useState(false);
  const [dcMessage, setDcMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("waiting");

  const fetchOnce = useCallback(async () => {
    const response = await fetch(`/api/credentials/${sessionId}/status`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body: unknown = await response.json();
    const state = (body as { state?: unknown }).state;
    return typeof state === "string" ? state : "offered";
  }, [sessionId]);

  const isTerminal = useCallback(
    (state: string) => state === "active" || state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<string>({ fetchOnce, isTerminal });

  useEffect(() => {
    if (!outcome) return;
    if (outcome.status === "terminal" && outcome.value === "active") {
      setPhase("success");
      // Let the success state be seen, then refresh the dashboard behind it.
      const timer = setTimeout(() => {
        onClose();
        router.refresh();
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (outcome.status !== "aborted") setPhase("error");
    return;
  }, [outcome, onClose, router]);

  const errorMessage =
    outcome?.status === "timeout"
      ? t.errors.expired
      : outcome?.status === "failed"
        ? t.errors.connectionLost
        : copy.failureBody;

  // No `await` may execute before invokeDcCreate — Chrome consumes the click's
  // transient activation otherwise. dcApiOffer is already a prop, so nothing
  // needs fetching here.
  async function addViaDcApi() {
    try {
      await invokeDcCreate(
        prepareDcApiRequest(dcApiOffer, DC_API_ISSUANCE_PROTOCOL),
      );
    } catch (err) {
      // Now catalogued like any other copy. These used to be hardcoded English
      // on the grounds that a browser-capability failure is a technical signal
      // rather than customer copy — which stopped holding once a German
      // customer could meet them inside an otherwise fully German UI.
      setDcMessage(
        isDcApiNotSupportedError(err)
          ? t.errors.dcApiUnsupported
          : t.errors.dcApiCancelled,
      );
      setDcFailed(true);
    }
  }

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
    >
      <div className="dialog-card px-7 py-8">
        {phase === "waiting" ? (
          <>
            <h2 className="panel-title">{copy.title}</h2>

            {dcSupported === null ? (
              /* "Not yet known" is NOT "unavailable". Rendering the QR here
                 would flash it on Android before it disappears. */
              <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t.issuance.preparing}
              </p>
            ) : dcSupported && !dcFailed ? (
              <>
                <button
                  type="button"
                  onClick={addViaDcApi}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
                  {t.issuance.addToWallet}
                </button>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.issuance.confirmInApp}
                </p>
              </>
            ) : isTouch ? (
              <>
                <a href={offerUri} className="btn btn-primary mt-6 px-5 py-3">
                  {t.issuance.openInWallet}
                </a>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.issuance.confirmInApp}
                </p>
              </>
            ) : (
              <>
                <div className="qr-frame mt-6 p-3">
                  <QrCanvas
                    value={offerUri}
                    size={220}
                    darkColor={QR_DARK}
                    ariaLabel={t.issuance.qrAlt}
                  />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.issuance.scanCode}
                </p>
              </>
            )}

            {dcMessage ? (
              <p
                role="alert"
                className="mt-3 text-xs font-medium text-[var(--color-destructive)]"
              >
                {dcMessage}
              </p>
            ) : null}

            <p className="eyebrow mt-4">
              {value === "offered" || value === null
                ? t.issuance.waiting
                : value}
            </p>

            <button
              type="button"
              onClick={onClose}
              className="btn btn-quiet mt-5 px-3 py-2"
            >
              {t.issuance.cancel}
            </button>
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <CheckMark className="mx-auto h-12 w-12 text-[var(--color-success)]" />
            <h2 className="panel-title mt-4 text-[var(--color-success)]">
              {copy.successTitle}
            </h2>
            <p className="mt-1.5 text-sm text-[var(--color-muted-foreground)]">
              {copy.successBody}
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <AlertMark className="mx-auto h-12 w-12 text-[var(--color-destructive)]" />
            <h2 className="panel-title mt-4">{t.issuance.failedTitle}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-primary mt-6 px-5 py-2.5"
            >
              {t.issuance.close}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
