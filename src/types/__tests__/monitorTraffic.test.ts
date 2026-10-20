import { describe, expect, it } from "vitest";
import { safeMonitorNodes, convertMonitorNodeToMetrics } from "@/types/monitor";
import { resolveTrafficUsage } from "@/utils/traffic";
import { periodTrafficNode } from "@/test/fixtures/traffic";

describe("Monitor period traffic adapter", () => {
  it.each([true, false])("uses the same period while online=%s, keeping lifetime totals separate", (online) => {
    const [node] = safeMonitorNodes({ nodes: [{ ...periodTrafficNode, online, metrics: online ? { cpu: 0 } : null }] });
    const metrics = convertMonitorNodeToMetrics(node);
    expect(metrics).toMatchObject({
      online, month_used: 19917947772, month_start: "2026-10-13",
      month_tx: 10358022280, month_rx: 9559925492,
      trafficUp: 127835774927, trafficDown: 125105141668,
    });
    expect(resolveTrafficUsage(node.traffic_mode, metrics, node.traffic_limit!).used).toBe(node.month_used);
  });

  it("prefers the Hub's zero over stale nested metrics after rollover", () => {
    const [node] = safeMonitorNodes([{ ...periodTrafficNode, month_rx: 0, month_tx: 0, month_used: 0,
      metrics: { month_used: 123, month_rx: 50, month_tx: 73, month_start: "2026-09-13" } }]);
    expect(convertMonitorNodeToMetrics(node)).toMatchObject({
      month_used: 0, month_rx: 0, month_tx: 0, month_start: "2026-10-13",
    });
  });

  it.each([true, false])("accepts metrics-only cycle fields while online=%s", (online) => {
    const [node] = safeMonitorNodes([{ id: 1, online, metrics: {
      month_rx: 10, month_tx: 20, month_used: 30, month_start: "2026-10-13",
    } }]);
    expect(convertMonitorNodeToMetrics(node)).toMatchObject({ month_rx: 10, month_tx: 20, month_used: 30, month_start: "2026-10-13" });
  });

  it.each([undefined, null, -1, NaN, Infinity, "0"])("preserves unavailable cycle data rather than making zero from %s", (value) => {
    const [node] = safeMonitorNodes([{ id: 1, online: true, total_rx: 900, total_tx: 800,
      month_rx: value, month_tx: value, month_used: value, metrics: {} }]);
    const metrics = convertMonitorNodeToMetrics(node);
    expect(metrics.month_used).toBeUndefined();
    expect(metrics.month_rx).toBeUndefined();
    expect(resolveTrafficUsage("sum", metrics, 200).available).toBe(false);
  });
});
