import type { Metadata } from "next";
import { Archivo, Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

/*
 * Bricolage Grotesque carries the storefront's voice: a contemporary European
 * grotesque with flared terminals and a width axis, closer to market and
 * poster lettering than to the neutral UI sans every other shop reaches for.
 * Used only where it counts — the masthead, aisle names, and shelf prices.
 *
 * Instrument Sans runs everything else: compact, quiet, legible at 14px.
 * IBM Plex Mono sets the data — unit prices, order ids, check names — where
 * digits need to line up in a column.
 */
// NB: this variable must NOT be named --font-display. Tailwind's @theme also
// defines --font-display on :root, which is the same element next/font puts
// its variable on, and a token defined as `var(--font-display)` referring to
// itself resolves to nothing.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display-face",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono-plex",
  display: "swap",
});

/*
 * Archivo carries the EudiPay payment sheet, and only the sheet. The handover
 * only reads as a handover if the typography changes hands, so the shop's
 * Bricolage never appears on it and Archivo never appears in the shop.
 *
 * The `wdth` axis is the point: the amount is set at wdth 125 so the number
 * reads as signage on an official instrument rather than as UI text.
 *
 * NB: same naming rule as `display` above — the variable must NOT be called
 * --font-eudipay, because @theme defines that on :root, the same element
 * next/font writes to, and a self-referential token resolves to nothing.
 */
const eudipay = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-eudipay-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Larder — grocer",
  description: "A neighbourhood grocer that takes payment from your EUDI Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} ${eudipay.variable}`}
    >
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}