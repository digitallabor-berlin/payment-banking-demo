"use client";

import { useEffect, useRef, useState } from "react";
import { pollUntilTerminal, type PollOptions, type PollOutcome } from "./poll.js";

export interface UseStatusPollResult<T> {
  value: T | null;
  outcome: PollOutcome<T> | null;
}

/**
 * Thin React wrapper over pollUntilTerminal. Aborts on unmount.
 * `enabled: false` suspends polling without unmounting the consumer.
 */
export function useStatusPoll<T>(
  opts: Omit<PollOptions<T>, "signal"> & { enabled?: boolean },
): UseStatusPollResult<T> {
  const { enabled = true, fetchOnce, isTerminal } = opts;
  const [value, setValue] = useState<T | null>(null);
  const [outcome, setOutcome] = useState<PollOutcome<T> | null>(null);

  const fetchRef = useRef(fetchOnce);
  fetchRef.current = fetchOnce;
  const terminalRef = useRef(isTerminal);
  terminalRef.current = isTerminal;

  const { intervalMs, timeoutMs, maxConsecutiveFailures } = opts;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let cancelled = false;

    void pollUntilTerminal<T>({
      fetchOnce: async () => {
        const next = await fetchRef.current();
        if (!cancelled) setValue(next);
        return next;
      },
      isTerminal: (v) => terminalRef.current(v),
      intervalMs,
      timeoutMs,
      maxConsecutiveFailures,
      signal: controller.signal,
    }).then((result) => {
      if (!cancelled) setOutcome(result);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, intervalMs, timeoutMs, maxConsecutiveFailures]);

  return { value, outcome };
}