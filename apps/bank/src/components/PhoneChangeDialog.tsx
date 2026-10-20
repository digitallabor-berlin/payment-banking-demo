"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  DC_API_PRESENTATION_PROTOCOL_SIGNED,
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
import { needsQrRecovery } from "@/lib/limit-dialog-state.js";
import {
  selectLoginAffordance,
  type LoginDcError,
} from "@/lib/login-dialog-state.js";
import {
  canSubmitPhone,
  isPhoneTerminal,
  phoneFailureKey,
  selectPhonePhase,
} from "@/lib/phone-dialog-state.js";
import { selectTransport, type DcApiForm } from "@/lib/transport.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

/**
 * The shape `POST /api/profile/phone-change` answers with — a
 * `PhoneChangeSessionDto`, under the dialog's own prop names.
 *
 * The `as` cast below is irreducible (`.json()` is untyped at runtime), but
 * there is exactly ONE of it, against a body a named function with a
 * written-out return annotation produces. This repo's `dcApiProtocol` bug came
 * from three hand-written copies of a projection and a cast asserting a shape
 * nobody produced.
 */
interface PhoneSession {
  sessionId: string;
  uri: string | null;
  dcApiRequest: unknown;
  dcApiProtocol: string | null;
  newPhone: string;
}

interface PollState {
  state: string;
  failureReason?: string;
}

export interface PhoneChangeDialogProps {
  /** The number in force. Pre-fills the field and gates Continue. */
  phoneNumber: string;
  locale: Locale;
  /** Which DC API wire form to ask for, resolved from `?dcapi=` by the page. */
  dcApiForm: DcApiForm;
  onClose: () => void;
}

export function PhoneChangeDialog({
  phoneNumber,
  locale,
  dcApiForm,
  onClose,
}: PhoneChangeDialogProps) {
  const router = useRouter();
  const t = MESSAGES[locale].phones;
  const isTouch = useIsTouch();
  const [session, setSession] = useState<PhoneSession | null>(null);
  /**
   * Pre-filled with the number in force — the customer's own choice over a
   * read-only "current" line plus an empty "new" one. The consequence is
   * accepted: the old value disappears as soon as they type, and the only
   * place both numbers appear together is the wallet, which is where the
   * comparison is supposed to happen.
   */
  const [typed, setTyped] = useState(phoneNumber);
  const [starting, setStarting] = useState(false);
  /**
   * The `error` member of a non-2xx START, so a refused start says *why*
   * rather than silently returning to the form. `selectPhonePhase` promotes
   * `pollFailed` above `state === null` for the same reason — the limit change
   * shipped that bug once, and locally it is every attempt.
   */
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [dcError, setDcError] = useState<LoginDcError>(null);
  const [applied, setApplied] = useState(false);
  /**
   * The `error` member of a non-2xx apply, fed into `phoneFailureKey` beside
   * the session's own `failure_reason`. `phone_changed` ONLY ever arrives this
   * way — the poll structurally cannot write it — so without this the
   * phoneChanged copy would be dead and a stale-snapshot refusal would read as
   * the generic "could not be verified", hiding the one failure a retry fixes.
   */
  const [applyError, setApplyError] = useState<string | undefined>(undefined);

  // Detect against the identifier this session actually holds; the signed form
  // is the default when there is none, because that is what the button asks
  // for. On the one browser we can measure the argument is inert anyway.
  const dcSupported = useDcApiSupport(
    "get",
    session?.dcApiProtocol ?? DC_API_PRESENTATION_PROTOCOL_SIGNED,
  );

  const fetchOnce = useCallback<() => Promise<PollState>>(async () => {
    const response = await fetch(
      `/api/profile/phone-change/${session!.sessionId}`,
      { cache: "no-store" },
    );
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
  }, [session]);

  const isTerminal = useCallback(
    (value: PollState) => isPhoneTerminal(value.state),
    [],
  );

  const { value, outcome } = useStatusPoll<PollState>({
    fetchOnce,
    isTerminal,
    // Suspended until a session exists, so the form does not poll a URL it has
    // no id for.
    enabled: session !== null,
  });

  // The apply is a SEPARATE request from the poll, and it is a POST. A GET
  // that wrote to a customer's row would be consumed by a prefetch or a
  // double-poll.
  useEffect(() => {
    if (!session || value?.state !== "verified" || applied || applyError) {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/profile/phone-change/${session.sessionId}/apply`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (!response.ok) {
          // `fetch` does not throw on a non-2xx. Without this the dialog would
          // claim a number it did not write.
          const body = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          setApplyError(
            typeof body?.error === "string" ? body.error : "not_verified",
          );
          return;
        }
        setApplied(true);
        // The panel behind the dialog reads the number from a server
        // component, so it needs a refresh rather than a state update.
        router.refresh();
      } catch {
        if (!cancelled) setApplyError("verification_failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, value, applied, applyError, router]);

  const pollFailed =
    startError !== undefined ||
    applyError !== undefined ||
    (outcome !== null &&
      outcome.status !== "aborted" &&
      outcome.status !== "terminal");

  const phase = selectPhonePhase(
    session === null ? null : (value?.state ?? "pending"),
    applied,
    pollFailed,
  );
  const affordance = selectLoginAffordance(dcSupported, dcError, isTouch);
  const failureBody =
    t[phoneFailureKey(startError ?? applyError ?? value?.failureReason)];
  const offerQrRecovery = needsQrRecovery(dcError, session?.uri ?? null);
  const canContinue = canSubmitPhone(typed, phoneNumber);

  /**
   * Opens a session for the typed number.
   *
   * `transport` is forced to `request_uri` by the QR recovery below. A DC API
   * session cannot be re-rendered as a QR — foundry inlines its request object
   * and returns no URI at all — so recovery means creating a NEW session, not
   * drawing the existing one differently.
   */
  async function start(forceTransport?: "request_uri") {
    if (!canContinue) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const response = await fetch("/api/profile/phone-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phoneNumber: typed,
          transport: forceTransport ?? selectTransport(dcSupported, dcApiForm),
        }),
      });
      if (!response.ok) {
        // `fetch` does not throw on a non-2xx. Carry the reason through so
        // `invalid_phone`, `phone_unchanged` and `metadata_unavailable` do not
        // all read as nothing having happened.
        const body = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setStartError(
          typeof body?.error === "string" ? body.error : "verification_failed",
        );
        return;
      }
      setSession((await response.json()) as PhoneSession);
      // `dcError` is deliberately NOT cleared. The recovery session is
      // cross-device and carries a URI, and `selectLoginAffordance` only
      // answers "qr"/"deep-link" while `dcError` is set — clearing it sends
      // the affordance straight back to the wallet button the holder just
      // watched fail. `needsQrRecovery` then goes false on its own, because
      // the URI exists, so the recovery prompt hides itself without the reset.
    } catch {
      setStartError("verification_failed");
    } finally {
      setStarting(false);
    }
  }

  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. `session.dcApiRequest` is already in state
  // by the time this button renders, because the session is created on
  // Continue rather than inside this handler.
  async function approveViaDcApi() {
    if (!session) return;
    // A session created before detection resolved is cross-device and carries
    // no identifier, while this dialog's own detection may since have answered
    // yes. Inventing one here is exactly the mispairing persisting it
    // prevents. Synchronous, so the click's activation survives it.
    if (!session.dcApiProtocol) {
      setDcError("unsupported");
      return;
    }
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(session.dcApiRequest, session.dcApiProtocol),
      );
      const relayed = await fetch(
        `/api/profile/phone-change/${session.sessionId}/dc-api-response`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ response: data.response }),
        },
      );
      // `fetch` does not throw on a non-2xx, so without this a 500 would count
      // as success and strand the dialog on its waiting face.
      if (!relayed.ok) setDcError("failed");
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
      aria-label={t.dialogTitle}
    >
      <div className="dialog-card px-7 py-8">
        {phase === "form" ? (
          <>
            <h2 className="panel-title">{t.dialogTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {t.dialogLead}
            </p>

            <label htmlFor="phone-change-number" className="eyebrow mt-6 block">
              {t.mobileNumber}
            </label>
            <input
              id="phone-change-number"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="mono mt-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-base focus:border-[var(--color-primary)] focus:outline-none"
            />
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
              {t.hint}
            </p>

            <div className="mt-7 flex items-center gap-3">
              <button
                type="button"
                // Wrapped, not passed directly: `start` takes an optional
                // transport, and React would hand it the MouseEvent.
                onClick={() => start()}
                disabled={!canContinue || starting}
                className="btn btn-primary px-5 py-2.5 disabled:opacity-50"
              >
                {t.continue}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="btn btn-quiet px-3 py-2"
              >
                {t.cancel}
              </button>
            </div>
          </>
        ) : null}

        {phase === "waiting" ? (
          <>
            <h2 className="panel-title">{t.approveTitle}</h2>

            {affordance === "preparing" ? (
              <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                {t.preparing}
              </p>
            ) : null}

            {affordance === "dc-api" ? (
              <>
                <button
                  type="button"
                  onClick={approveViaDcApi}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
                  {t.openInWallet}
                </button>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {/*
              Without this the dialog loses its only button the moment the
              wallet call fails — selectLoginAffordance answers qr/deep-link,
              but both of those need a URI and a DC API session has none. The
              holder would wait five minutes and then read `expired`.
            */}
            {offerQrRecovery ? (
              <>
                <p className="mt-6 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.walletUnavailable}
                </p>
                <button
                  type="button"
                  onClick={() => start("request_uri")}
                  disabled={starting}
                  className="btn btn-primary mt-4 px-5 py-3 disabled:opacity-50"
                >
                  {t.showQrCode}
                </button>
              </>
            ) : null}

            {affordance === "deep-link" && session?.uri ? (
              <>
                <a href={session.uri} className="btn btn-primary mt-6 px-5 py-3">
                  {t.openInWallet}
                </a>
                <p className="mt-4 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
                  {t.confirmInApp}
                </p>
              </>
            ) : null}

            {affordance === "qr" && session?.uri ? (
              <>
                <div className="qr-frame mt-6 p-3">
                  <QrCanvas
                    value={session.uri}
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
              {/* Verbatim, as stored and as signed — no formatting between the
                  column and this line. */}
              {t.successBody(session?.newPhone ?? "")}
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