"use client";

import { useEffect, useState } from "react";
import { ringPoints, starPath } from "@demo/ui";
import { useReducedMotion } from "@/lib/useReducedMotion.js";
import type { SheetGlyph } from "@/lib/sheet-state.js";

/** One 400ms step per star; twelve stars, then it starts over. */
const STEP_MS = 400;
const STARS = 12;

export interface EudiPayRingProps {
  /** What to show when the ring is static. 0..12. */
  litStars: number;
  /** Cycle 1 -> 12 instead. Ignored under prefers-reduced-motion. */
  animate: boolean;
  glyph: SheetGlyph;
  className?: string;
}

/**
 * The payment sheet's status indicator, and its one bold move.
 *
 * The twelve stars used to live inside EudiPayLogo alongside the card. They are
 * out here now because this is the only indicator that keeps its meaning across
 * every state the sheet has — a spinner cannot express "eleven of twelve, the
 * last one belongs to the bank", and it cannot express "declined" at all. It is
 * also the brand's own iconography rather than borrowed UI furniture.
 *
 * The cycle is driven in JS on purpose. Accumulating stars one per tick and
 * restarting is exact here; in CSS it needs per-star negative delays and a
 * fill-mode that lights everything permanently after the first pass.
 *
 * aria-hidden: this is decoration. Every state also carries its pill or headline
 * as text, and the sheet announces those through a role="status" region.
 */
export function EudiPayRing({ litStars, animate, glyph, className }: EudiPayRingProps) {
  const reduced = useReducedMotion();
  const cycling = animate && !reduced;
  const [tick, setTick] = useState(1);

  useEffect(() => {
    if (!cycling) return;
    setTick(1);
    const timer = setInterval(
      () => setTick((current) => (current % STARS) + 1),
      STEP_MS,
    );
    return () => clearInterval(timer);
  }, [cycling]);

  const lit = cycling ? tick : litStars;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {ringPoints(50, 50, 40).map((point, index) => (
        <path
          key={index}
          d={starPath(point.x, point.y, 5.2)}
          className={index < lit ? "eudipay-star eudipay-star-lit" : "eudipay-star"}
        />
      ))}
      <RingGlyph glyph={glyph} />
    </svg>
  );
}

/**
 * The mark at the centre of the ring, on a white card so it reads as the
 * instrument's own chip rather than as a hole in the field.
 *
 * The alert glyph uses #e05252, not the #FFB3B3 of spec §3.1: that tint is
 * specified as ink on the blue field, and this glyph sits on the white card
 * where it would be unreadable. The eyebrow keeps #FFB3B3.
 */
function RingGlyph({ glyph }: { glyph: SheetGlyph }) {
  return (
    <>
      <rect x="27" y="35" width="46" height="30" rx="5.5" fill="#ffffff" />
      {glyph === "card" ? (
        <>
          <rect x="27" y="42" width="46" height="6" fill="#004dd7" />
          <circle cx="64" cy="58" r="4.2" fill="#ffcc00" />
        </>
      ) : glyph === "check" ? (
        <path
          d="M39 50.5 46 57.5 61 42.5"
          stroke="#004dd7"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <>
          <rect x="47.5" y="41" width="5" height="11" rx="2.5" fill="#e05252" />
          <circle cx="50" cy="58" r="2.9" fill="#e05252" />
        </>
      )}
    </>
  );
}