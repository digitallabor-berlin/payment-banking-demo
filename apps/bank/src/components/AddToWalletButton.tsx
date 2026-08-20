"use client";

/**
 * Presentational only. The issuance session it starts belongs to CardTile,
 * because the card face has to reflect an offer in flight and two owners of
 * that one fact would be free to disagree.
 *
 * It receives a resolved `label` rather than a locale, because choosing between
 * "add" and "add again" is a decision, and decisions live in `.ts` where the
 * test suite can reach them (`walletActionLabel` in lib/credential-copy.ts).
 *
 * There is no `disabled` prop beyond `pending`. There used to be one, set from
 * `credentialState === "active"`, and it was the whole of the reported bug: a
 * credential that reached the wallet could never be issued again even though
 * nothing behind the UI forbids it.
 */
export function AddToWalletButton({
 onStart,
 pending,
 error,
 label,
}: {
 onStart: () => void;
 pending: boolean;
 error: string | null;
 label: string;
}) {
 return (
  <div className="flex flex-col items-start gap-1.5">
   <button
    type="button"
    onClick={onStart}
    disabled={pending}
    className="btn btn-primary px-4 py-2.5"
   >
    {label}
   </button>
   {error ? (
    <span
     role="alert"
     className="text-xs font-medium text-[var(--color-destructive)]"
    >
     {error}
    </span>
   ) : null}
  </div>
 );
}
