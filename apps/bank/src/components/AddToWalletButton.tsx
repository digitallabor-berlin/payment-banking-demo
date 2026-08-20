"use client";

import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";

/**
 * Presentational only. The issuance session it starts belongs to CardTile,
 * because the card face has to reflect an offer in flight and two owners of
 * that one fact would be free to disagree.
 */
export function AddToWalletButton({
  onStart,
  pending,
  error,
  locale,
  disabled = false,
}: {
  onStart: () => void;
  pending: boolean;
  error: string | null;
  locale: Locale;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={onStart}
        disabled={disabled || pending}
        className="btn btn-primary px-4 py-2.5"
      >
        {pending
          ? MESSAGES[locale].issuance.preparing
          : MESSAGES[locale].issuance.addToWallet}
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
