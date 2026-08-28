"use client";

import { useCallback, useEffect, useState } from "react";
import { formatReceivedAt } from "@/lib/format.js";
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
 * An EVIDENCE INSPECTOR, not a confirmation dialog, and it wears `.proof-*`
 * rather than `.dialog-card` for that reason — see the comment above those
 * rules in globals.css. The distinction is not cosmetic: `.dialog-card` is
 * 25rem wide and `text-align: center`, which centred fifteen blocks of JSON in
 * a 400px column.
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

  // A modal with no primary action still needs an unambiguous way out, and a
  // reader deep inside a scrolled payload should not have to find the button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      <div className="proof-sheet">
        <div className="proof-head">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{t.title}</h2>
              {body ? (
                <p className="mono mt-1 text-xs text-[var(--color-muted-foreground)]">
                  {t.received} {formatReceivedAt(body.receivedAt, locale)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn-outline shrink-0 px-3 py-2"
              onClick={onClose}
            >
              {t.close}
            </button>
          </div>

          {/*
            The custody strip. The bank stores this package and verifies nothing
            in it (design D4), so that statement is set as an evidence tag
            rather than a grey sentence under the title — it is the one claim
            this sheet must never let a reader skim past.
          */}
          <p className="proof-custody">
            <span className="proof-custody-mark">{t.unverifiedMark}</span>
            <span>{t.disclaimer}</span>
          </p>

          {body ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <div className="proof-segment" role="group" aria-label={t.title}>
                <button
                  type="button"
                  aria-current={raw ? undefined : "true"}
                  onClick={() => setRaw(false)}
                >
                  {t.decoded}
                </button>
                <button
                  type="button"
                  aria-current={raw ? "true" : undefined}
                  onClick={() => setRaw(true)}
                >
                  {t.raw}
                </button>
              </div>
              <button
                type="button"
                className="btn btn-outline px-3 py-2"
                onClick={() => copy(JSON.stringify(body.proofPackage, null, 2))}
              >
                {copied ? t.copied : t.copy}
              </button>
            </div>
          ) : null}
        </div>

        <div className="proof-body">
          {failed ? (
            <p className="mt-4 text-sm">{t.loadFailed}</p>
          ) : body ? (
            raw ? (
              <div className="proof-specimen">
                <div className="proof-specimen-head">
                  <span className="proof-specimen-name">{t.title}</span>
                  <span className="proof-specimen-tag">application/json</span>
                </div>
                <pre className="proof-data max-h-none">
                  {JSON.stringify(body.proofPackage, null, 2)}
                </pre>
              </div>
            ) : (
              <>
                <Specimen
                  name={t.signedRequest}
                  tag="compact JWS"
                  result={decodeJwsCompact(body.proofPackage.signed_request)}
                  raw={body.proofPackage.signed_request}
                  t={t}
                />
                <VpToken value={body.proofPackage.vp_token} t={t} />
              </>
            )
          ) : (
            <p className="mt-4 text-sm">{t.loading}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/** One labelled part of a JOSE artefact: header, payload or signature. */
function Part({
  index,
  label,
  children,
}: {
  index: number;
  label: string;
  children: string;
}) {
  return (
    <div className="proof-part">
      <p className="proof-part-label">
        <span className="proof-part-index">{index}</span>
        <span>{label}</span>
      </p>
      <pre className="proof-data">{children}</pre>
    </div>
  );
}

/** A framed artefact with a name and a machine tag. */
function Specimen({
  name,
  tag,
  result,
  raw,
  t,
}: {
  name: string;
  tag: string;
  result: JwsResult;
  raw?: string;
  t: Copy;
}) {
  return (
    <section className="proof-specimen">
      <div className="proof-specimen-head">
        <span className="proof-specimen-name">{name}</span>
        <span className="proof-specimen-tag">{tag}</span>
      </div>
      <Jws result={result} raw={raw} t={t} />
    </section>
  );
}

function Jws({ result, raw, t }: { result: JwsResult; raw?: string; t: Copy }) {
  if (!result.ok) {
    return (
      <>
        <p className="proof-note">{t.undecodable}</p>
        {/* Only the top-level signed request still has its raw bytes to hand.
            A nested KB-JWT does not, and an empty block would say nothing. */}
        {raw ? <pre className="proof-data">{raw}</pre> : null}
      </>
    );
  }
  return (
    <>
      <Part index={1} label={t.header}>
        {JSON.stringify(result.header, null, 2)}
      </Part>
      <Part index={2} label={t.payload}>
        {JSON.stringify(result.payload, null, 2)}
      </Part>
      <Part index={3} label={t.signature}>
        {result.signature}
      </Part>
    </>
  );
}

function VpToken({ value, t }: { value: unknown; t: Copy }) {
  const view = decodeVpToken(value);
  if (!view.ok) {
    return (
      <section className="proof-specimen">
        <div className="proof-specimen-head">
          <span className="proof-specimen-name">{t.vpToken}</span>
        </div>
        <p className="proof-note">{t.undecodable}</p>
        <pre className="proof-data">{JSON.stringify(value, null, 2)}</pre>
      </section>
    );
  }

  return (
    <>
      {view.entries.map((entry) =>
        entry.presentations.map((presentation, index) => (
          <Presentation
            // A credential may answer with more than one presentation, so the
            // query id alone is not unique.
            key={`${entry.queryId}:${index}`}
            queryId={entry.queryId}
            presentation={presentation}
            t={t}
          />
        )),
      )}
    </>
  );
}

function Presentation({
  queryId,
  presentation,
  t,
}: {
  queryId: string;
  presentation: PresentationView;
  t: Copy;
}) {
  return (
    <section className="proof-specimen">
      <div className="proof-specimen-head">
        <span className="proof-specimen-name">
          {t.credential}: {queryId}
        </span>
        <span className="proof-specimen-tag">
          {presentation.kind === "sd-jwt" ? "dc+sd-jwt" : t.vpToken}
        </span>
      </div>

      {presentation.kind === "opaque" ? (
        <>
          <p className="proof-note">{t.undecodable}</p>
          <pre className="proof-data">{presentation.value}</pre>
        </>
      ) : (
        <>
          <Jws result={presentation.issuerJwt} t={t} />
          {presentation.disclosures.length > 0 ? (
            <div className="proof-part">
              <p className="proof-part-label">
                <span>{t.disclosures}</span>
              </p>
              <pre className="proof-data">
                {presentation.disclosures
                  .map((disclosure) =>
                    disclosure.ok
                      ? JSON.stringify(disclosure.value)
                      : `— ${t.undecodable}`,
                  )
                  .join("\n")}
              </pre>
            </div>
          ) : null}
          {presentation.kbJwt ? (
            <div className="proof-part">
              <p className="proof-part-label">
                <span>{t.keyBinding}</span>
              </p>
              <Jws result={presentation.kbJwt} t={t} />
            </div>
          ) : null}
        </>
      )}
    </section>
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
        className="-m-1 inline-flex items-center rounded p-1 align-middle text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)]"
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
