import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useMetricColorsVersion } from "@/hooks/useMetricColors";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { usePreferences } from "@/hooks/usePreferences";
import { t, useLanguage, useTranslate } from "@/i18n";
import type { PingOverviewTaskLoadState } from "@/types/theme";
import { formatBytes } from "@/utils/format";
import { speedRateColor } from "@/utils/metricTone";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, CircleDollarSign } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { CanvasStrip, fillRoundedRect, safeCanvasColor } from "./CanvasStrip";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { LatencyBars } from "./LatencyBars";
import { MultiPingStatus } from "./MultiPingStatus";
import { formatOsLabel, joinTagTitle, nodeDetailLinkLabels } from "./nodeCardShared";
import { formatHealthBucketTooltip } from "./pingBucketText";

const GAUGE_SEGMENTS = 14;
// 列表网络列的延迟柱数:比卡片(24)少,配窄列宽,柱子仍清晰可读。
const LIST_PING_BUCKETS = 12;

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function pctText(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return value >= 10 ? Math.round(value).toString() : value.toFixed(1);
}

type ListPingState = PingOverviewTaskLoadState | "unconfigured";

export function resolveListPingState(
  loadState: PingOverviewTaskLoadState | undefined,
  hasRealHomepagePingBinding: boolean,
  pingIsAssigned: boolean,
): ListPingState {
  if (!hasRealHomepagePingBinding && !pingIsAssigned) return "unconfigured";
  return loadState ?? (pingIsAssigned ? "ready" : "pending");
}

export function formatListPingStatus(
  latency: number | null,
  state: ListPingState,
  silentLoading = false,
) {
  const roundedLatency = latency == null ? null : Math.round(latency);
  const value = roundedLatency == null ? null : t("{0} 毫秒", [roundedLatency]);
  if (value != null) {
    if (state === "error") {
      return {
        visibleText: `${roundedLatency}`,
        title: t("首页 Ping 刷新失败，显示上次数据"),
        ariaText: t("{0}，首页 Ping 刷新失败，显示上次数据", [value]),
      };
    }
    if (state === "pending") {
      return {
        visibleText: `${roundedLatency}`,
        title: t("首页 Ping 正在刷新，显示上次数据"),
        ariaText: t("{0}，首页 Ping 正在刷新，显示上次数据", [value]),
      };
    }
    return {
      visibleText: `${roundedLatency}`,
      title: `${value}`,
      ariaText: value,
    };
  }

  switch (state) {
    case "unconfigured":
      return {
        visibleText: t("未配置"),
        title: t("未配置首页 Ping"),
        ariaText: t("未配置首页 Ping"),
      };
    case "pending":
      if (silentLoading) return { visibleText: "—", title: "", ariaText: t("暂无延迟数据") };
      return {
        visibleText: t("加载中"),
        title: t("正在加载首页 Ping"),
        ariaText: t("首页 Ping 加载中"),
      };
    case "error":
      return {
        visibleText: t("加载失败"),
        title: t("首页 Ping 加载失败"),
        ariaText: t("首页 Ping 加载失败"),
      };
    default:
      return {
        visibleText: t("无样本"),
        title: t("暂无有效 Ping 样本"),
        ariaText: t("无样本"),
      };
  }
}

// 细 canvas 分段条 + 百分比,与大卡 MetricBar 同一视觉语言,但压成一格(数值在上、细条在下)。
function ListGauge({
  value,
  fraction,
  paint,
  redrawKey,
  unit = "%",
}: {
  value: string;
  fraction: number;
  paint: string;
  redrawKey: string;
  unit?: string;
}) {
  useLanguage();
  const activeSegments = clamp01(fraction) * GAUGE_SEGMENTS;
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const inactive = safeCanvasColor("var(--progress-bg)");
      const active = safeCanvasColor(paint);
      const gap = 2;
      const segWidth = Math.max(1, (width - gap * (GAUGE_SEGMENTS - 1)) / GAUGE_SEGMENTS);
      for (let i = 0; i < GAUGE_SEGMENTS; i += 1) {
        const x = i * (segWidth + gap);
        const fill = Math.max(0, Math.min(1, activeSegments - i));
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = inactive;
        fillRoundedRect(ctx, x, 0, segWidth, height, 2);
        if (fill > 0) {
          ctx.globalAlpha = 0.42 + fill * 0.56;
          ctx.fillStyle = active;
          fillRoundedRect(ctx, x, 0, segWidth, height, 2);
        }
      }
      ctx.globalAlpha = 1;
    },
    [activeSegments, paint],
  );
  return (
    <div className="node-list-gauge">
      <span className="node-list-gauge-value tabular">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <CanvasStrip className="node-list-gauge-track" height={8} redrawKey={redrawKey} draw={draw} />
    </div>
  );
}

// 一格两行的小堆叠(实时速率/在线到期共用):每行「值 + 可选单位」,可单独着色。
function StackLine({
  icon,
  value,
  unit,
  color,
}: {
  icon?: React.ReactNode;
  value: string;
  unit?: string;
  color?: string;
}) {
  useLanguage();
  return (
    <span className="node-list-line" style={color ? { color } : undefined}>
      {icon && <span className="node-list-line-icon">{icon}</span>}
      <span className="node-list-line-value tabular">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </span>
  );
}

// 网络列:当前延迟在上,聚合延迟柱状图在下(热力着色,与大卡同一视觉语言)。
function ListLatency({
  latency,
  loadState,
  hasRealHomepagePingBinding,
  pingIsAssigned,
  latencyColor,
  buckets,
  redrawKey,
  pingLoadingSilently,
}: {
  latency: number | null;
  loadState: PingOverviewTaskLoadState | undefined;
  hasRealHomepagePingBinding: boolean;
  pingIsAssigned: boolean;
  latencyColor: string;
  buckets: Parameters<typeof LatencyBars>[0]["buckets"];
  redrawKey: string;
  pingLoadingSilently?: boolean;
}) {
  const t = useTranslate();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const state = resolveListPingState(
    loadState,
    hasRealHomepagePingBinding,
    pingIsAssigned,
  );
  const status = formatListPingStatus(latency, state, pingLoadingSilently);
  const hoveredBucket = hoveredIndex == null ? null : (buckets[hoveredIndex] ?? null);
  const tooltip = hoveredBucket
    ? formatHealthBucketTooltip(hoveredBucket, "latency")
    : null;

  return (
    <div
      className="node-list-latency"
      data-ping-state={state}
      aria-label={t("网络延迟 {0}", [status.ariaText])}
    >
      <span
        className="node-list-latency-value tabular"
        style={{ color: latencyColor }}
        title={status.title}
      >
        {status.visibleText}
        {latency != null && <small>ms</small>}
      </span>
      <span className="node-list-latency-bars">
        <LatencyBars
          buckets={buckets}
          redrawKey={redrawKey}
          height={14}
          onHoverIndex={setHoveredIndex}
        />
        <HealthBucketTooltip text={tooltip} index={hoveredIndex} count={buckets.length} />
      </span>
    </div>
  );
}

const NodeRow = memo(function NodeRow({ uuid }: { uuid: string }) {
  const t = useTranslate();
  const { resolvedAppearance } = usePreferences();
  const colorsVersion = useMetricColorsVersion();
  const redrawKey = `${resolvedAppearance}:${colorsVersion}`;
  const model = useNodeCardModel(uuid, {
    pingBucketCount: LIST_PING_BUCKETS,
    includeMultiPing: true,
  });

  if (!model.node) {
    return <div className="node-list-row is-loading" aria-busy />;
  }

  const {
    node,
    traffic,
    ping,
    pingBuckets,
    homepagePingLines,
    footerTags,
    expire,
    expireColor,
    uptime,
    renewalPrice,
    latencyColor,
    hasRealHomepagePingBinding,
    pingLoadingSilently,
    loadFraction,
    upRate,
    downRate,
    isOffline,
    osName,
  } = model;
  const listPingState = resolveListPingState(
    ping.loadState,
    hasRealHomepagePingBinding,
    ping.isAssigned,
  );
  const listPingStatus = formatListPingStatus(ping.lastValue, listPingState, pingLoadingSilently);
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  const usedPct = traffic.available ? `${(clamp01(traffic.fraction) * 100).toFixed(2)}%` : t("暂无数据");
  const rowLabel = [
    node.name,
    t("系统 {0}", [formatOsLabel(osName, node.os)]),
    `CPU ${pctText(node.cpuPct)}`,
    t("内存 {0}", [pctText(node.ramPct)]),
    t("磁盘 {0}", [pctText(node.diskPct)]),
    t("负载 {0}", [node.load1.toFixed(2)]),
    t("上行 {0}{1}", [upRate.value, upRate.unit]),
    t("下行 {0}{1}", [downRate.value, downRate.unit]),
    t("流量使用 {0}", [usedPct]),
    t("网络延迟 {0}", [listPingStatus.ariaText]),
    node.online === true ? t("在线") : node.online === false ? t("离线") : t("状态未知"),
    t("运行 {0}{1}", [uptime.value, uptime.unit]),
    t("到期 {0}{1}", [expire.value, expire.unit]),
    t("查看详情"),
  ].join("，");

  return (
    <Link
      id={`node-card-${uuid}`}
      to={`/instance/${encodeURIComponent(uuid)}`}
      className={clsx("node-list-row", isOffline && "is-offline")}
      title={detailLabels.title}
      aria-label={rowLabel}
    >
      <div className="node-list-cell node-list-node">
        <div className="node-list-node-text">
          <div className="node-list-node-head">
            <Flag region={node.region} size={14} />
            <span className="node-list-name" title={node.name}>
              {node.name}
            </span>
          </div>
          {(renewalPrice || footerTags.length > 0) && (
            <div className="node-list-chips" title={footerTags.length > 0 ? joinTagTitle(footerTags) : undefined}>
              {renewalPrice && (
                <span className="dstatus-price-chip">
                  <CircleDollarSign size={12} strokeWidth={2.2} />
                  {renewalPrice}
                </span>
              )}
              {footerTags.map((tag, index) => (
                <span
                  key={`${tag.label}-${index}`}
                  className="dstatus-tag-chip"
                  data-tag={tag.color}
                  style={{ background: "var(--tag-bg)", color: "var(--tag-fg)" }}
                >
                  {tag.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="node-list-cell col-os">
        <OsLogo value={node.os} size={16} />
        <span className="node-list-os-name" title={node.os || osName}>
          {formatOsLabel(osName, node.os)}
        </span>
      </div>

      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.cpuPct)} fraction={node.cpuPct / 100} paint="var(--progress-cpu)" redrawKey={redrawKey} />
      </div>
      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.ramPct)} fraction={node.ramPct / 100} paint="var(--progress-memory)" redrawKey={redrawKey} />
      </div>
      <div className="node-list-cell col-metric">
        <ListGauge value={pctText(node.diskPct)} fraction={node.diskPct / 100} paint="var(--progress-disk)" redrawKey={redrawKey} />
      </div>

      <div className="node-list-cell col-load">
        <ListGauge
          value={node.load1.toFixed(2)}
          unit=""
          fraction={loadFraction}
          paint="var(--progress-load)"
          redrawKey={redrawKey}
        />
      </div>

      <div className="node-list-cell col-live node-list-stack">
        <StackLine
          icon={<ArrowUp size={11} strokeWidth={2.4} />}
          value={upRate.value}
          unit={upRate.unit}
          color={speedRateColor(upRate.unit)}
        />
        <StackLine
          icon={<ArrowDown size={11} strokeWidth={2.4} />}
          value={downRate.value}
          unit={downRate.unit}
          color={speedRateColor(downRate.unit)}
        />
      </div>

      <div
        className="node-list-cell col-traffic"
        title={t("剩余 {0} · {1}", [traffic.remainingLabel, traffic.detail])}
      >
        <div className="node-list-traffic-rows" title={t("累计流量")}>
          <StackLine icon={<ArrowUp size={11} strokeWidth={2.1} />} value={formatBytes(node.trafficUp)} />
          <StackLine icon={<ArrowDown size={11} strokeWidth={2.1} />} value={formatBytes(node.trafficDown)} />
        </div>
        <span className="node-list-traffic-quota" style={{ color: traffic.color }}>
          {usedPct}
        </span>
      </div>

      <div className="node-list-cell col-net">
        {homepagePingLines.length > 0 ? <MultiPingStatus lines={homepagePingLines} density="compact" /> : <ListLatency
          latency={ping.lastValue}
          loadState={ping.loadState}
          hasRealHomepagePingBinding={hasRealHomepagePingBinding}
          pingIsAssigned={ping.isAssigned}
          latencyColor={latencyColor}
          buckets={pingBuckets}
          redrawKey={redrawKey}
          pingLoadingSilently={pingLoadingSilently}
        />}
      </div>

      <div className="node-list-cell col-life node-list-stack">
        <StackLine value={uptime.value} unit={uptime.unit} color="var(--progress-cpu)" />
        <StackLine value={expire.value} unit={expire.unit} color={expireColor} />
      </div>
    </Link>
  );
});

export function NodeListView({ uuids }: { uuids: string[] }) {
  const t = useTranslate();
  return (
    <div className="node-list-scroll">
      <div className="node-list">
        <div className="node-list-row node-list-head" aria-hidden>
          <div className="node-list-cell node-list-node">{t("服务器")}</div>
          <div className="node-list-cell col-os">{t("系统")}</div>
          <div className="node-list-cell col-metric">CPU</div>
          <div className="node-list-cell col-metric">{t("内存")}</div>
          <div className="node-list-cell col-metric">{t("磁盘")}</div>
          <div className="node-list-cell col-load">{t("负载")}</div>
          <div className="node-list-cell col-live">{t("实时")}</div>
          <div className="node-list-cell col-traffic">{t("流量")}</div>
          <div className="node-list-cell col-net">{t("网络")}</div>
          <div className="node-list-cell col-life">{t("在线 / 到期")}</div>
        </div>
        {uuids.map((uuid) => (
          <NodeRow key={uuid} uuid={uuid} />
        ))}
      </div>
    </div>
  );
}
