"use client";

import { useEffect, useState } from "react";
import { supportsDcApi, type DcApiMethod } from "./dcApi.js";

/**
 * `null` means "not yet known" and is load-bearing — it is NOT the same as
 * "known unavailable". A caller that renders the QR fallback on `null` will
 * flash a QR on Android before it disappears. Always null during SSR and the
 * first client render, so server and client markup agree (same discipline as
 * useIsTouch).
 *
 * Not unit-tested: it is a thin wrapper and all the logic lives in
 * supportsDcApi, which is.
 */
export function useDcApiSupport(method: DcApiMethod, protocol: string): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(supportsDcApi(method, protocol));
  }, [method, protocol]);

  return supported;
}