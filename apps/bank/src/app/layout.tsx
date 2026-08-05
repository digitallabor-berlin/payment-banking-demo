import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sparkasse Musterstadt",
  description: "Online-Banking Demo mit EUDI Wallet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}