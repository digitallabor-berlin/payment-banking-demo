"use client";

import { useRouter } from "next/navigation";
import { cn } from "@demo/ui";
import { LOCALES, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * The language control.
 *
 * Writes the cookie from the browser and calls router.refresh(). Every page in
 * this app is `force-dynamic`, so the refresh re-renders server-side against
 * the new cookie and the whole tree — copy, <html lang>, metadata and every
 * formatted amount — comes back in the new language. That is why there is no
 * client-side mirror of the language: a second source of truth could disagree
 * with the cookie, and there is nothing for it to do.
 *
 * Two buttons rather than a <select>: with exactly two options a toggle is one
 * click and shows both states at once.
 */
export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();

  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    router.refresh();
  }

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label={MESSAGES[locale].nav.language}
    >
      {LOCALES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => choose(value)}
          aria-current={value === locale ? "true" : undefined}
          className={cn(
            "rounded px-1.5 py-1 text-xs font-semibold uppercase transition-colors",
            value === locale
              ? "bg-white/22"
              : "text-white/70 hover:bg-white/12 hover:text-white",
          )}
        >
          {value}
        </button>
      ))}
    </div>
  );
}