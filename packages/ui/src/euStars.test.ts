import { describe, expect, it } from "vitest";
import { ringPoints, starPath } from "./euStars.js";

describe("ringPoints", () => {
  it("places twelve points by default", () => {
    expect(ringPoints(24, 24, 15)).toHaveLength(12);
  });

  it("starts at twelve o'clock", () => {
    const [first] = ringPoints(24, 24, 15);
    expect(first?.x).toBeCloseTo(24, 6);
    expect(first?.y).toBeCloseTo(9, 6);
  });

  it("advances clockwise — the fourth point is at three o'clock", () => {
    const points = ringPoints(24, 24, 15);
    expect(points[3]?.x).toBeCloseTo(39, 6);
    expect(points[3]?.y).toBeCloseTo(24, 6);
  });

  it("keeps every point on the circle of the given radius", () => {
    for (const point of ringPoints(50, 50, 20)) {
      expect(Math.hypot(point.x - 50, point.y - 50)).toBeCloseTo(20, 6);
    }
  });

  it("honours an explicit count", () => {
    expect(ringPoints(0, 0, 1, 5)).toHaveLength(5);
  });
});

describe("starPath", () => {
  it("draws a closed path of ten vertices", () => {
    const path = starPath(10, 10, 4);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    // One M, nine L-separated segments: ten vertices.
    expect(path.split("L")).toHaveLength(10);
  });
});