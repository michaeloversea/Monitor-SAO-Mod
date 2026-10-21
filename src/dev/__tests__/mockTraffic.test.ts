import { describe, expect, it } from "vitest";
import { mockTrafficRate } from "../mockTraffic";

describe("mock overview traffic", () => {
  const aggregate = (tick: number, direction: "up" | "down") =>
    [0, 1, 2, 3, 4].reduce((sum, node) => sum + mockTrafficRate(node, direction, tick * 2000), 0);

  it("shows both transfer peaks and idle valleys in every short preview window", () => {
    for (const direction of ["up", "down"] as const) {
      for (let start = 0; start < 24; start++) {
        const rates = Array.from({ length: 16 }, (_, index) => aggregate(start + index, direction));
        expect(Math.max(...rates)).toBeGreaterThan(Math.min(...rates) * 10);
        expect(rates.every(rate => Number.isFinite(rate) && rate >= 0)).toBe(true);
      }
    }
  });

  it("is reproducible, with independent upload/download bursts and node variation", () => {
    expect(mockTrafficRate(2, "up", 100_000)).toBe(mockTrafficRate(2, "up", 100_000));
    const up = Array.from({ length: 24 }, (_, tick) => aggregate(tick, "up"));
    const down = Array.from({ length: 24 }, (_, tick) => aggregate(tick, "down"));
    expect(up.indexOf(Math.max(...up))).not.toBe(down.indexOf(Math.max(...down)));
    expect(mockTrafficRate(0, "up", 100_000)).not.toBe(mockTrafficRate(4, "up", 100_000));
  });
});
