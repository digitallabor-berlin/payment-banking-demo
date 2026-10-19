"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { DcApiForm } from "@/lib/transport.js";
import { LimitChangeDialog } from "./LimitChangeDialog.js";

/**
 * The client boundary inside `AccountPanel`, which stays a server component.
 *
 * Carries only the Change control and the dialog. The caption and the amount
 * are rendered by the panel itself, so the number comes off the server render
 * and `router.refresh()` after a successful change updates it.
 *
 * THE CONTROL IS NOT SUPPRESSED when the customer holds no Sparkassen
 * Authenticator. The design left this open; showing it and failing clearly is
 * the honest choice here for a reason stronger than friendliness:
 * `getAuthenticatorCredentialState` cannot tell a usable credential from an
 * unusable one. A credential issued before the bank started persisting `sub`
 * reads as `active` and can NEVER satisfy the ownership gate — there is no
 * backfill — so a suppression check would hide the control from people who
 * could use it and show it to people who cannot. The `unknownCredential` copy
 * names the exact remedy, and the authenticator tile is on this same page.
 */
export function AccountLimitRow({
  accountId,
  dailyLimitCents,
  locale,
  dcApiForm,
}: {
  accountId: string;
  dailyLimitCents: number;
  locale: Locale;
  dcApiForm: DcApiForm;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
      >
        {MESSAGES[locale].limits.change}
      </button>

      {open ? (
        <LimitChangeDialog
          accountId={accountId}
          dailyLimitCents={dailyLimitCents}
          locale={locale}
          dcApiForm={dcApiForm}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}