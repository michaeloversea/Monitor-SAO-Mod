import type uPlot from "uplot";

/** 按当前可见线路计算纵轴；横轴缩放与图表实例保持不变。 */
export function resolvePingYRange(chart: uPlot.AlignedData, taskIds: readonly number[], hidden: ReadonlySet<number>): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  taskIds.forEach((id, index) => {
    if (hidden.has(id)) return;
    for (const value of chart[index + 1] ?? []) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      min = Math.min(min, value); max = Math.max(max, value);
    }
  });
  if (min === Infinity) return [0, 100];
  const pad = min === max ? Math.max(5, min * 0.1) : Math.max(5, (max - min) * 0.12);
  return [Math.max(0, min - pad), max + pad];
}
