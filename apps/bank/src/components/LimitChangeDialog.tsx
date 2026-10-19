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
import { formatEuroCents } from "@/lib/format.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  isLimitTerminal,
  limitFailureKey,
  selectLimitPhase,
} from "@/lib/limit-dialog-state.js";
import {
  isSelectablePreset,
  LIMIT_PRESETS_CENTS,
} from "@/lib/limit-presets.js";
import {
  selectLoginAffordance,
  type LoginDcError,
} from "@/lib/login-dialog-state.js";
import {
  selectTransport,
  type DcApiForm,
} from "@/lib/transport.js";
import { AlertMark, CheckMark } from "./StatusMark.js";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

/**
 * The shape `POST /api/accounts/{id}/limit-change` answers with — a
 * `LimitChangeSessionDto`, under the dialog's own prop names.
 *
 * The `as` cast below is irreducible (`.json()` is untyped at runtime), but
 * there is exactly ONE of it, against a body a named function with a
 * written-out return annotation produces. This repo's `dcApiProtocol` bug came
 * from three hand-written copies of a projection and a cast asserting a shape
 * nobody produced.
 */
interface LimitSession {
  sessionId: string;
  uri: string | null;
  dcApiRequest: unknown;
  dcApiProtocol: string | null;
  newLimitCents: number;
}

interface PollState {
  state: string;
  failureReason?: string;
}

export interface LimitChangeDialogProps {
  accountId: string;
  dailyLimitCents: number;
  locale: Locale;
  /** Which DC API wire form to ask for, resolved from `?dcapi=` by the page. */
  dcApiForm: DcApiForm;
  onClose: () => void;
}

export function LimitChangeDialog({
  accountId,
  dailyLimitCents,
  locale,
  dcApiForm,
  onClose,
}: LimitChangeDialogProps) {
  const router = useRouter();
  const t = MESSAGES[locale].limits;
  const isTouch = useIsTouch();
  const [session, setSession] = useState<LimitSession | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const [dcError, setDcError] = useState<LoginDcError>(null);
  const [applied, setApplied] = useState(false);
  /**
   * The `error` member of a non-2xx apply, fed into `limitFailureKey` beside
   * the session's own `failure_reason`. `limit_changed` ONLY ever arrives this
   * way — the poll structurally cannot write it — so without this the
   * limitChanged copy would be dead and a stale-snapshot refusal would read as
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
      `/api/accounts/${accountId}/limit-change/${session!.sessionId}`,
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
  }, [accountId, session]);

  const isTerminal = useCallback(
    (value: PollState) => isLimitTerminal(value.state),
    [],
  );

  const { value, outcome } = useStatusPoll<PollState>({
    fetchOnce,
    isTerminal,
    // Suspended until a session exists, so the chooser does not poll a URL it
    // has no id for.
    enabled: session !== null,
  });

  // The apply is a SEPARATE request from the poll, and it is a POST. A GET
  // that wrote to an account would be consumed by a prefetch or a double-poll.
  useEffect(() => {
    if (!session || value?.state !== "verified" || applied || applyError) {
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(
          `/api/accounts/${accountId}/limit-change/${session.sessionId}/apply`,
          { method: "POST" },
        );
        if (cancelled) return;
        if (!response.ok) {
          // `fetch` does not throw on a non-2xx. Without this the dialog would
          // claim a limit it did not write.
          const body = (await response.json().catch(() => null)) as {
            error?: unknown;
          } | null;
          setApplyError(
            typeof body?.error === "string" ? body.error : "not_verified",
          );
          return;
        }
        setApplied(true);
        // The panel behind the dialog reads the limit from a server component,
        // so it needs a refresh rather than a state update.
        router.refresh();
      } catch {
        if (!cancelled) setApplyError("verification_failed");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, value, applied, applyError, accountId, router]);

  const pollFailed =
    startError ||
    applyError !== undefined ||
    (outcome !== null &&
      outcome.status !== "aborted" &&
      outcome.status !== "terminal");

  const phase = selectLimitPhase(
    session === null ? null : (value?.state ?? "pending"),
    applied,
    pollFailed,
  );
  const affordance = selectLoginAffordance(dcSupported, dcError, isTouch);
  const failureBody = t[limitFailureKey(applyError ?? value?.failureReason)];

  const presets = LIMIT_PRESETS_CENTS.filter((preset) =>
    isSelectablePreset(preset, dailyLimitCents),
  );

  async function start() {
    if (chosen === null) return;
    setStarting(true);
    setStartError(false);
    try {
      const response = await fetch(
        `/api/accounts/${accountId}/limit-change`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            newLimitCents: chosen,
            transport: selectTransport(dcSupported, dcApiForm),
          }),
        },
      );
      if (!response.ok) {
        setStartError(true);
        return;
      }
      setSession((await response.json()) as LimitSession);
    } catch {
      setStartError(true);
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
        `/api/accounts/${accountId}/limit-change/${session.sessionId}/dc-api-response`,
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
        {phase === "choose" ? (
          <>
            <h2 className="panel-title">{t.dialogTitle}</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-muted-foreground)]">
              {t.dialogLead}
            </p>

            <p className="eyebrow mt-6">{t.currentLimit}</p>
            <p className="mt-1 text-lg font-semibold">
              {formatEuroCents(dailyLimitCents, locale)}
            </p>

            <p className="eyebrow mt-5">{t.newLimit}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={chosen === preset}
                  onClick={() => setChosen(preset)}
                  className={
                    chosen === preset
                      ? "rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white"
                      : "rounded-full border border-[var(--color-border)] px-4 py-2 text-sm font-semibold hover:border-[var(--color-primary)]"
                  }
                >
                  {formatEuroCents(preset, locale)}
                </button>
              ))}
            </div>

            <div className="mt-7 flex items-center gap-3">
              <button
                type="button"
                onClick={start}
                disabled={chosen === null || starting}
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

            {affordance === "deep-link" && session?.uri ? (
              <>
                <a
                  href={session.uri}
                  className="btn btn-primary mt-6 px-5 py-3"
                >
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
              {t.successBody(
                formatEuroCents(session?.newLimitCents ?? 0, locale),
              )}
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