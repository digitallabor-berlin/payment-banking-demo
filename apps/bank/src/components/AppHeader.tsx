"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@demo/ui";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { LocaleSwitcher } from "./LocaleSwitcher.js";
import { SparkasseLogo } from "./SparkasseLogo.js";

export interface AppHeaderProps {
  displayName: string;
  active: "dashboard" | "transactions";
  locale: Locale;
}

export function AppHeader({ displayName, active, locale }: AppHeaderProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const t = MESSAGES[locale];

  // Built inside the component rather than at module scope: the labels come
  // from the catalog, so they cannot be resolved before the locale is known.
  const nav = [
    { key: "dashboard", href: "/", label: t.nav.overview },
    { key: "transactions", href: "/transactions", label: t.nav.transactions },
  ] as const;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="app-header header-rule">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3.5">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label={t.nav.toOverview}
        >
          <SparkasseLogo className="h-8 w-auto shrink-0" />
          <span className="text-[1.0625rem] tracking-tight">
            <span className="font-bold">Sparkasse</span>{" "}
            <span className="font-light">Musterstadt</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {nav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active === item.key
                  ? "bg-white/22 font-semibold"
                  : "font-medium text-white/85 hover:bg-white/12 hover:text-white",
              )}
            >
              {item.label}
            </Link>
          ))}

          <span className="mx-3 h-5 w-px bg-white/25" aria-hidden="true" />
          <span className="text-sm font-medium">{displayName}</span>
          <LocaleSwitcher locale={locale} />
          <button
            type="button"
            onClick={logout}
            className="ml-2 rounded-md px-3 py-1.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/12 hover:text-white"
          >
            {t.nav.signOut}
          </button>
        </nav>

        <button
          type="button"
          aria-label={t.nav.menu}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="ml-auto rounded-md bg-white/15 px-3 py-2 text-sm sm:hidden"
        >
          {t.nav.menu}
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/20 px-4 pb-3 sm:hidden">
          <p className="py-2 text-xs font-medium uppercase tracking-widest text-white/70">
            {displayName}
          </p>
          {nav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="block py-2 text-sm font-medium"
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={logout}
            className="py-2 text-sm font-medium"
          >
            {t.nav.signOut}
          </button>
          <div className="pt-2">
            <LocaleSwitcher locale={locale} />
          </div>
        </div>
      ) : null}
    </header>
  );
}