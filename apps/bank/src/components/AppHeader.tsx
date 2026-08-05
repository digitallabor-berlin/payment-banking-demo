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
    <header className="app-header">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <SparkasseLogo className="h-8 w-8 shrink-0" />
        <span className="text-lg">
          <span className="font-bold">Sparkasse</span>{" "}
          <span className="font-light">Musterstadt</span>
        </span>

        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "rounded-[var(--radius)] px-3 py-1.5 text-sm",
                active === item.key ? "bg-white/20 font-semibold" : "hover:bg-white/10",
              )}
            >
              {item.label}
            </Link>
          ))}
          <span className="ml-3 text-sm opacity-90">{displayName}</span>
          <button
            type="button"
            onClick={logout}
            className="ml-2 rounded-[var(--radius)] bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25"
          >
            Abmelden
          </button>
        </nav>

        <button
          type="button"
          aria-label="Menü"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="ml-auto rounded-[var(--radius)] bg-white/15 px-3 py-1.5 sm:hidden"
        >
          ☰
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/20 px-4 pb-3 sm:hidden">
          {NAV.map((item) => (
            <Link key={item.key} href={item.href} className="block py-2 text-sm">
              {item.label}
            </Link>
          ))}
          <button type="button" onClick={logout} className="py-2 text-sm">
            Abmelden
          </button>
        </div>
      ) : null}
    </header>
  );
}