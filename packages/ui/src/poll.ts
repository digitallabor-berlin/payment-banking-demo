export type PollOutcome<T> =
  | { status: "terminal"; value: T }
  | { status: "timeout" }
  | { status: "failed"; error: unknown }
  | { status: "aborted" };

export interface PollOptions<T> {
  fetchOnce: () => Promise<T>;
  isTerminal: (value: T) => boolean;
  /** Delay between attempts. Default 2000 ms (spec 6.3). */
  intervalMs?: number;
  /** Total wall-clock cap. Default 600000 ms (10 minutes, spec 6.3). */
  timeoutMs?: number;
  /** Consecutive errors tolerated before giving up. Default 5 (spec 6.3). */
  maxConsecutiveFailures?: number;
  signal?: AbortSignal;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Polls `fetchOnce` until `isTerminal` accepts a value, the timeout is reached,
 * too many consecutive failures occur, or the signal aborts.
 *
 * Deliberately not a React hook so it is testable without a DOM.
 */
export async function pollUntilTerminal<T>(opts: PollOptions<T>): Promise<PollOutcome<T>> {
  const {
    fetchOnce,
    isTerminal,
    intervalMs = 2000,
    timeoutMs = 600_000,
    maxConsecutiveFailures = 5,
    signal,
    sleep = defaultSleep,
    now = () => Date.now(),
  } = opts;

  const startedAt = now();
  let consecutiveFailures = 0;

  for (;;) {
    if (signal?.aborted) return { status: "aborted" };
    if (now() - startedAt > timeoutMs) return { status: "timeout" };

    try {
      const value = await fetchOnce();
      consecutiveFailures = 0;
      if (isTerminal(value)) return { status: "terminal", value };
    } catch (error) {
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        return { status: "failed", error };
      }
    }

    if (signal?.aborted) return { status: "aborted" };
    await sleep(intervalMs, signal);
  }
}