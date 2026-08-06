import type { CheckView } from "@/lib/order-view.js";

export function VerificationDetails({ checks }: { checks: CheckView[] }) {
  if (checks.length === 0) return null;

  return (
    <details className="mt-6 text-left">
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-brand)]">
        Verification details
      </summary>
      <div className="mt-3">
        {checks.map((entry) => (
          <div key={entry.check} className="check-row">
            <span aria-hidden="true">{entry.passed ? "✓" : "✗"}</span>
            <span className="check-name flex-1">{entry.check}</span>
            <span
              className={
                entry.passed
                  ? "text-[var(--color-success)]"
                  : "text-[var(--color-destructive)]"
              }
            >
              {entry.passed ? "passed" : "failed"}
            </span>
            {entry.detail ? (
              <span className="text-[var(--color-muted-foreground)]">{entry.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  );
}