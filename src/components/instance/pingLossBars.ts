import type uPlot from "uplot";
import type { PingLossThresholds } from "@/types/theme";
import { DEFAULT_PING_LOSS_THRESHOLDS } from "@/utils/themeSettings";
import { safeCanvasColor } from "../node/CanvasStrip";
import type { PingLossBandRow } from "./PingLossBands";

export function pingLossAxisMax(rows: PingLossBandRow[]) {
  let max = 0;
  for (const row of rows) for (const bucket of row.buckets) {
    if (bucket.loss != null && Number.isFinite(bucket.loss)) max = Math.max(max, bucket.loss);
  }
  return [1, 2, 5, 10, 20, 50, 100].find((limit) => limit >= max * 1.1) ?? 100;
}

/** Draw original, weighted loss buckets behind latency lines in the same plot. */
export function pingLossBarColor(loss: number, thresholds: PingLossThresholds = DEFAULT_PING_LOSS_THRESHOLDS) {
  if (loss <= thresholds.low) return "var(--status-warning)";
  if (loss <= thresholds.medium) return "var(--speed-high)";
  return "var(--status-error)";
}

export function drawPingLossBars(plot: uPlot, rows: PingLossBandRow[], thresholds?: PingLossThresholds) {
  const ctx = plot.ctx;
  if (!ctx || !rows.length || plot.scales.loss?.max == null) return;
  const { left, top, width, height } = plot.bbox;
  const ratio = width / Math.max(1, plot.over.clientWidth);
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip();
  ctx.globalAlpha = 0.7;
  const baseline = plot.valToPos(0, "loss", true);
  const activeRows = rows.filter((row) => row.buckets.some((bucket) => bucket.loss != null && bucket.loss > 0));
  activeRows.forEach((row, taskIndex) => {
    for (const bucket of row.buckets) {
      if (bucket.loss == null || bucket.loss <= 0) continue;
      ctx.fillStyle = safeCanvasColor(pingLossBarColor(bucket.loss, thresholds));
      const start = plot.valToPos(bucket.start, "x", true);
      const end = plot.valToPos(bucket.end, "x", true);
      const slotWidth = (end - start) / activeRows.length;
      const barWidth = Math.max(ratio * 0.65, slotWidth * 0.8);
      const x = start + taskIndex * slotWidth + (slotWidth - barWidth) / 2;
      const y = plot.valToPos(bucket.loss, "loss", true);
      ctx.fillRect(x, y, barWidth, baseline - y);
    }
  });
  ctx.restore();
}
