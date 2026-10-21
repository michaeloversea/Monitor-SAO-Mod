import type uPlot from "uplot";
import { expect, it, vi } from "vitest";
import type { PingLossBandRow } from "../PingLossBands";
import { drawPingLossBars, pingLossAxisMax, pingLossBarColor } from "../pingLossBars";

vi.mock("../../node/CanvasStrip", () => ({ safeCanvasColor: (color: string) => color }));

const row = (values: (number | null)[]): PingLossBandRow => ({ taskId: 1, label: "Route", color: "#123456", buckets: values.map((loss, i) => ({ start: i, end: i + 1, loss, total: loss == null ? 0 : 100, lost: loss ?? 0 })) });

it("uses a readable percent axis bounded by 100%, including tiny or total loss", () => {
  expect(pingLossAxisMax([])).toBe(1);
  expect(pingLossAxisMax([row([null, 0, 0.05])])).toBe(1);
  expect(pingLossAxisMax([row([1.05])])).toBe(2);
  expect(pingLossAxisMax([row([100])])).toBe(100);
});

it("draws loss against the right axis and leaves zero/missing samples empty", () => {
  const ctx = { save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), fillRect: vi.fn(), globalAlpha: 1, fillStyle: "" };
  const plot = { ctx, scales: { loss: { max: 100 } }, bbox: { left: 10, top: 0, width: 400, height: 100 }, over: { clientWidth: 400 }, valToPos: (value: number, scale: string) => scale === "x" ? value * 10 + 10 : 100 - value } as unknown as uPlot;
  drawPingLossBars(plot, [row([0, null, 1.05, 100])]);
  expect(ctx.fillRect).toHaveBeenCalledTimes(2);
  expect(ctx.fillRect.mock.calls[0][1]).toBeCloseTo(98.95);
  expect(ctx.fillRect.mock.calls[0][3]).toBeCloseTo(1.05);
  expect(ctx.fillRect.mock.calls[1][3]).toBe(100);
  expect(ctx.fillStyle).toBe("var(--status-error)");
  expect(ctx.restore).toHaveBeenCalled();
});

it("uses yellow, orange and red for loss severity, respecting configured thresholds", () => {
  expect(pingLossBarColor(1.05)).toBe("var(--status-warning)");
  expect(pingLossBarColor(3)).toBe("var(--status-warning)");
  expect(pingLossBarColor(3.1)).toBe("var(--speed-high)");
  expect(pingLossBarColor(10)).toBe("var(--speed-high)");
  expect(pingLossBarColor(10.1)).toBe("var(--status-error)");
  expect(pingLossBarColor(100)).toBe("var(--status-error)");
  expect(pingLossBarColor(4, { low: 5, medium: 20 })).toBe("var(--status-warning)");
  expect(pingLossBarColor(12, { low: 5, medium: 20 })).toBe("var(--speed-high)");
});
