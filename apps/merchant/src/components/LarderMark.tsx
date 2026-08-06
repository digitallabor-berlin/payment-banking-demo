/**
 * Larder's mark: a crate seen head-on, with three slats. A grocer's goods
 * arrive in crates, so the mark comes from the shop's own world rather than
 * from a generic leaf or basket glyph.
 *
 * Drawn in currentColor so the header, footer, and payment sheet can each set
 * it from their own text colour.
 */
export function LarderMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="2.6"
        y="7.4"
        width="26.8"
        height="19.2"
        rx="2.4"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <path d="M2.6 14.2h26.8M2.6 20.4h26.8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10.4 7.4 13.6 2.2M21.6 7.4 18.4 2.2"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}