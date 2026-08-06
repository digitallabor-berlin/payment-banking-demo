/**
 * Outcome marks for the payment sheet, replacing the 🇪🇺 and ⚠️ emoji. Flag
 * emoji render as the bare letters "EU" on Windows and differ on every other
 * platform, which is not acceptable for the one glyph that tells a shopper
 * whether their money moved.
 *
 * Both draw in currentColor.
 */

export function CheckMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.12" />
      <path
        d="M15 24.5 21.5 31 33 19"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AlertMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="22" fill="currentColor" opacity="0.12" />
      <path d="M24 14v13" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="33.5" r="2.1" fill="currentColor" />
    </svg>
  );
}