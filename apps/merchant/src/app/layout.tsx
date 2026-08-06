import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Demo Shop",
  description: "EUDI Wallet payment demo storefront",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}