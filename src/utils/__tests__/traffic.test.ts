import { describe, expect, it } from "vitest";
import { computeTrafficUsed, resolveTrafficUsage, trafficTypeLabel } from "@/utils/traffic";
import { periodTrafficNode } from "@/test/fixtures/traffic";

const period = { month_tx: 30, month_rx: 70 };

describe("Monitor billing semantics", () => {
  it.each([
    ["sum", 100, "上行+下行"], ["up", 30, "仅上行"],
    ["down", 70, "仅下行"], ["max", 70, "上下取大"],
    ["min", 100, "上行+下行"], ["unknown", 100, "上行+下行"],
    ["", 100, "上行+下行"], [undefined, 100, "上行+下行"],
    [null, 100, "上行+下行"], [" UP ", 100, "上行+下行"],
  ])("matches Hub mode %s (unknown modes use sum)", (mode, used, label) => {
    expect(computeTrafficUsed(mode, 30, 70)).toBe(used);
    expect(resolveTrafficUsage(mode, period, 200).used).toBe(used);
    expect(trafficTypeLabel(mode)).toBe(label);
  });
});

describe("resolveTrafficUsage", () => {
  it("uses the reported period usage, never lifetime totals", () => {
    const usage = resolveTrafficUsage("sum", periodTrafficNode, periodTrafficNode.traffic_limit);
    expect(usage.available).toBe(true);
    expect(usage.used! / 1024 ** 3).toBeCloseTo(18.55, 2);
    expect(usage.remaining! / 1024 ** 3).toBeCloseTo(981.45, 2);
    expect(usage.fraction * 100).toBeCloseTo(1.855, 3);
    // Authoritative Hub usage can differ from a local reduction.
    expect(resolveTrafficUsage("sum", { ...period, month_used: 12 }, 200).used).toBe(12);
  });

  it("accepts zero usage even with nonzero direction counters", () => {
    expect(resolveTrafficUsage("sum", { ...period, month_used: 0 }, 200)).toMatchObject({
      available: true, used: 0, remaining: 200, fraction: 0,
    });
    expect(resolveTrafficUsage("sum", { month_tx: 0, month_rx: 0 }, 200).used).toBe(0);
  });

  it.each([undefined, null, -1, NaN, Infinity, "0"])("only falls back to valid period counters for month_used=%s", (value) => {
    const input = { ...period, month_used: value } as unknown as Parameters<typeof resolveTrafficUsage>[1];
    expect(resolveTrafficUsage("sum", input, 200).used).toBe(100);
  });

  it.each([{}, { month_tx: 30 }, { month_rx: 70 }, { month_tx: -1, month_rx: 70 },
    { month_tx: NaN, month_rx: 70 }, { month_tx: 30, month_rx: Infinity },
    { month_used: -1 }, { trafficUp: 999, trafficDown: 999 },
  ])("reports unavailable when period data is missing/invalid: %j", (input) => {
    expect(resolveTrafficUsage("sum", input, 200)).toMatchObject({
      available: false, used: null, remaining: null, fraction: 0,
    });
  });

  it("preserves real usage and clamps over-quota presentation", () => {
    expect(resolveTrafficUsage("sum", { month_used: 250 }, 200)).toMatchObject({
      used: 250, remaining: 0, fraction: 1,
    });
  });

  it("handles unlimited plans without inventing usage", () => {
    expect(resolveTrafficUsage("sum", period, 0)).toMatchObject({ unlimited: true, used: 100, fraction: 0 });
    expect(resolveTrafficUsage("sum", {}, 0)).toMatchObject({ unlimited: true, available: false, used: null });
  });
});
