import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locale.js";

/**
 * The active locale for the current request.
 *
 * Deliberately logic-free. `next/headers` cannot be exercised under this
 * repo's `environment: "node"` vitest, so every decision lives in
 * `resolveLocale`, which is fully tested. This wrapper is a one-liner precisely
 * so there is nothing in it left to test.
 *
 * Safe to call from any page: all of them are already
 * `export const dynamic = "force-dynamic"` and already `await getSession()`.
 */
export async function getLocale(): Promise<Locale> {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}