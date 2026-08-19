/**
 * One definition, three placements: the shelf ticket, the cart line, and the
 * checkout basket line. The success receipt deliberately does not carry it —
 * the purchase is complete and the restriction is no longer actionable.
 *
 * The visible glyph is a graphic shorthand, so the meaning is spelled out for a
 * screen reader rather than left to "eighteen plus".
 */
export function AgeChip({ className }: { className?: string }) {
  return (
    <span className={className ? `age-chip ${className}` : "age-chip"}>
      <span className="sr-only">Age restricted: </span>18+
    </span>
  );
}