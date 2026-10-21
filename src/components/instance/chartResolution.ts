import type uPlot from "uplot";

/** Supersample low-DPI charts without changing uPlot's CSS geometry or global DPR. */
export function applyChartResolution(plot: uPlot, nativeRatio: number) {
  if (!Number.isFinite(nativeRatio) || nativeRatio <= 0 || nativeRatio >= 2) return;
  const canvas = plot.ctx.canvas;
  const width = Math.round(plot.width * 2);
  const height = Math.round(plot.height * 2);
  if (canvas.width === width && canvas.height === height) return;

  // uPlot has just reset the bitmap and its paint cache in setSize. All paths,
  // axes and custom loss bars still use uPlot's native coordinates; scale them
  // together, leaving cursor positions, tooltips and zoom calculations intact.
  canvas.width = width;
  canvas.height = height;
  const scale = 2 / nativeRatio;
  plot.ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

export const highDpiChartPlugin: uPlot.Plugin = {
  hooks: {
    setSize: [(plot) => applyChartResolution(plot, window.devicePixelRatio)],
  },
};
