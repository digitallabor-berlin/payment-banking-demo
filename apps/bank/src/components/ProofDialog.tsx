"use client";

import { useCallback, useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import {
  decodeJwsCompact,
  decodeVpToken,
  type JwsResult,
  type PresentationView,
} from "@/lib/proof-decode.js";
// `import type` is fully erased, so this does NOT pull `queries.ts` — and with
// it better-sqlite3 — into the client bundle. Importing the producer's own type
// rather than re-declaring the shape here is the point: a hand-copied interface
// beside a hand-written route body is exactly the pair that lost
// `dcApiProtocol` in the merchant (6e997da).
import type { TransactionProofBody } from "@/lib/queries.js";

type Copy = (typeof MESSAGES)[Locale]["proof"];

/**
 * Shows one stored PaSO proof package.
 *
 * Fetches on open rather than receiving the package as a prop: a `vp_token` is
 * kilobytes and the ledger renders twenty rows, so `TransactionDto` carries a
 * boolean and this component pays the cost only when a human asks.
 *
 * All decoding happens in `lib/proof-decode.ts`. Nothing in this file inspects
 * a token — vitest never matches `.tsx`, so a branch written here would be
 * untested by construction.
 */
export function ProofDialog({
  transactionId,
  locale,
  onClose,
}: {
  transactionId: string;
  locale: Locale;
  onClose: () => void;
}) {
  const t = MESSAGES[locale].proof;
  const [body, setBody] = useState<TransactionProofBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [raw, setRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/transactions/${encodeURIComponent(transactionId)}/proof`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(`status ${response.status}`);
        // `.json()` is untyped at runtime, so this cast is irreducible — but
        // the producer carries a written-out `TransactionProofBody` return
        // annotation and a route test asserts the exact key set, which is what
        // makes the cast safe rather than hopeful.
        const parsed = (await response.json()) as TransactionProofBody;
        if (!cancelled) setBody(parsed);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transactionId]);

  const copy = useCallback((value: string) => {
    void navigator.clipboard?.writeText(value);
    setCopied(true);
  }, []);

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t.title}
    >
      <div className="dialog-card max-h-[85vh] overflow-y-auto px-7 py-8">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t.disclaimer}
        </p>

        {failed ? (
          <p className="mt-6 text-sm">{t.loadFailed}</p>
        ) : body ? (
          <>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setRaw((value) => !value)}
              >
                {raw ? t.showDecoded : t.showRaw}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => copy(JSON.stringify(body.proofPackage, null, 2))}
              >
                {copied ? t.copied : t.copy}
              </button>
            </div>

            {raw ? (
              <Block label={t.title}>
                {JSON.stringify(body.proofPackage, null, 2)}
              </Block>
            ) : (
              <>
                <section className="mt-6">
                  <h3 className="text-sm font-semibold">{t.signedRequest}</h3>
                  <Jws
                    result={decodeJwsCompact(body.proofPackage.signed_request)}
                    raw={body.proofPackage.signed_request}
                    t={t}
                  />
                </section>

                <section className="mt-6">
                  <h3 className="text-sm font-semibold">{t.vpToken}</h3>
                  <VpToken value={body.proofPackage.vp_token} t={t} />
                </section>
              </>
            )}
          </>
        ) : (
          <p className="mt-6 text-sm">{t.loading}</p>
        )}

        <div className="mt-8">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-[var(--color-muted-foreground)]">{label}</p>
      <pre className="mt-1 max-h-64 overflow-auto rounded bg-black/5 p-3 text-xs break-all whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  );
}

function Jws({ result, raw, t }: { result: JwsResult; raw?: string; t: Copy }) {
  if (!result.ok) {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        {/* Only the top-level signed request still has its raw bytes to hand.
            A nested KB-JWT does not, and an empty block would say nothing. */}
        {raw ? <Block label={t.signature}>{raw}</Block> : null}
      </>
    );
  }
  return (
    <>
      <Block label={t.header}>{JSON.stringify(result.header, null, 2)}</Block>
      <Block label={t.payload}>{JSON.stringify(result.payload, null, 2)}</Block>
      <Block label={t.signature}>{result.signature}</Block>
    </>
  );
}

function VpToken({ value, t }: { value: unknown; t: Copy }) {
  const view = decodeVpToken(value);
  if (!view.ok) {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        <Block label={t.vpToken}>{JSON.stringify(value, null, 2)}</Block>
      </>
    );
  }

  return (
    <>
      {view.entries.map((entry) => (
        <div key={entry.queryId} className="mt-4">
          <p className="text-xs font-semibold">
            {t.credential}: {entry.queryId}
          </p>
          {entry.presentations.map((presentation, index) => (
            <Presentation key={index} presentation={presentation} t={t} />
          ))}
        </div>
      ))}
    </>
  );
}

function Presentation({
  presentation,
  t,
}: {
  presentation: PresentationView;
  t: Copy;
}) {
  if (presentation.kind === "opaque") {
    return (
      <>
        <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">
          {t.undecodable}
        </p>
        <Block label={t.vpToken}>{presentation.value}</Block>
      </>
    );
  }

  return (
    <>
      <Jws result={presentation.issuerJwt} t={t} />
      {presentation.disclosures.length > 0 ? (
        <Block label={t.disclosures}>
          {presentation.disclosures
            .map((disclosure) =>
              disclosure.ok
                ? JSON.stringify(disclosure.value)
                : `— ${t.undecodable}`,
            )
            .join("\n")}
        </Block>
      ) : null}
      {presentation.kbJwt ? (
        <div className="mt-2">
          <p className="text-xs font-semibold">{t.keyBinding}</p>
          <Jws result={presentation.kbJwt} t={t} />
        </div>
      ) : null}
    </>
  );
}

/**
 * The ledger-row affordance that opens the dialog.
 *
 * Lives in this file rather than its own so there is ONE `"use client"`
 * boundary for the whole feature: `TransactionRow` is a server component and
 * must stay one, and splitting these two across files would mean two client
 * chunks for one button.
 */
export function ProofButton({
  transactionId,
  locale,
}: {
  transactionId: string;
  locale: Locale;
}) {
  const t = MESSAGES[locale].proof;
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        // The accessible name is a catalog entry, never the glyph alone: this
        // is the only way a screen-reader user reaches the package at all.
        aria-label={t.open}
        title={t.open}
        className="inline-flex items-center rounded p-0.5 align-middle"
        onClick={() => setOpen(true)}
      >
        <ProofMark className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <ProofDialog
          transactionId={transactionId}
          locale={locale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * A seal, not a tick.
 *
 * A checkmark would read as "the bank verified this", which is exactly what did
 * NOT happen (design D4). A document-with-a-seal says "there is a record here",
 * which is the true claim.
 */
function ProofMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 1.75h5l3 3v9.5H4z" strokeLinejoin="round" />
      <circle cx="8" cy="9" r="2" />
      <path d="M6.7 10.7 6.2 13l1.8-1 1.8 1-.5-2.3" strokeLinejoin="round" />
    </svg>
  );
}