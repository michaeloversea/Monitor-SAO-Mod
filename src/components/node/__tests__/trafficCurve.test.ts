import { describe, expect, it } from "vitest";
import { buildTrafficCurve } from "../trafficCurve";

describe("overview traffic curve", () => {
  it("preserves samples and does not overshoot spikes, zeroes or plateaus", () => {
    const points = [0, 0, 25, 1000, 5, 6, 6, 0, 400, 200].map((y, x) => ({ x: x * 12, y }));
    const segments = buildTrafficCurve(points);
    expect(segments).toHaveLength(points.length - 1);
    segments.forEach((segment, index) => {
      const start = points[index];
      expect(segment.end).toEqual(points[index + 1]);
      for (let step = 0; step <= 100; step++) {
        const t = step / 100;
        const s = 1 - t;
        const y = s ** 3 * start.y + 3 * s ** 2 * t * segment.control1.y
          + 3 * s * t ** 2 * segment.control2.y + t ** 3 * segment.end.y;
        expect(y).toBeGreaterThanOrEqual(Math.min(start.y, segment.end.y) - 1e-9);
        expect(y).toBeLessThanOrEqual(Math.max(start.y, segment.end.y) + 1e-9);
      }
    });
  });

  it("joins segments smoothly and leaves the original points unchanged", () => {
    const points = Object.freeze([0, 10, 30, 5].map((y, x) => Object.freeze({ x: x * 20, y })));
    const segments = buildTrafficCurve(points);
    segments.slice(0, -1).forEach((segment, index) => {
      const next = segments[index + 1];
      expect(segment.end.y - segment.control2.y).toBeCloseTo(next.control1.y - segment.end.y);
    });
    expect(points.map(point => point.y)).toEqual([0, 10, 30, 5]);
  });

  it("handles empty, single and two-point histories", () => {
    expect(buildTrafficCurve([])).toEqual([]);
    expect(buildTrafficCurve([{ x: 0, y: 0 }])).toEqual([]);
    expect(buildTrafficCurve([{ x: 0, y: 4 }, { x: 3, y: 4 }])).toEqual([
      { control1: { x: 1, y: 4 }, control2: { x: 2, y: 4 }, end: { x: 3, y: 4 } },
    ]);
  });
});
