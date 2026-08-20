import type { ReactNode } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { SparkasseLogo } from "./SparkasseLogo.js";

export interface AuthCardProps {
      title: string;
      subtitle: string;
      tagline: string;
      locale: Locale;
      /**
       * The language control. Passed in rather than rendered here so this card
       * stays a layout: it is the login screen that decides a switcher belongs on
       * it, and English being the default is exactly why one does.
       */
      switcher?: ReactNode;
      children: ReactNode;
}

export function AuthCard({
      title,
      subtitle,
      tagline,
      locale,
      switcher,
      children,
}: AuthCardProps) {
      return (
            <div className="auth-overlay p-6">
                  <div className="auth-card">
                        <div className="auth-card-header flex items-center gap-3.5 px-6 py-6">
                              <SparkasseLogo className="h-10 w-auto shrink-0" />
                              <div className="leading-tight">
                                    <div className="text-xl tracking-tight">
                                          <span className="font-bold">
                                                {title}
                                          </span>{" "}
                                          <span className="font-light">
                                                {subtitle}
                                          </span>
                                    </div>
                                    <div className="auth-card-tagline mt-1">
                                          {tagline}
                                    </div>
                              </div>
                              {switcher ? (
                                    <div className="ml-auto">{switcher}</div>
                              ) : null}
                        </div>

                        <div className="p-6">{children}</div>

                        <div className="panel-divider px-6 py-3.5 text-center text-xs text-[var(--color-muted-foreground)]">
                              {MESSAGES[locale].login.walletFooter}
                        </div>
                  </div>
            </div>
      );
}
