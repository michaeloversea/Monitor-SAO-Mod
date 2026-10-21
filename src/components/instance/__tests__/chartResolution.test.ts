import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";
import { applyChartResolution } from "../chartResolution";

function chart(ratio: number, width = 304, height = 260) {
  const canvas = { width: Math.round(width * ratio), height: Math.round(height * ratio) };
  const ctx = { canvas, setTransform: vi.fn() };
  const plot = { width, height, ctx, bbox: { left: 54 * ratio, width: 180 * ratio },
    cursor: { left: 90, top: 120 }, scales: { x: { min: 100, max: 200 }, loss: { min: 0, max: 100 } } };
  return { plot: plot as unknown as uPlot, model: plot, canvas, ctx };
}

describe("chart resolution", () => {
  it("uses a 608×520 bitmap for the 304×260 low-DPI mobile chart", () => {
    const { plot, canvas, ctx } = chart(1);
    const geometry = { ...plot.bbox }; const scales = JSON.stringify(plot.scales); const cursor = { ...plot.cursor };
    applyChartResolution(plot, 1);
    expect(canvas).toEqual({ width: 608, height: 520 });
    expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect([plot.width, plot.height]).toEqual([304, 260]);
    expect(plot.bbox).toEqual(geometry); expect(plot.cursor).toEqual(cursor); expect(JSON.stringify(plot.scales)).toBe(scales);
  });

  it("supports fractional browser scaling", () => {
    const { plot, canvas, ctx } = chart(1.25);
    applyChartResolution(plot, 1.25);
    expect(canvas).toEqual({ width: 608, height: 520 });
    expect(ctx.setTransform).toHaveBeenCalledWith(1.6, 0, 0, 1.6, 0, 0);
  });

  it.each([2, 3])("preserves native high-DPI rendering at %s×", (ratio) => {
    const { plot, canvas, ctx } = chart(ratio);
    const before = { ...canvas };
    applyChartResolution(plot, ratio);
    expect(canvas).toEqual(before); expect(ctx.setTransform).not.toHaveBeenCalled();
  });

  it("does not repeatedly allocate the bitmap and handles uPlot resizing without cumulative scaling", () => {
    const { plot, model, canvas, ctx } = chart(1);
    applyChartResolution(plot, 1); applyChartResolution(plot, 1);
    expect(ctx.setTransform).toHaveBeenCalledTimes(1);
    // uPlot resets the bitmap to its native size before the resize hook.
    model.width = 360; canvas.width = 360; canvas.height = 260;
    applyChartResolution(plot, 1);
    expect(canvas).toEqual({ width: 720, height: 520 });
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  });
});
