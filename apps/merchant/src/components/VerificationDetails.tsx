import type { CheckView } from "@/lib/order-view.js";

/**
 * foundry's verdict, check by check. Collapsed by default: a shopper wants the
 * receipt, but the point of this demo is that the evidence is there for anyone
 * who asks for it.
 */
export function VerificationDetails({ checks }: { checks: CheckView[] }) {
  if (checks.length === 0) return null;

  const passed = checks.filter((entry) => entry.passed).length;

  return (
    <details className="surface mt-6 text-left">
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5">
        <span className="eyebrow">How this was verified</span>
        <span className="data text-[var(--color-muted-foreground)]">
          {passed}/{checks.length} passed
        </span>
      </summary>

      <div className="px-5 pb-2">
        {checks.map((entry) => (
          <div key={entry.check} className="check-row py-2.5">
            <span
              aria-hidden="true"
              className={
                entry.passed
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-destructive)]"
              }
            >
              {entry.passed ? "✓" : "✗"}
            </span>
            <span className="min-w-0">
              <span className="check-name">{entry.check}</span>
              {entry.detail ? (
                <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">
                  {entry.detail}
                </span>
              ) : null}
            </span>
            <span
              className={
                entry.passed
                  ? "text-xs font-medium text-[var(--color-success)]"
                  : "text-xs font-medium text-[var(--color-destructive)]"
              }
            >
              {entry.passed ? "passed" : "failed"}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}