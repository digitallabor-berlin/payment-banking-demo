import { describe, expect, it } from "vitest";
import { groupByBookingDay } from "./ledger.js";

/** 2025-08-01T10:00:00Z and friends, expressed in UTC to match the grouping. */
const AUG_1_MORNING = Date.UTC(2025, 7, 1, 10, 0, 0);
const AUG_1_EVENING = Date.UTC(2025, 7, 1, 22, 30, 0);
const JUL_31 = Date.UTC(2025, 6, 31, 9, 0, 0);

describe("groupByBookingDay", () => {
  it("returns no groups for no rows", () => {
    expect(groupByBookingDay([])).toEqual([]);
  });

  it("collects entries booked on the same UTC day into one group", () => {
    const groups = groupByBookingDay([
      { id: "a", bookedAt: AUG_1_EVENING },
      { id: "b", bookedAt: AUG_1_MORNING },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("2025-08-01");
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("starts a new group when the day changes", () => {
    const groups = groupByBookingDay([
      { id: "a", bookedAt: AUG_1_EVENING },
      { id: "b", bookedAt: JUL_31 },
    ]);

    expect(groups.map((g) => g.key)).toEqual(["2025-08-01", "2025-07-31"]);
  });

  it("preserves the caller's order rather than sorting", () => {
    const groups = groupByBookingDay([
      { id: "old", bookedAt: JUL_31 },
      { id: "new", bookedAt: AUG_1_MORNING },
    ]);

    expect(groups.map((g) => g.key)).toEqual(["2025-07-31", "2025-08-01"]);
  });

  it("emits a second group when a day reappears non-contiguously", () => {
    const groups = groupByBookingDay([
      { id: "a", bookedAt: AUG_1_EVENING },
      { id: "b", bookedAt: JUL_31 },
      { id: "c", bookedAt: AUG_1_MORNING },
    ]);

    expect(groups.map((g) => g.key)).toEqual(["2025-08-01", "2025-07-31", "2025-08-01"]);
  });

  it("labels a group with its weekday and date", () => {
    const groups = groupByBookingDay([{ id: "a", bookedAt: AUG_1_MORNING }]);
    expect(groups[0]?.label).toBe("Fr, 01.08.2025");
  });
});