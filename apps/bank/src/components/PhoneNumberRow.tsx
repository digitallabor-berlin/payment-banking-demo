"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { DcApiForm } from "@/lib/transport.js";
import { PhoneChangeDialog } from "./PhoneChangeDialog.js";

/**
 * The client boundary inside `ProfilePanel`, which stays a server component.
 *
 * Carries only the Change control and the dialog. The caption and the number
 * are rendered by the panel itself, so the number comes off the server render
 * and `router.refresh()` after a successful change updates it.
 *
 * It still takes `phoneNumber`, because the dialog pre-fills its field with
 * the number in force and `canSubmitPhone` compares against it — but it does
 * not RENDER it. Mirrors `AccountLimitRow`, which takes `dailyLimitCents` for
 * exactly the same two reasons.
 *
 * THE CONTROL IS NOT SUPPRESSED when the customer holds no Sparkassen
 * Authenticator, for the reason `AccountLimitRow` documents at length:
 * `getAuthenticatorCredentialState` cannot tell a usable credential from an
 * unusable one. A credential issued before the bank started persisting `sub`
 * reads as `active` and can NEVER satisfy the ownership gate — there is no
 * backfill — so a suppression check would hide the control from people who
 * could use it and show it to people who cannot. The `unknownCredential` copy
 * names the exact remedy, and the authenticator tile is on this same page.
 */
export function PhoneNumberRow({
  phoneNumber,
  locale,
  dcApiForm,
}: {
  phoneNumber: string;
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
        {MESSAGES[locale].phones.change}
      </button>

      {open ? (
        <PhoneChangeDialog
          phoneNumber={phoneNumber}
          locale={locale}
          dcApiForm={dcApiForm}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}