import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { usePreferences } from "@/hooks/usePreferences";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useTranslate } from "@/i18n";
import type { HomepagePingDisplayLine, PingOverviewBucket } from "@/types/theme";
import { resolveCustomLatencyColor, resolveCustomLossColor } from "@/utils/metricTone";
import { clsx } from "clsx";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { LatencyBars } from "./LatencyBars";
import { LatencyCurve, type LatencyCurveInspection } from "./LatencyCurve";
import { QualityBars } from "./QualityBars";
import { formatHealthBucketTooltip, formatLatencyBucketSummary, formatPingBucketWindow } from "./pingBucketText";
import { curveInspectionIndex } from "./curveInspection";

type MultiPingStatusDensity = "large" | "compact";
type MultiPingMetric = "latency" | "loss";

const MultiPingMetricRow = memo(function MultiPingMetricRow({
  line,
  metric,
  density,
  redrawKey,
}: {
  line: HomepagePingDisplayLine;
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  const t = useTranslate();
  const themeSettings = useThemeSettings();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const latencyColor = resolveCustomLatencyColor(
    line.lastValue,
    themeSettings.pingLatencyThresholds,
    themeSettings.pingLatencyColors,
  );
  const lossColor = resolveCustomLossColor(
    line.loss,
    themeSettings.pingLossThresholds,
    themeSettings.pingLossColors,
  );
  const isLoading = line.loadState === "pending";
  const isError = line.loadState === "error";
  const staleError = isError && (line.lastValue != null || line.loss != null);
  const latencyLabel =
    isLoading && line.lastValue == null
      ? t("加载中")
      : isError && line.lastValue == null
        ? t("加载失败")
        : line.lastValue == null
          ? t("无样本")
          : `${Math.round(line.lastValue)}ms`;
  const lossLabel =
    isLoading && line.loss == null
      ? t("加载中")
      : isError && line.loss == null
        ? t("加载失败")
        : line.loss == null
          ? "—"
          : `${line.loss.toFixed(1)}%`;
  const hoveredBucket =
    hoveredIndex == null ? null : (line.buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, metric)
    : null;
  const chartHeight = density === "compact" ? 9 : 11;
  const value = metric === "latency" ? line.lastValue : line.loss;
  const valueColor = metric === "latency" ? latencyColor : lossColor;
  const unit = metric === "latency" ? "ms" : "%";
  const waiting = isLoading && value == null;
  const displayValue =
    waiting
      ? "..."
      : isError && value == null
        ? "!"
        : value == null
          ? "—"
          : metric === "latency"
            ? Math.round(value)
            : value.toFixed(1);
  return (
    <div
      className="multi-ping-metric-row"
      data-load-state={line.loadState ?? "ready"}
      title={t("{0} · 延迟 {1} · 丢包 {2}{3}", [line.taskName, latencyLabel, lossLabel, staleError ? t(" · 刷新失败，显示上次数据") : ""])}
    >
      <div
        className={clsx(
          "multi-ping-metric-head",
          metric === "loss" && "is-value-only",
        )}
      >
        {metric === "latency" && (
          <span className="multi-ping-name">{line.taskName}</span>
        )}
        <strong
          className="multi-ping-value tabular"
          style={{
            color: value == null ? "var(--text-tertiary)" : valueColor,
          }}
        >
          {displayValue}
          {value != null && <small>{unit}</small>}
        </strong>
      </div>
      <span className="multi-ping-buckets" title="">
        {metric === "latency" ? (
          <LatencyBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        ) : (
          <QualityBars
            buckets={line.buckets}
            redrawKey={redrawKey}
            height={chartHeight}
            onHoverIndex={setHoveredIndex}
          />
        )}
        <HealthBucketTooltip
          text={tooltip}
          index={hoveredIndex}
          count={line.buckets.length}
        />
      </span>
    </div>
  );
});

const MultiPingMetricColumn = memo(function MultiPingMetricColumn({
  lines,
  metric,
  density,
  redrawKey,
}: {
  lines: HomepagePingDisplayLine[];
  metric: MultiPingMetric;
  density: MultiPingStatusDensity;
  redrawKey: string;
}) {
  const t = useTranslate();
  return (
    <div
      className="multi-ping-metric-column"
      aria-label={metric === "latency" ? t("延迟") : t("丢包")}
    >
      {lines.map((line) => (
        <MultiPingMetricRow
          key={line.taskId}
          line={line}
          metric={metric}
          density={density}
          redrawKey={redrawKey}
        />
      ))}
    </div>
  );
});

const MultiPingCurveRow = memo(function MultiPingCurveRow({ line, inspection }: { line: HomepagePingDisplayLine; inspection: LatencyCurveInspection }) {
  const t = useTranslate();
  const settings = useThemeSettings();
  const latencyColor = resolveCustomLatencyColor(line.lastValue, settings.pingLatencyThresholds, settings.pingLatencyColors);
  const lossColor = resolveCustomLossColor(line.loss, settings.pingLossThresholds, settings.pingLossColors);
  const empty = line.loadState === "pending" ? "..." : line.loadState === "error" ? "!" : "—";
  return (
    <div className="multi-ping-curve-row" data-load-state={line.loadState ?? "ready"}
      title={line.loadState === "error" ? (line.lastValue != null || line.loss != null ? t("首页 Ping 刷新失败，显示上次数据") : t("加载失败")) : line.loadState === "pending" ? t("加载中") : undefined}>
      <span className="multi-ping-name" title={line.taskName}>
        <i className="multi-ping-curve-dot" style={{ background: latencyColor }} aria-hidden />{line.taskName}
      </span>
      <strong className="multi-ping-value tabular" style={{ color: line.lastValue == null ? "var(--text-tertiary)" : latencyColor }}>
        {line.lastValue == null ? empty : Math.round(line.lastValue)}{line.lastValue != null && <small>ms</small>}
      </strong>
      <LatencyCurve buckets={line.buckets} color={latencyColor} label={line.taskName} inspection={inspection} />
      <span className="multi-ping-curve-loss">
        <span>{t("丢包")}</span>
        <strong className="multi-ping-value tabular" style={{ color: line.loss == null ? "var(--text-tertiary)" : lossColor }}>{line.loss == null ? empty : `${line.loss.toFixed(1)}%`}</strong>
      </span>
    </div>
  );
});

function MultiPingCurves({ lines }: { lines: HomepagePingDisplayLine[] }) {
  const t = useTranslate();
  const settings = useThemeSettings();
  const containerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ taskId: number; index: number } | null>(null);
  const select = useCallback((taskId: number, index: number | null) => {
    setSelection((previous) => index == null ? null : previous?.taskId === taskId && previous.index === index ? previous : { taskId, index });
  }, []);
  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setSelection(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [selection]);
  const source = selection ? lines.find((line) => line.taskId === selection.taskId) : null;
  const sourceBucket = selection ? source?.buckets[selection.index] : null;
  const fraction = source && sourceBucket && selection ? (selection.index + 0.5) / source.buckets.length : null;
  const time = sourceBucket?.startAt != null && sourceBucket.endAt != null ? (sourceBucket.startAt + sourceBucket.endAt) / 2 : null;
  const inspected = lines.map((line) => {
    const index = fraction == null ? null : curveInspectionIndex(line.buckets, time, fraction);
    return { line, index, bucket: index == null ? null : line.buckets[index] };
  });
  const lossValue = (bucket: PingOverviewBucket | null) => bucket && bucket.total > 0 && bucket.loss != null ? `${bucket.loss.toFixed(1)}%` : t("无样本");
  return (
    <div ref={containerRef} className="multi-ping-curves"
      onPointerLeave={(event) => { if (event.pointerType !== "touch") setSelection(null); }}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSelection(null); }}>
      {inspected.map(({ line, index }) => <MultiPingCurveRow key={line.taskId} line={line}
        inspection={{ index, fraction, onIndexChange: (next) => select(line.taskId, next) }} />)}
      {fraction != null && <div className="multi-ping-curves-tooltip" role="status" aria-label={t("同一时段各线路延迟与丢包")}>
        <div className="multi-ping-curves-tooltip-time">{formatPingBucketWindow(sourceBucket ?? null) ?? t("同一时段各线路延迟与丢包")}</div>
        <ul className="multi-ping-curves-tooltip-list">
          {inspected.map(({ line, bucket }) => <li className="multi-ping-curves-tooltip-row" key={line.taskId}>
            <span className="multi-ping-curves-tooltip-name"><i aria-hidden style={{ background: resolveCustomLatencyColor(bucket?.value, settings.pingLatencyThresholds, settings.pingLatencyColors) }} />{line.taskName}</span>{" "}
            <strong className="tabular">{bucket ? formatLatencyBucketSummary(bucket) : t("无样本")} ({lossValue(bucket)})</strong>
          </li>)}
        </ul>
      </div>}
    </div>
  );
}

export const MultiPingStatus = memo(function MultiPingStatus({
  lines,
  density,
  className,
}: {
  lines: HomepagePingDisplayLine[];
  density: MultiPingStatusDensity;
  className?: string;
}) {
  const t = useTranslate();
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const { homepageLatencyDisplay } = useThemeSettings();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;

  return (
    <div
      className={clsx("multi-ping-status", `is-${density}`, className)}
      role="group"
      aria-label={t("多线路延迟与丢包")}
    >
      {homepageLatencyDisplay === "curve" ? (
        <MultiPingCurves lines={lines} />
      ) : <div className="multi-ping-columns">
        <MultiPingMetricColumn
          lines={lines}
          metric="latency"
          density={density}
          redrawKey={redrawKey}
        />
        <MultiPingMetricColumn
          lines={lines}
          metric="loss"
          density={density}
          redrawKey={redrawKey}
        />
      </div>}
    </div>
  );
});
