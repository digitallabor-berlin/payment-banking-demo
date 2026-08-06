import type { Metadata } from "next";
import { Fira_Mono, Fira_Sans } from "next/font/google";
import "./globals.css";

/*
 * Sparkasse's corporate face is proprietary. Fira Sans is the closest open
 * relative: a humanist grotesque drawn in Berlin for long German compounds
 * ("Zahlungsverkehr", "Verfügbarer Betrag") at small screen sizes. Fira Mono
 * is its own sibling, so IBANs, card numbers and references stay in family
 * rather than borrowing an unrelated mono.
 *
 * Loaded through next/font so the files are self-hosted at build time — no
 * runtime request to Google, and no layout shift.
 */
const sans = Fira_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fira-sans",
  display: "swap",
});

const mono = Fira_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-fira-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sparkasse Musterstadt",
  description: "Online-Banking Demo mit EUDI Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}