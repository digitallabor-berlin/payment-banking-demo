"use client";

import { useEffect, useState } from "react";

/**
 * True when the user has asked for reduced motion. Kept in the merchant app
 * rather than in @demo/ui because only this app's payment sheet consults it, and
 * the bank has no equivalent motion to suppress.
 *
 * False during SSR so the server and the first client render agree; the ring
 * therefore starts static and begins cycling on the first effect, which is the
 * safe direction.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}