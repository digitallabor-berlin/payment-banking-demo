"use client";

/**
 * The Google Wallet badge, as a button.
 *
 * A deliberate sibling of `AddToWalletButton` rather than a `variant` prop on
 * it. That component's contract is a resolved `label` string rendered inside
 * `.btn.btn-primary`; this one renders Google's supplied artwork and can carry
 * no label at all, because the badge's own text is drawn as SVG paths. One
 * component serving both would branch on nearly every line.
 *
 * The consequences of the artwork being fixed:
 *
 * - There is no "add again" state. `walletActionLabel`'s three-way choice has
 *   nowhere to render, so the badge looks the same whatever the credential's
 *   state. The tile's badge beside it is what reports that state; the button
 *   only ever offers to start.
 * - `label` is the accessible name, not a rendered string — it is the
 *   `aria-label` and the image's `alt`, and it comes from the catalog so a
 *   German screen reader is not read an English one.
 * - Its size is set by height alone (`h-11 w-auto`, matching the primary
 *   button's height). Google's brand guidelines forbid recolouring the badge
 *   or altering its proportions, so nothing here sets a width.
 *
 * `pending` dims and disables it, and the preparing text renders beside it
 * rather than on it, for the same reason.
 */
export function AddToGoogleWalletButton({
       onStart,
       pending,
       error,
       label,
       pendingLabel,
}: {
       onStart: () => void;
       pending: boolean;
       error: string | null;
       label: string;
       pendingLabel: string;
}) {
       return (
              <div className="flex flex-col items-start gap-1.5">
                     <button
                            type="button"
                            onClick={onStart}
                            disabled={pending}
                            aria-label={label}
                            className="rounded-full transition-opacity disabled:opacity-60"
                     >
                            {/* A plain <img>, not next/image: the asset is a fixed-size SVG served
            from public/, so there is nothing for the optimizer to do and
            next/image does not process SVG by default anyway. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                   src="/add-to-google-wallet.svg"
                                   alt={label}
                                   width={199}
                                   height={55}
                                   className="h-11 w-auto"
                            />
                     </button>
                     {pending ? (
                            <span className="text-xs font-medium text-[var(--color-muted-foreground)]">
                                   {pendingLabel}
                            </span>
                     ) : null}
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
