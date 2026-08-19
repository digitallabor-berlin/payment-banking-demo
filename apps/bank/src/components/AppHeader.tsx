"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@demo/ui";
import { SparkasseLogo } from "./SparkasseLogo.js";

const NAV = [
  { key: "dashboard", href: "/", label: "Übersicht" },
  { key: "transactions", href: "/transactions", label: "Umsätze" },
] as const;

export interface AppHeaderProps {
  displayName: string;
  active: "dashboard" | "transactions";
}

export function AppHeader({ displayName, active }: AppHeaderProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

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
          aria-label="Zur Übersicht"
        >
          <SparkasseLogo className="h-8 w-auto shrink-0" />
          <span className="text-[1.0625rem] tracking-tight">
            <span className="font-bold">Sparkasse</span>{" "}
            <span className="font-light">Musterstadt</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
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
          <button
            type="button"
            onClick={logout}
            className="ml-2 rounded-md px-3 py-1.5 text-sm font-medium text-white/85 transition-colors hover:bg-white/12 hover:text-white"
          >
            Abmelden
          </button>
        </nav>

        <button
          type="button"
          aria-label="Menü"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="ml-auto rounded-md bg-white/15 px-3 py-2 text-sm sm:hidden"
        >
          Menü
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/20 px-4 pb-3 sm:hidden">
          <p className="py-2 text-xs font-medium uppercase tracking-widest text-white/70">
            {displayName}
          </p>
          {NAV.map((item) => (
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
            Abmelden
          </button>
        </div>
      ) : null}
    </header>
  );
}
