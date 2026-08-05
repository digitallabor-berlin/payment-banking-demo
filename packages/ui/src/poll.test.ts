import { describe, expect, it, vi } from "vitest";
import { pollUntilTerminal } from "./poll.js";

/** Deterministic clock: sleep advances it instantly, no real timers. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("pollUntilTerminal", () => {
  it("returns the terminal value and stops polling", async () => {
    const clock = fakeClock();
    const states = ["pending", "pending", "verified", "verified"];
    let calls = 0;
    const fetchOnce = vi.fn(async () => states[calls++] ?? "pending");

    const outcome = await pollUntilTerminal({
      fetchOnce,
      isTerminal: (v) => v === "verified",
      intervalMs: 2000,
      timeoutMs: 600_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome).toEqual({ status: "terminal", value: "verified" });
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it("polls at the given interval", async () => {
    const clock = fakeClock();
    let calls = 0;
    await pollUntilTerminal({
      fetchOnce: async () => (++calls === 3 ? "done" : "pending"),
      isTerminal: (v) => v === "done",
      intervalMs: 2000,
      timeoutMs: 600_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    // Two sleeps between three attempts.
    expect(clock.now()).toBe(4000);
  });

  it("gives up with timeout once the cap is exceeded", async () => {
    const clock = fakeClock();
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => "pending",
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 10_000,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.status).toBe("timeout");
  });

  it("tolerates transient failures below the threshold", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        calls++;
        if (calls <= 3) throw new Error("network");
        return "done";
      },
      isTerminal: (v) => v === "done",
      intervalMs: 2000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ status: "terminal", value: "done" });
  });

  it("fails after maxConsecutiveFailures consecutive errors", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        calls++;
        throw new Error(`boom ${calls}`);
      },
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome.status).toBe("failed");
    expect(calls).toBe(5);
  });

  it("resets the failure counter after a success", async () => {
    const clock = fakeClock();
    const script: Array<"ok" | "err"> = [
      "err", "err", "err", "err", "ok",
      "err", "err", "err", "err", "ok",
    ];
    let i = 0;
    const outcome = await pollUntilTerminal({
      fetchOnce: async () => {
        const step = script[i++];
        if (step === undefined) return "done";
        if (step === "err") throw new Error("transient");
        return "pending";
      },
      isTerminal: (v) => v === "done",
      intervalMs: 1000,
      timeoutMs: 600_000,
      maxConsecutiveFailures: 5,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ status: "terminal", value: "done" });
  });

  it("returns aborted when the signal is already aborted", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    controller.abort();
    const fetchOnce = vi.fn(async () => "pending");

    const outcome = await pollUntilTerminal({
      fetchOnce,
      isTerminal: () => false,
      intervalMs: 2000,
      timeoutMs: 600_000,
      signal: controller.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(outcome.status).toBe("aborted");
    expect(fetchOnce).not.toHaveBeenCalled();
  });
});