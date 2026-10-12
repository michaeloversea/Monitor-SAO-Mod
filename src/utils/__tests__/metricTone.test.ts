import { describe, expect, it } from "vitest";
import {
  buildTrafficHeatSpectrum,
  buildTrafficQuotaSegmentColors,
  resolveCustomLatencyColor,
  resolveCustomLossColor,
  resolveTrafficSegmentColor,
  latencyHeatColor,
  lossHeatColor,
  speedRateColor,
  speedRateColorFromBytes,
  trafficQuotaSegmentColor,
  trafficUsageColor,
} from "@/utils/metricTone";

function hue(color: string): number {
  const match = /^hsl\(([\d.]+)/.exec(color);
  if (!match) throw new Error(`not an hsl color: ${color}`);
  return Number(match[1]);
}

function oklchHue(color: string): number {
  const match = /^oklch\([\d.]+ [\d.]+ ([\d.]+)\)$/.exec(color);
  if (!match) throw new Error(`not an oklch color: ${color}`);
  return Number(match[1]);
}


describe("latencyHeatColor", () => {
  it("treats 0ms (sub-millisecond success) as the greenest latency, not neutral", () => {
    // 后端把往返 <1ms 取整成 0；0 是最优延迟，不能当无数据画成中性灰。
    const color = latencyHeatColor(0);
    expect(color).not.toBe("var(--text-tertiary)");
    expect(color).toBe("var(--latency-excellent)");
  });

  it("returns neutral only for no data (null/undefined) or loss (negative / non-finite)", () => {
    expect(latencyHeatColor(null)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(undefined)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(-1)).toBe("var(--text-tertiary)");
    expect(latencyHeatColor(Number.NaN)).toBe("var(--text-tertiary)");
  });

  it("uses explicit monitoring tiers with useful separation inside 0-100ms", () => {
    expect(latencyHeatColor(53)).toBe("var(--latency-excellent)");
    expect(latencyHeatColor(60)).toBe("var(--latency-excellent)");
    expect(latencyHeatColor(61)).toBe("var(--latency-good)");
    expect(latencyHeatColor(91)).toBe("var(--latency-good)");
    expect(latencyHeatColor(100)).toBe("var(--latency-good)");
    expect(latencyHeatColor(101)).toBe("var(--latency-moderate)");
    expect(latencyHeatColor(160)).toBe("var(--latency-moderate)");
    expect(latencyHeatColor(161)).toBe("var(--latency-elevated)");
    expect(latencyHeatColor(200)).toBe("var(--latency-elevated)");
    expect(latencyHeatColor(201)).toBe("var(--latency-critical)");
  });
});

describe("lossHeatColor", () => {
  it("treats 0% loss as the greenest, neutral only for negative / no data", () => {
    expect(hue(lossHeatColor(0))).toBeCloseTo(145, 0);
    expect(lossHeatColor(null)).toBe("var(--text-tertiary)");
    expect(lossHeatColor(-1)).toBe("var(--text-tertiary)");
  });
});

describe("trafficUsageColor", () => {
  it("returns the success token for no usage / unlimited / invalid", () => {
    expect(trafficUsageColor(0)).toBe("var(--status-success)");
    expect(trafficUsageColor(null)).toBe("var(--status-success)");
    expect(trafficUsageColor(Number.NaN)).toBe("var(--status-success)");
  });

  it("stays green while at least half the quota remains", () => {
    // used ≤ 50% 时处于绿色区(约 140–150°),健康配额不会被误显示成警告色
    expect(hue(trafficUsageColor(0.1))).toBeGreaterThan(140);
    expect(hue(trafficUsageColor(0.5))).toBeGreaterThan(140);
  });

  it("actually reaches red near the limit — the regression it fixes", () => {
    // 以前 85% 以下根本到不了红色(hue ≲ 15°),整个常用区间都只是绿→浅绿
    expect(hue(trafficUsageColor(0.95))).toBeLessThan(20);
    expect(hue(trafficUsageColor(1))).toBeLessThan(12);
  });

  it("warms monotonically (hue never increases) as usage climbs", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let f = 0.05; f <= 1.0001; f += 0.05) {
      const h = hue(trafficUsageColor(Math.min(f, 1)));
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });
});

describe("trafficQuotaSegmentColor", () => {
  it("returns OKLCH and holds solid green across the short safe zone", () => {
    // 按位置取色,所以每段颜色固定、与填充量无关。绿色保持区很短(约 10%),避免绿色占主导,
    // 过了这段 hue 就往黄色下降
    expect(trafficQuotaSegmentColor(0)).toBe("oklch(0.7200 0.1600 150.00)");
    expect(trafficQuotaSegmentColor(0.05)).toBe("oklch(0.7200 0.1600 150.00)");
    expect(oklchHue(trafficQuotaSegmentColor(0.3))).toBeLessThan(128);
  });

  it("rotates the OKLCH hue green→yellow→orange→red so the zones stay distinct", () => {
    expect(oklchHue(trafficQuotaSegmentColor(0.03))).toBeGreaterThan(145); // 绿
    expect(oklchHue(trafficQuotaSegmentColor(0.44))).toBeGreaterThan(95); // 黄
    expect(oklchHue(trafficQuotaSegmentColor(0.44))).toBeLessThan(125);
    expect(oklchHue(trafficQuotaSegmentColor(0.72))).toBeLessThan(70); // 橙
    expect(oklchHue(trafficQuotaSegmentColor(1))).toBeLessThan(35); // 红
  });

  it("warms monotonically — OKLCH hue never rises with position", () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const h = oklchHue(trafficQuotaSegmentColor(Math.min(p, 1)));
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });

  it("clamps positions outside 0..1", () => {
    expect(trafficQuotaSegmentColor(-1)).toBe(trafficQuotaSegmentColor(0));
    expect(trafficQuotaSegmentColor(2)).toBe(trafficQuotaSegmentColor(1));
  });
});

describe("speedRateColor", () => {
  it("maps each rate-unit tier to its own heat token (B→KB→MB→GB+)", () => {
    expect(speedRateColor("KB/s")).toBe("var(--speed-low)");
    expect(speedRateColor("MB/s")).toBe("var(--speed-high)");
    expect(speedRateColor("GB/s")).toBe("var(--speed-max)");
    // TB/s·PB/s 现实到不了,并入急速顶档(--speed-max)而非各占一档。
    expect(speedRateColor("TB/s")).toBe("var(--speed-max)");
    expect(speedRateColor("PB/s")).toBe("var(--speed-max)");
  });

  it("maps idle (B/s) to its own 超低速 tier, only unknown units go neutral", () => {
    expect(speedRateColor("B/s")).toBe("var(--speed-idle)");
    expect(speedRateColor("")).toBe("var(--text-tertiary)");
  });

  it("speedRateColorFromBytes routes raw bytes/sec through the unit tier", () => {
    expect(speedRateColorFromBytes(0)).toBe("var(--speed-idle)");
    expect(speedRateColorFromBytes(5 * 1024 * 1024)).toBe("var(--speed-high)");
  });
});

describe("custom status bar boundaries", () => {
  it("uses exact inclusive latency thresholds and preserves missing/failed sample colors", () => {
    const thresholds = { excellent: 20, good: 40, moderate: 80, elevated: 160 };
    const colors = { excellent: "#111111", good: "#222222", moderate: "#333333", elevated: "#444444", critical: "#555555" };
    expect([0, 20, 21, 40, 41, 80, 81, 160, 161].map(n => resolveCustomLatencyColor(n, thresholds, colors)))
      .toEqual([colors.excellent, colors.excellent, colors.good, colors.good, colors.moderate, colors.moderate, colors.elevated, colors.elevated, colors.critical]);
    for (const value of [null, undefined, NaN, -1]) expect(resolveCustomLatencyColor(value, thresholds, colors)).toBe("var(--text-tertiary)");
  });
  it("distinguishes zero loss, inclusive loss boundaries and outages", () => {
    const thresholds = { low: 1.5, medium: 7.5 };
    const colors = { zero: "#111111", low: "#222222", medium: "#333333", high: "#444444" };
    expect([0, 0.1, 1.5, 1.6, 7.5, 7.6, 100].map(n => resolveCustomLossColor(n, thresholds, colors)))
      .toEqual([colors.zero, colors.low, colors.low, colors.medium, colors.medium, colors.high, colors.high]);
    for (const value of [null, undefined, NaN, -1]) expect(resolveCustomLossColor(value, thresholds, colors)).toBe("var(--text-tertiary)");
  });
  it("builds the 18-segment spectrum and interpolates all configured anchors", () => {
    const colors = { start: "#000000", mid: "#ffffff", high: "#ff0000", end: "#0000ff" };
    expect(buildTrafficQuotaSegmentColors(colors)).toHaveLength(18);
    expect([0, .15, .5, .8, 1].map(p => resolveTrafficSegmentColor(p, colors))).toEqual([colors.start, colors.start, colors.mid, colors.high, colors.end]);
    expect(resolveTrafficSegmentColor(.325, colors)).toBe("#808080");
    expect(resolveTrafficSegmentColor(-1, colors)).toBe(colors.start);
    expect(resolveTrafficSegmentColor(2, colors)).toBe(colors.end);
    expect(buildTrafficHeatSpectrum(colors)).toBe("linear-gradient(to right, #000000 0%, #000000 15%, #ffffff 50%, #ff0000 80%, #0000ff 100%)");
  });
});
