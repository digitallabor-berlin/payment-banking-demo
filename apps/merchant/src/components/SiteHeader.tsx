import Link from "next/link";
import { CartBadge } from "./CartBadge.js";
import { LarderMark } from "./LarderMark.js";

/**
 * One header for every route. Previously only the shop page had one, so the
 * cart, checkout and success pages left the shopper with no way back and no
 * sense of where they were.
 */
export function SiteHeader() {
  return (
    <header className="site-header sticky top-0 z-40">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Larder, home">
          <LarderMark className="h-6 w-6" />
          <span className="wordmark">Larder</span>
        </Link>
        <span className="eyebrow ml-1 hidden sm:inline">Grocer · Berlin</span>
        <div className="ml-auto">
          <CartBadge />
        </div>
      </div>
    </header>
  );
}