"use client";

import { useState } from "react";
import { useDcApiSupport } from "@demo/ui";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  presentationProtocolFor,
  selectTransport,
  type DcApiForm,
} from "@/lib/transport.js";
import { WalletLoginDialog } from "./WalletLoginDialog.js";

interface LoginSession {
  sessionId: string;
  uri: string | null;
  dcApiRequest: unknown;
  /**
   * The DC API exchange protocol identifier foundry returned for this session.
   * Replayed verbatim by the dialog rather than re-derived, so the identifier
   * and the request object cannot drift apart.
   */
  dcApiProtocol: string | null;
}

/**
 * The wallet alternative to the password form.
 *
 * Detection happens HERE rather than in the dialog, because the transport is
 * fixed when the session is created: foundry returns either a URI or an inline
 * request object, never both, and that choice cannot be revisited afterwards.
 *
 * Creating the session on the click — before the dialog mounts — is also what
 * lets `dcApiRequest` be a prop by the time the dialog's own button is pressed.
 * Chrome consumes a click's transient activation, so no `await` may run between
 * that handler starting and `navigator.credentials.get()`.
 */
export function WalletLoginButton({
  locale,
  dcApiForm,
}: {
  locale: Locale;
  /**
   * Which DC API wire form this attempt asks for, resolved from `?dcapi=` by
   * the page. Signed unless explicitly opted out of.
   */
  dcApiForm: DcApiForm;
}) {
  const t = MESSAGES[locale];
  const dcSupported = useDcApiSupport(
    "get",
    presentationProtocolFor(dcApiForm),
  );
  const [session, setSession] = useState<LoginSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/wallet-login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transport: selectTransport(dcSupported, dcApiForm),
        }),
      });
      if (!response.ok) {
        setError(t.errors.offerNotCreated);
        return;
      }
      setSession((await response.json()) as LoginSession);
    } catch {
      setError(t.errors.connectionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="mt-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <span className="eyebrow">{t.login.walletDivider}</span>
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </div>

      <button
        type="button"
        onClick={start}
        disabled={pending}
        className="btn btn-quiet mt-4 w-full py-3"
      >
        {t.login.walletSubmit}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-3 text-sm font-medium text-[var(--color-destructive)]"
        >
          {error}
        </p>
      ) : null}

      {session ? (
        <WalletLoginDialog
          sessionId={session.sessionId}
          uri={session.uri}
          dcApiRequest={session.dcApiRequest}
          dcApiProtocol={session.dcApiProtocol}
          locale={locale}
          onClose={() => setSession(null)}
        />
      ) : null}
    </>
  );
}
