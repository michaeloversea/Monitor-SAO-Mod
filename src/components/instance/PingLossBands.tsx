import { memo, useMemo } from "react";
import type { PingRecord, PingTask } from "@/types/komari";
import { resolvePingChartInterval } from "@/utils/pingMetrics";
import { buildLossBandBuckets, lossBandColor } from "./lossBandData";

export interface PingPlotGeometry { left: number; width: number; start: number; end: number }

/** 独立于 uPlot 的色带。hidden 仅折叠此块，曲线实例与缩放状态不受影响。 */
export const PingLossBands = memo(function PingLossBands({ visible, records, tasks, labels, intervalSeconds, geometry }: {
  visible: boolean;
  records: PingRecord[];
  tasks: PingTask[];
  labels: Map<number, string>;
  intervalSeconds?: number;
  geometry: PingPlotGeometry | null;
}) {
  const rows = useMemo(() => {
    if (!geometry) return [];
    const recordsByTask = new Map<number, PingRecord[]>();
    for (const record of records) {
      const group = recordsByTask.get(record.task_id) ?? [];
      group.push(record); recordsByTask.set(record.task_id, group);
    }
    return tasks.map((task) => ({ task, buckets: buildLossBandBuckets(recordsByTask.get(task.id) ?? [], geometry.start, geometry.end,
      resolvePingChartInterval(intervalSeconds, task.interval), Math.max(60, Math.round(geometry.width / 4))) }));
  }, [records, tasks, intervalSeconds, geometry]);
  return <div className="instance-ping-loss-bands" hidden={!visible || !geometry || !tasks.length} aria-label="各线路丢包色带">
    <p className="setting-hint mb-2">丢包色带：绿 0% · 黄绿 &lt;5% · 黄 &lt;20% · 橙 &lt;50% · 红 &lt;100% · 深红 100% · 灰色未采样（历史聚合可能平均短时峰值）</p>
    {rows.map(({ task, buckets }) => <div key={task.id} className="instance-ping-loss-band-row" style={{ marginLeft: geometry?.left, width: geometry?.width }}>
      <span className="instance-ping-loss-band-label" title={labels.get(task.id)}>{labels.get(task.id)}</span>
      <svg viewBox={`0 0 ${buckets.length} 6`} preserveAspectRatio="none" role="img" aria-label={`${labels.get(task.id)} 丢包色带`}>
        {buckets.map((bucket, index) => <rect aria-hidden="true" key={index} x={index} y={0} width={1.01} height={6} fill={lossBandColor(bucket.loss)}>
          <title>{`${new Date(bucket.start * 1000).toLocaleString("zh-CN")} — ${new Date(bucket.end * 1000).toLocaleTimeString("zh-CN")} · ${bucket.loss == null ? "未采样" : `丢包 ${bucket.loss.toFixed(2)}%`}`}</title>
        </rect>)}
      </svg>
    </div>)}
  </div>;
});
