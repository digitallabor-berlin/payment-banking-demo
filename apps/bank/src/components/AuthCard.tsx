import type { ReactNode } from "react";
import { SparkasseLogo } from "./SparkasseLogo.js";

export interface AuthCardProps {
  title: string;
  subtitle: string;
  tagline: string;
  children: ReactNode;
}

export function AuthCard({
  title,
  subtitle,
  tagline,
  children,
}: AuthCardProps) {
  return (
    <div className="auth-overlay p-6">
      <div className="auth-card">
        <div className="auth-card-header flex items-center gap-3.5 px-6 py-6">
          <SparkasseLogo className="h-10 w-auto shrink-0" />
          <div className="leading-tight">
            <div className="text-xl tracking-tight">
              <span className="font-bold">{title}</span>{" "}
              <span className="font-light">{subtitle}</span>
            </div>
            <div className="auth-card-tagline mt-1">{tagline}</div>
          </div>
        </div>

        <div className="p-6">{children}</div>

        <div className="panel-divider px-6 py-3.5 text-center text-xs text-[var(--color-muted-foreground)]">
          Zahlungen über EUDI Wallet
        </div>
      </div>
    </div>
  );
}
