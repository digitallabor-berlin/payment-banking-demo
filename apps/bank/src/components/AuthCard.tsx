import type { ReactNode } from "react";
import { SparkasseLogo } from "./SparkasseLogo.js";

export interface AuthCardProps {
  title: string;
  subtitle: string;
  tagline: string;
  children: ReactNode;
}

export function AuthCard({ title, subtitle, tagline, children }: AuthCardProps) {
  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-card-header">
          <SparkasseLogo className="h-10 w-10 shrink-0" />
          <div className="leading-tight">
            <div className="text-xl">
              <span className="font-bold">{title}</span>{" "}
              <span className="font-light">{subtitle}</span>
            </div>
            <div className="auth-card-tagline">{tagline}</div>
          </div>
        </div>
        <div className="p-6">{children}</div>
        <div className="border-t border-[var(--color-border)] px-6 py-3 text-center text-xs text-[var(--color-muted-foreground)]">
          Powered by EUDI Wallet
        </div>
      </div>
    </div>
  );
}