"use client";

import { useEffect, useState } from "react";

/**
 * True on coarse-pointer devices. Uses matchMedia rather than user-agent
 * sniffing (spec 9.5). Always false during SSR, so server and first client
 * render agree.
 */
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    setIsTouch(query.matches);
    const onChange = (event: MediaQueryListEvent) => setIsTouch(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isTouch;
}