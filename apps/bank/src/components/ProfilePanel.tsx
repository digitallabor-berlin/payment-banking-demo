import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { DcApiForm } from "@/lib/transport.js";
import { PhoneNumberRow } from "./PhoneNumberRow.js";

/**
 * The Your details panel: the customer's login name and mobile number.
 *
 * A SERVER component, and that is load-bearing rather than incidental. The
 * number is rendered HERE rather than inside `PhoneNumberRow`, so it comes off
 * the server render and the `router.refresh()` that follows a successful
 * change updates it. `AccountPanel` and `AccountLimitRow` split the same way,
 * for the same reason.
 *
 * `username` is the LOGIN name (`anna`), not the internal row id
 * (`user_anna`). It is shown because it is the other fact a customer looks for
 * in a details panel; it is immutable here and has no control beside it.
 */
export function ProfilePanel({
  username,
  phoneNumber,
  locale,
  dcApiForm,
}: {
  username: string;
  phoneNumber: string;
  locale: Locale;
  /**
   * Which DC API wire form a phone change should ask for, read from `?dcapi=`
   * server-side by the page and threaded through. NOT read with
   * `useSearchParams` in the dialog: a client read there would need a Suspense
   * boundary, and the wallet button must have the answer before the click.
   */
  dcApiForm: DcApiForm;
}) {
  const t = MESSAGES[locale];

  return (
    <section className="panel p-6">
      <div>
        <p className="eyebrow">{t.profile.username}</p>
        <p className="mono mt-1 text-base font-semibold">{username}</p>
      </div>

      {/*
        Separated by a rule because it is a different fact from the username,
        not more of it — and because only this one carries a control.
      */}
      <div className="panel-divider mt-5 flex items-baseline justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className="eyebrow">{t.profile.mobileNumber}</p>
          <p className="mono mt-1 text-base font-semibold">{phoneNumber}</p>
        </div>
        <PhoneNumberRow
          phoneNumber={phoneNumber}
          locale={locale}
          dcApiForm={dcApiForm}
        />
      </div>
    </section>
  );
}