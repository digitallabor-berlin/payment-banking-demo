"use client";

import { useReducedMotion } from "@/lib/useReducedMotion.js";
import type { SheetGlyph } from "@/lib/sheet-state.js";

export interface PaymentProgressBarProps {
 /**
  * The same `SheetGlyph` the EudiPay ring draws at its centre, reused rather
  * than a second vocabulary: `card` is in-flight, `check` is paid, `alert` is
  * declined. A separate `tone` union here would be a second thing to keep in
  * step with `selectSheetView`.
  */
 glyph: SheetGlyph;
 /** Sweep instead of sitting still. Ignored under prefers-reduced-motion. */
 animate: boolean;
 className?: string;
}

/**
 * The neutral sheet's status indicator: a slim track in the shop's own palette.
 *
 * It replaces `EudiPayRing` for the demo customer, and it is deliberately less
 * expressive than the ring. The ring's twelve stars carry brand meaning — "one
 * of twelve, the last belongs to the bank" — which is exactly what this flow is
 * trying not to say. A progress track says only "something is happening", which
 * is all a shop's own checkout should claim while a wallet is open.
 *
 * The three tones ARE load-bearing though: a declined payment that kept the
 * in-flight colour would read as still running, and the sheet's copy is the
 * only other thing distinguishing them.
 *
 * `aria-hidden`, like the ring: every state also carries its pill or headline as
 * text inside the sheet's `role="status"` region, so this adds nothing a screen
 * reader needs and would otherwise announce a bar that means nothing on its own.
 *
 * Unlike the ring, the sweep is a CSS animation rather than a JS interval: there
 * is no per-step state to keep exact here — nothing accumulates — so a keyframe
 * is both sufficient and cheaper than a timer that re-renders four times a
 * second.
 */
export function PaymentProgressBar({
 glyph,
 animate,
 className,
}: PaymentProgressBarProps) {
 const reduced = useReducedMotion();
 // Same direction as the ring's: static first, moving only once an effect has
 // confirmed motion is welcome. A sweep that starts during SSR and stops is
 // worse than one that starts a frame late.
 const sweeping = animate && !reduced;

 return (
  <div
   className={className ? `shop-progress ${className}` : "shop-progress"}
   data-tone={glyph}
   data-sweeping={sweeping ? "true" : undefined}
   aria-hidden="true"
  >
   <div className="shop-progress-fill" />
  </div>
 );
}
