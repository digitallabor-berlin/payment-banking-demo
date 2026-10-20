"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { DcApiForm } from "@/lib/transport.js";
import { SendMoneyDialog } from "./SendMoneyDialog.js";

/**
 * The client boundary inside `AccountPanel`, which stays a server component.
 *
 * Mirrors `AccountLimitRow`: it carries only the control and the dialog, so
 * the balance and the limit still come off the server render and
 * `router.refresh()` after a successful transfer updates both of them — plus
 * the transaction list, which is where the debit appears.
 *
 * THE CONTROL IS NOT SUPPRESSED when the customer holds no Sparkassen
 * Authenticator, for the reason `AccountLimitRow` states and which applies
 * identically here: `getAuthenticatorCredentialState` cannot tell a usable
 * credential from an unusable one. A credential issued before the bank started
 * persisting `sub` reads as `active` and can NEVER satisfy the ownership gate
 * — there is no backfill — so a suppression check would hide the control from
 * people who could use it and show it to people who cannot. The
 * `unknownCredential` copy names the exact remedy, and the authenticator tile
 * is on this same page.
 */
export function SendMoneyRow({
  accountId,
  dailyLimitCents,
  balanceCents,
  locale,
  dcApiForm,
}: {
  accountId: string;
  dailyLimitCents: number;
  balanceCents: number;
  locale: Locale;
  dcApiForm: DcApiForm;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary px-4 py-2 text-sm"
      >
        {MESSAGES[locale].transfers.sendMoney}
      </button>

      {open ? (
        <SendMoneyDialog
          accountId={accountId}
          dailyLimitCents={dailyLimitCents}
          balanceCents={balanceCents}
          locale={locale}
          dcApiForm={dcApiForm}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}