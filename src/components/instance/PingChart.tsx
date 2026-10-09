import { resolvePingYRange } from "./pingChartScale";
import { PingLossBands, type PingPlotGeometry, type PingLossBandHover, type PingLossBandRow } from "./PingLossBands";
import { buildLossBandBuckets, indexPingLossSamples, pingLossAtTime, formatLossBandValue } from "./lossBandData";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import UplotReact from "uplot-react";
import type uPlot from "uplot";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { usePingRecords } from "@/hooks/useRecords";
import { InstancePanel, InstanceChartLoading } from "./InstancePanel";
import {
  buildChartTooltipHooks,
  colorForSeries,
  createTimeAxisFormatter,
  formatTooltipTime,
  getAxisColors,
  toChartSeconds,
  useResponsiveChartSize,
  type ChartTooltipState,
} from "./chartShared";
import { ChartTooltip, SwitchToggle } from "./ChartParts";
import {
  cutPeakValues,
  detectTypicalIntervalSeconds,
  downsampleAligned,
  insertMetricGapSentinels,
  smoothByCount,
} from "./chartData";
import { latencyHeatColor, lossHeatColor } from "@/utils/metricTone";
import { historyChartRangeSeconds, historyCoverageLabel } from "@/utils/historyRange";
import { resolvePingChartInterval, resolvePingSampleCounts } from "@/utils/pingMetrics";
import { usePreferences } from "@/hooks/usePreferences";
import type { PingRecord, PingTaskStats } from "@/types/komari";
import type { TimedMetricPoint } from "./chartData";

interface WeightedLatency {
  value: number;
  weight: number;
}

function valueAtWeightedIndex(sorted: WeightedLatency[], index: number) {
  let offset = 0;
  for (const sample of sorted) {
    offset += sample.weight;
    if (index < offset) return sample.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

function percentileFromWeighted(sorted: WeightedLatency[], ratio: number) {
  const total = sorted.reduce((sum, sample) => sum + sample.weight, 0);
  if (total <= 0) return null;
  const index = (total - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const lowerValue = valueAtWeightedIndex(sorted, lower);
  const upperValue = valueAtWeightedIndex(sorted, upper);
  if (lowerValue == null || upperValue == null) return null;
  if (lower === upper) return lowerValue;
  const weight = index - lower;
  return lowerValue + (upperValue - lowerValue) * weight;
}

export function summarizePingRecords(records: PingRecord[]) {
  const samples = records.map((record) => ({
    record,
    ...resolvePingSampleCounts(record),
  }));
  const valid = samples
    .filter(({ record, valid: count }) => record.value >= 0 && count > 0)
    .map(({ record, valid: count }) => ({ value: record.value, weight: count }))
    .sort((a, b) => a.value - b.value);
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const lost = samples.reduce((sum, sample) => sum + sample.lost, 0);
  const validCount = valid.reduce((sum, sample) => sum + sample.weight, 0);

  let latest: number | null = null;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const { record, valid: count } = samples[index];
    if (record.value >= 0 && count > 0) {
      latest = record.value;
      break;
    }
  }

  return {
    latest,
    avg:
      validCount > 0
        ? valid.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / validCount
        : null,
    min: valid[0]?.value ?? null,
    max: valid[valid.length - 1]?.value ?? null,
    p50: percentileFromWeighted(valid, 0.5),
    p99: percentileFromWeighted(valid, 0.99),
    total,
    lost,
    loss: total > 0 ? (lost / total) * 100 : 0,
  };
}

const EMPTY_PING_STATS: PingTaskStats[] = [];
const MAX_RENDER_POINTS = 160;
// 1 即关闭平滑(smoothByCount 对 <=1 原样返回);保留常量便于调参,非削峰模式当前不平滑。
const SMOOTH_WINDOW_POINTS = 1;
const SMOOTH_WINDOW_POINTS_PEAK = 13;

export function PingChart({
  uuid,
  hours,
  active = true,
}: {
  uuid: string;
  hours: number;
  active?: boolean;
}) {
  const {
    data,
    isError,
    isFetching,
    isLoading,
    refetch: refetchRecords,
  } = usePingRecords(uuid, hours, active);
  // stats 随 records 同一次请求返回(getPingRecords includeStats),不再单独发起查询。
  const pingStats = data?.stats ?? EMPTY_PING_STATS;
  const { resolvedAppearance } = usePreferences();
  const { w, h, ref: chartSizeRef } = useResponsiveChartSize("wide");
  const [hiddenTasks, setHiddenTasks] = useState<Set<number>>(new Set());
  const hiddenTasksRef = useRef(hiddenTasks);
  const plotRef = useRef<uPlot | null>(null);
  const [connectNulls, setConnectNulls] = useState(false);
  const [cutPeak, setCutPeak] = useState(false);
  const [showLossBands, setShowLossBands] = useState(() => {
    try { return localStorage.getItem("monitor-sao:show-loss-bands") !== "false"; } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("monitor-sao:show-loss-bands", String(showLossBands)); } catch { /* 访客偏好兜底 */ }
  }, [showLossBands]);
  const chartRef = useRef<uPlot.AlignedData>([[]]);
  const hoverAreaRef = useRef<HTMLDivElement>(null);
  const cursorExtensionRef = useRef<HTMLDivElement>(null);
  const showLossBandsRef = useRef(showLossBands);
  const [bandTooltip, setBandTooltip] = useState<ChartTooltipState | null>(null);
  const syncCursorExtension = useCallback((plot: uPlot) => {
    const line = cursorExtensionRef.current;
    const area = hoverAreaRef.current;
    const firstRow = area?.querySelector(".instance-ping-loss-band-row");
    const left = plot.cursor.left;
    if (!line || !area) return;
    line.hidden = !showLossBandsRef.current || !firstRow || left == null || left < 0 || left > plot.over.clientWidth || plot.cursor.idx == null;
    if (line.hidden || !firstRow || left == null) return;
    const areaRect = area.getBoundingClientRect();
    const rowRect = firstRow.getBoundingClientRect();
    const plotRect = plot.over.getBoundingClientRect();
    line.style.left = `${plotRect.left - areaRect.left + Math.round(left)}px`;
    line.style.top = `${rowRect.top - areaRect.top}px`;
    line.style.height = `${Math.max(0, plotRect.top - rowRect.top)}px`;
  }, []);
  const [plotGeometry, setPlotGeometry] = useState<PingPlotGeometry | null>(null);
  const syncPlotGeometry = useCallback((plot: uPlot) => {
    const ratio = plot.bbox.width / Math.max(1, plot.over.clientWidth);
    const start = plot.scales.x.min;
    const end = plot.scales.x.max;
    if (start == null || end == null || end <= start || !Number.isFinite(ratio) || ratio <= 0) return;
    const next = { left: plot.bbox.left / ratio, width: plot.bbox.width / ratio, start, end };
    setPlotGeometry((prev) => prev && prev.left === next.left && prev.width === next.width && prev.start === start && prev.end === end ? prev : next);
  }, []);
  const [tooltip, setTooltip] = useState<ChartTooltipState>({
    show: false,
    left: 0,
    top: 0,
    rows: [],
    time: "",
  });
  const isDark = resolvedAppearance === "dark";
  // API 顺序与后台任务权重一致，响应本身不一定包含可重排的权重。
  const tasks = useMemo(() => [...(data?.tasks ?? [])], [data]);
  const taskLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      const label = task.name || `任务 #${task.id}`;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return new Map(
      tasks.map((task) => {
        const baseLabel = task.name || `任务 #${task.id}`;
        const label = (counts.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${task.id}` : baseLabel;
        return [task.id, label] as const;
      }),
    );
  }, [tasks]);
  const taskColors = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, colorForSeries(index, tasks.length)] as const)),
    [tasks],
  );
  const taskKeySet = useMemo(() => new Set(tasks.map((task) => String(task.id))), [tasks]);
  const taskKeys = useMemo(() => tasks.map((task) => String(task.id)), [tasks]);
  const taskIndexById = useMemo(
    () => new Map(tasks.map((task, index) => [task.id, index] as const)),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => tasks.filter((task) => !hiddenTasks.has(task.id)),
    [hiddenTasks, tasks],
  );
  const visibleTasksRef = useRef(visibleTasks);
  const lossSamples = useMemo(() => indexPingLossSamples(data?.records ?? [], new Map(tasks.map((task) => [task.id,
    resolvePingChartInterval(data?.intervalSeconds, task.interval)]))), [data, tasks]);
  const lossRows = useMemo<PingLossBandRow[]>(() => {
    if (!plotGeometry) return [];
    const grouped = new Map<number, PingRecord[]>();
    for (const record of data?.records ?? []) {
      const group = grouped.get(record.task_id) ?? [];
      group.push(record); grouped.set(record.task_id, group);
    }
    return visibleTasks.map((task) => ({ taskId: task.id, label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
      color: taskColors.get(task.id) ?? "var(--text-secondary)",
      buckets: buildLossBandBuckets(grouped.get(task.id) ?? [], plotGeometry.start, plotGeometry.end,
        resolvePingChartInterval(data?.intervalSeconds, task.interval), Math.max(60, Math.round(plotGeometry.width / 4))) }));
  }, [data, plotGeometry, visibleTasks, taskLabels, taskColors]);
  useLayoutEffect(() => {
    hiddenTasksRef.current = hiddenTasks;
    visibleTasksRef.current = visibleTasks;
    showLossBandsRef.current = showLossBands;
    setBandTooltip(null);
    if (plotRef.current) syncCursorExtension(plotRef.current);
  }, [hiddenTasks, visibleTasks, showLossBands, lossRows, syncCursorExtension]);
  const leaveBand = useCallback(() => {
    setBandTooltip(null);
    plotRef.current?.setCursor({ left: -10, top: -10 });
  }, []);
  const hoverBand = useCallback(({ row, bucket, fraction, clientY }: PingLossBandHover) => {
    const area = hoverAreaRef.current;
    const plot = plotRef.current;
    if (!area || !plot) return;
    const bounds = area.getBoundingClientRect();
    const plotBounds = plot.over.getBoundingClientRect();
    const left = fraction * plot.over.clientWidth;
    // 只移动 DOM 游标/提示；不更新 data、options、series 或 scale。
    plot.setCursor({ left, top: plot.cursor.top != null && plot.cursor.top >= 0 ? plot.cursor.top : plot.over.clientHeight / 2 });
    const x = plotBounds.left - bounds.left + left;
    const width = Math.min(300, bounds.width - 20);
    setBandTooltip({ show: true, left: Math.max(10, Math.min(bounds.width - width - 10, x + 18)),
      top: Math.max(0, clientY - bounds.top + 12),
      time: `${formatTooltipTime(bucket.start, hours)} — ${formatTooltipTime(bucket.end, hours)}`,
      rows: [{ label: row.label, value: formatLossBandValue(bucket.loss), color: row.color }] });
  }, [hours]);
  const displayedTooltip = useMemo(() => ({ ...tooltip, rows: tooltip.rows.map((row) => ({ ...row,
    detail: showLossBands && row.taskId != null && tooltip.timestamp != null
      ? formatLossBandValue(pingLossAtTime(lossSamples.get(row.taskId) ?? [], tooltip.timestamp)) : undefined,
  })) }), [tooltip, showLossBands, lossSamples]);
  const onPlotCreate = useCallback((plot: uPlot) => {
    plotRef.current = plot;
    plot.batch(() => {
      tasks.forEach((task, index) => plot.setSeries(index + 1, { show: !hiddenTasksRef.current.has(task.id) }));
      const [min, max] = resolvePingYRange(chartRef.current, tasks.map((task) => task.id), hiddenTasksRef.current);
      plot.setScale("y", { min, max });
    });
  }, [tasks]);
  const onPlotDelete = useCallback((plot: uPlot) => {
    if (plotRef.current === plot) {
      plotRef.current = null;
      if (cursorExtensionRef.current) cursorExtensionRef.current.hidden = true;
    }
  }, []);
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    plot.batch(() => {
      tasks.forEach((task, index) => {
        const show = !hiddenTasks.has(task.id);
        if (plot.series[index + 1]?.show !== show) plot.setSeries(index + 1, { show });
      });
      const [min, max] = resolvePingYRange(chartRef.current, tasks.map((task) => task.id), hiddenTasks);
      if (plot.scales.y.min !== min || plot.scales.y.max !== max) plot.setScale("y", { min, max });
    });
  }, [hiddenTasks, tasks]);

  useEffect(() => {
    setHiddenTasks(new Set());
  }, [uuid]);

  useEffect(() => {
    setHiddenTasks((prev) => {
      const validTaskIds = new Set(tasks.map((task) => task.id));
      const next = new Set([...prev].filter((taskId) => validTaskIds.has(taskId)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  // 只依赖 data:切换削峰等开关时不重跑解析/排序。
  const sortedRecords = useMemo(
    () =>
      (data?.records ?? [])
        .map((record) => ({
          record,
          time: toChartSeconds(record.time),
        }))
        .filter(({ time }) => time > 0)
        .sort((left, right) => left.time - right.time),
    [data],
  );

  const chart = useMemo(() => {
    if (!data?.records.length || !tasks.length) return null;
    const pointMap = new Map<number, TimedMetricPoint>();
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value): value is number => typeof value === "number" && value > 0);
    const detectedInterval = detectTypicalIntervalSeconds(
      sortedRecords.map(({ time }) => time),
      60,
    );
    const fallbackInterval = resolvePingChartInterval(
      data.intervalSeconds,
      taskIntervals.length > 0 ? Math.min(...taskIntervals) : null,
      detectedInterval,
    );
    const tolerance = Math.min(6, Math.max(0.8, fallbackInterval * 0.25));

    // 升序游标把邻近任务采样合并到同一时间锚点，保持 O(n)。
    let lastAnchor = Number.NEGATIVE_INFINITY;
    for (const { record, time } of sortedRecords) {
      if (!taskKeySet.has(String(record.task_id))) continue;
      const anchor = time - lastAnchor <= tolerance ? lastAnchor : time;
      if (anchor === time) lastAnchor = time;
      const current = pointMap.get(anchor) ?? { time: anchor };
      // 0 是亚毫秒成功，负值才表示丢包。
      current[String(record.task_id)] = record.value >= 0 ? record.value : null;
      pointMap.set(anchor, current);
    }

    let chartPoints = [...pointMap.values()].sort((a, b) => a.time - b.time);
    if (cutPeak && taskKeys.length > 0) {
      chartPoints = cutPeakValues(chartPoints, taskKeys);
    }
    chartPoints = insertMetricGapSentinels(chartPoints, {
      intervals: new Map(
        tasks.map((task) => [
          String(task.id),
          resolvePingChartInterval(data.intervalSeconds, task.interval, fallbackInterval),
        ] as const),
      ),
      defaultInterval: fallbackInterval,
      matchToleranceRatio: 0.25,
    });
    const times = chartPoints.map((point) => point.time);
    // undefined 表示错相采样，null 表示真实断点。
    const perTask = taskKeys.map((taskKey) =>
      chartPoints.map((point) => point[taskKey]),
    );

    const reduced = downsampleAligned(times, perTask, MAX_RENDER_POINTS, !cutPeak);
    const smoothed = smoothByCount(
      reduced.perTask,
      cutPeak ? SMOOTH_WINDOW_POINTS_PEAK : SMOOTH_WINDOW_POINTS,
    );

    return [reduced.times, ...smoothed] as uPlot.AlignedData;
  }, [cutPeak, data, sortedRecords, taskKeySet, taskKeys, tasks]);

  useLayoutEffect(() => {
    if (chart) chartRef.current = chart;
  }, [chart]);

  const requestedXRange = useMemo(() => historyChartRangeSeconds(data), [data]);
  const coverageMeta = useMemo(() => {
    if (!data) return null;
    const taskIntervals = tasks
      .map((task) => task.interval)
      .filter((value) => Number.isFinite(value) && value > 0);
    return {
      rangeStartMs: data.rangeStartMs,
      rangeEndMs: data.rangeEndMs,
      intervalSeconds:
        data.intervalSeconds ??
        (taskIntervals.length > 0 ? Math.min(...taskIntervals) : undefined),
    };
  }, [data, tasks]);
  const coverageLabel = useMemo(() => {
    const times = chart?.[0];
    if (!times?.length) return null;
    return historyCoverageLabel(coverageMeta, times[0], times[times.length - 1]);
  }, [chart, coverageMeta]);

  const yRange = useMemo<[number, number]>(() => chart
    ? resolvePingYRange(chart, tasks.map((task) => task.id), new Set()) : [0, 100], [chart, tasks]);

  const baseOptions = useMemo<Omit<uPlot.Options, "width" | "height"> | null>(() => {
    if (!chart) return null;
    const { grid, text } = getAxisColors(isDark);
    const tooltipHooks = buildChartTooltipHooks({
      dataRef: chartRef,
      rangeHours: hours,
      estimatedWidth: 300,
      setTooltip,
      buildRows: (idx) =>
        visibleTasksRef.current
          .map((task) => {
            const taskIndex = taskIndexById.get(task.id) ?? 0;
            const raw = chartRef.current[taskIndex + 1]?.[idx] as number | null | undefined;
            return {
              taskId: task.id,
              label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
              raw: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
              color: taskColors.get(task.id) ?? colorForSeries(taskIndex, tasks.length),
            };
          })
          .sort((a, b) => {
            if (a.raw == null) return b.raw == null ? 0 : 1;
            if (b.raw == null) return -1;
            return b.raw - a.raw;
          })
          .map(({ label, raw, color, taskId }) => ({
            taskId,
            label,
            value: raw == null ? "—" : `${raw.toFixed(1)} ms`,
            color,
          })),
    });
    return {
      padding: [10, 14, 12, 2],
      cursor: { drag: { x: true, y: false } },
      legend: { show: false },
      scales: {
        x: requestedXRange
          ? { time: true, auto: false, range: () => requestedXRange }
          : { time: true },
        y: { auto: false, range: yRange },
      },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 36,
          values: createTimeAxisFormatter(hours),
        },
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 54,
          values: (_self, splits) => splits.map((value) => (value === 0 ? "" : `${Math.round(value)} ms`)),
        },
      ],
      series: [
        { label: "time" },
        ...tasks.map((task, index) => ({
          label: taskLabels.get(task.id) ?? `任务 #${task.id}`,
          stroke: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
          width: 1.7,
          spanGaps: connectNulls,
          show: true,
          points: { show: false },
        })),
      ],
      hooks: {
        ready: [syncPlotGeometry],
        setSize: [syncPlotGeometry],
        setScale: [syncPlotGeometry],
        init: [
          (u) => {
            u.root.setAttribute("role", "img");
            u.root.setAttribute("aria-label", `Ping 延迟历史图表，共 ${tasks.length} 条线路`);
          },
          tooltipHooks.onInit,
        ],
        destroy: [tooltipHooks.onDestroy],
        setCursor: [tooltipHooks.onSetCursor, syncCursorExtension],
      },
    };
  }, [chart, connectNulls, hours, isDark, syncPlotGeometry, syncCursorExtension, requestedXRange, taskColors, taskIndexById, taskLabels, tasks, yRange]);

  const options = useMemo<uPlot.Options | null>(
    () => (baseOptions ? { ...baseOptions, width: w, height: h } : null),
    [baseOptions, w, h],
  );

  const taskStats = useMemo(() => {
    const grouped = new Map<number, PingRecord[]>();
    // 复用已按时间升序的 sortedRecords,分组后桶内天然有序,免去逐桶重排序和重复 Date.parse。
    for (const { record } of sortedRecords) {
      const bucket = grouped.get(record.task_id);
      if (bucket) bucket.push(record);
      else grouped.set(record.task_id, [record]);
    }

    const serverStats = new Map(
      pingStats
        .filter((stat) => !stat.client || stat.client === uuid)
        .map((stat) => [stat.taskId, stat] as const),
    );

    return tasks.map((task, index) => {
      const records = grouped.get(task.id) ?? [];
      const server = serverStats.get(task.id);
      // server stats 命中时跳过本地全量统计(排序/分位数不便宜)。
      const fallback = server ? null : summarizePingRecords(records);
      const latest = server ? server.latest : fallback?.latest ?? null;
      const avg = server ? server.avg : fallback?.avg ?? null;
      const min = server ? server.min : fallback?.min ?? null;
      const max = server ? server.max : fallback?.max ?? null;
      const p50 = server ? server.p50 : fallback?.p50 ?? null;
      const p99 = server ? server.p99 : fallback?.p99 ?? null;
      const fallbackVolatility =
        p50 != null && p99 != null
          ? Math.max(0, p99 - p50) / Math.min(50, Math.max(10, p50))
          : null;
      const volatility =
        server && Number.isFinite(server.p99P50Ratio)
          ? server.p99P50Ratio
          : fallbackVolatility;
      const total = server?.total ?? fallback?.total ?? 0;
      const lost = server
        ? Math.max(0, server.total - server.valid)
        : fallback?.lost ?? 0;
      const loss = server?.loss ?? (total > 0 ? fallback?.loss ?? 0 : task.loss);
      return {
        ...task,
        latest,
        avg,
        min,
        max,
        p50,
        p99,
        volatility,
        total,
        lost,
        loss,
        color: taskColors.get(task.id) ?? colorForSeries(index, tasks.length),
      };
    });
  }, [pingStats, sortedRecords, taskColors, tasks, uuid]);

  const refetchAll = () => {
    void refetchRecords();
  };

  const toggleTask = (taskId: number) => {
    setHiddenTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const toggleAll = () => {
    setHiddenTasks((prev) => (prev.size === 0 ? new Set(tasks.map((task) => task.id)) : new Set()));
  };

  if (isLoading) {
    return <InstanceChartLoading title="Ping 图表" />;
  }

  if (isError && !data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">
          <span>延迟历史加载失败</span>
          <button
            type="button"
            className="instance-toggle-button"
            onClick={refetchAll}
            disabled={isFetching}
            aria-busy={isFetching}
          >
            {isFetching ? "重试中" : "重试"}
          </button>
        </div>
      </InstancePanel>
    );
  }

  if (!data?.records.length) {
    return (
      <InstancePanel title="Ping 图表">
        <div className="instance-empty">暂无延迟记录</div>
      </InstancePanel>
    );
  }

  return (
    <InstancePanel title="Ping 图表" description={coverageLabel ?? undefined}>
      <div className="instance-ping-toolbar">
        <SwitchToggle label="丢包色带" active={showLossBands} onToggle={() => setShowLossBands((value) => !value)}
          title="按各线路原始返回桶显示丢包率：绿 0%、黄绿 <5%、黄 <20%、橙 <50%、红 <100%、深红 100%；灰色表示未采样。色带与时间轴对齐，不受削峰平滑或断点连线影响。" />
        <SwitchToggle
          label="削峰平滑"
          active={cutPeak}
          onToggle={() => setCutPeak((value) => !value)}
          title="对尖峰值做轻度平滑，仅影响图线显示"
        />
        <SwitchToggle
          label="断点连线"
          active={connectNulls}
          onToggle={() => setConnectNulls((value) => !value)}
          title="关闭：如实显示中断/丢包断点；开启：跨过所有空缺连成完整曲线（更好看，但看不出掉线）。注：偶尔漏一两次采样的小空缺始终自动桥接，不受此开关影响。"
        />
        <button type="button" className="instance-toggle-button" onClick={toggleAll}>
          {hiddenTasks.size === 0 ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          {hiddenTasks.size === 0 ? "隐藏全部" : "显示全部"}
        </button>
        <button
          type="button"
          className="instance-toggle-button"
          onClick={refetchAll}
          disabled={isFetching}
          aria-busy={isFetching}
        >
          <RefreshCw size={14} aria-hidden />
          {isFetching ? "刷新中" : isError ? "刷新失败，重试" : "刷新"}
        </button>
      </div>

      <div className="instance-ping-tasks">
        {taskStats.map((task) => {
          const visible = !hiddenTasks.has(task.id);
          return (
            <button
              key={task.id}
              type="button"
              className="instance-ping-task"
              data-visible={visible ? "true" : "false"}
              aria-pressed={visible}
              onClick={() => toggleTask(task.id)}
              style={{ borderColor: visible ? task.color : "var(--border-subtle)" }}
              title={[
                taskLabels.get(task.id) ?? `任务 #${task.id}`,
                `当前 ${task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"} | 均值 ${task.avg != null ? `${task.avg.toFixed(1)} ms` : "—"} | 丢包 ${task.loss.toFixed(1)}%`,
                `p99 ${task.p99 != null ? `${task.p99.toFixed(0)} ms` : "—"} | 抖动 ${task.volatility != null ? task.volatility.toFixed(2) : "—"}`,
                `min ${task.min != null ? `${task.min.toFixed(0)} ms` : "—"} | max ${task.max != null ? `${task.max.toFixed(0)} ms` : "—"} | 样本 ${task.total ?? 0} | 间隔 ${task.interval}s`,
              ].join("\n")}
            >
              <span className="instance-ping-task-dot" style={{ background: task.color }} aria-hidden />
              <span className="instance-ping-task-name">{taskLabels.get(task.id) ?? `任务 #${task.id}`}</span>
              <span
                className="instance-ping-task-primary"
                style={{
                  color:
                    task.latest != null
                      ? latencyHeatColor(task.latest)
                      : "var(--text-tertiary)",
                }}
              >
                {task.latest != null ? `${task.latest.toFixed(1)} ms` : "—"}
              </span>
              <span
                className="instance-ping-task-loss"
                style={{ color: lossHeatColor(task.loss) }}
              >
                {task.loss.toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>

      <div ref={hoverAreaRef} className="instance-ping-hover-area" data-band-hover={bandTooltip ? "true" : "false"}>
        <PingLossBands visible={showLossBands} rows={lossRows} geometry={plotGeometry} onHover={hoverBand} onLeave={leaveBand} />
        <div ref={cursorExtensionRef} className="instance-ping-cursor-extension" hidden aria-hidden="true" />
        {bandTooltip && <ChartTooltip tooltip={bandTooltip} />}
        <div ref={chartSizeRef} className="instance-uplot-wrap is-large" onPointerMove={() => setBandTooltip(null)}>
          {chart && options ? (
            <>
              <UplotReact
                key={`${uuid}-${hours}-${cutPeak ? "smooth" : "raw"}-${connectNulls ? "span" : "gap"}`}
                options={options}
                data={chart}
                onCreate={onPlotCreate}
                onDelete={onPlotDelete}
              />
              <ChartTooltip tooltip={visibleTasks.length && !bandTooltip ? displayedTooltip : { ...displayedTooltip, show: false }} />
              {visibleTasks.length === 0 && <div className="instance-ping-all-hidden">当前已隐藏全部线路，点击上方按钮可恢复显示</div>}
            </>
          ) : (
            <div className="instance-empty">当前已隐藏全部线路，点击上方按钮可恢复显示</div>
          )}
        </div>
      </div>
    </InstancePanel>
  );
}
