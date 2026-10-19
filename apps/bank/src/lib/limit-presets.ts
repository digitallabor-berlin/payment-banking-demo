/**
 * The daily-limit presets and the one rule that decides whether a requested
 * new limit is allowed at all.
 *
 * Plain functions in a `.ts` file rather than a branch inside the dialog, for
 * the reason every decision in this app lives in `.ts`: vitest is
 * `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a ternary in
 * a `.tsx` file is covered by nothing.
 */

/**
 * 500 €, 1.000 €, 2.000 €, 5.000 € — in CENTS, not copy.
 *
 * They are data, so they live here and are formatted at render through the
 * existing `formatEuroCents`. Putting them in the i18n catalogs as
 * pre-formatted strings would duplicate four amounts across two locales and
 * let them drift, and the catalog would then hold a number the server has to
 * parse back out to compare against the database.
 *
 * Presets rather than a free-entry amount was an explicit design choice:
 * nothing can be mistyped on stage, and there is no validation copy to write.
 *
 * The seed's starting limit (100_000) is deliberately one of these, so the
 * dialog's "not the one already in force" rule has something to exclude from
 * the very first render.
 */
export const LIMIT_PRESETS_CENTS: readonly number[] = [
  50_000, 100_000, 200_000, 500_000,
];

/**
 * Whether a preset chip should be offered, given the limit already in force.
 *
 * The chip equal to the current limit is withheld rather than disabled, so
 * Continue can never send a no-op — which is the same thing `isValidNewLimit`
 * refuses server-side. Two expressions of one rule, on purpose: the UI must
 * not be the only place it holds.
 */
export function isSelectablePreset(
  presetCents: number,
  currentCents: number,
): boolean {
  return presetCents !== currentCents;
}

/**
 * Whether a value that arrived over HTTP names an allowed new limit.
 *
 * A type predicate, and it FAILS CLOSED on everything: non-numbers, non-finite
 * numbers, non-integers, anything outside the preset set, and the current
 * limit itself. The start route trusts this instead of writing its own guard,
 * so every rejection the dialog structurally cannot produce has to be caught
 * here — a logged-in caller with `curl` is the real input surface.
 *
 * Note `Number.isInteger` already excludes `NaN` and both infinities, so the
 * membership test below can never see a value that compares equal to a preset
 * by coercion.
 */
export function isValidNewLimit(
  value: unknown,
  currentCents: number,
): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) return false;
  if (!LIMIT_PRESETS_CENTS.includes(value)) return false;
  return isSelectablePreset(value, currentCents);
}