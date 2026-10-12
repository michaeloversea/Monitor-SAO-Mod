import { FloatingAssetButton } from "@/components/cost/FloatingAssetButton";
import { ClusterHeatmap } from "@/components/node/ClusterHeatmap";
import { DiaTextReveal } from "@/components/ui/DiaTextReveal";
import { Flag } from "@/components/ui/Flag";
import { useAuth } from "@/hooks/useAuth";
import { useHourlyClock, useMinuteClock } from "@/hooks/useClock";
import { useHomeNodeOrder } from "@/hooks/useHomeNodeOrder";
import { useHomeSort } from "@/hooks/useHomeSort";
import {
  useAllNodeMeta,
  useHomeNodeSummaries,
  useNodeOnlineSummaries,
  useNodeStoreStatus,
} from "@/hooks/useNode";
import { useHomepagePingOverview } from "@/hooks/usePingOverview";
import { usePriceVisibility } from "@/hooks/usePriceVisibility";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import {
  preloadTodayTrafficStats,
  TodayTrafficStatsProvider,
  useTodayTrafficStats,
} from "@/hooks/useTodayTrafficStats";
import { useViewMode } from "@/hooks/useViewMode";
import { useHiddenNodeUuids } from "@/hooks/useVisibleNodes";
import { t, useLanguage, useTranslate } from "@/i18n";
import { saveAdminUsername } from "@/services/api";
import { preloadAssetsPage } from "@/services/assetsPageLoader";
import type { HomeNodeSummary } from "@/services/wsStore";
import { getRawNode } from "@/services/wsStore";
import { calculateCostSummary, getExchangeRates } from "@/utils/cost";
import { formatBytes } from "@/utils/format";
import { getDisplayRegionCode } from "@/utils/geo";
import {
  getHomeGroupLabel,
  getHomeGroupOptions,
  getHomeRegionOptions,
  hasUngroupedNodes,
  HOME_ALL_GROUP,
  HOME_ALL_REGION,
  HOME_UNGROUPED,
  sortHomeGroupOptions,
  type HomeRegionOption,
} from "@/utils/homeNodes";
import { getOverviewRating, type OverviewRating } from "@/utils/overviewRating";
import { getRenewalReminders, type RenewalReminderSource } from "@/utils/renewalReminder";
import type { MatrixBootEffect, MatrixColorTheme, NodeViewMode } from "@/utils/themeSettings";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Check,
  CircleDollarSign,
  Cpu,
  HardDrive,
  Layers,
  Network,
  Pencil,
  Server,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { StatMetricIcon } from "../ui/StatMetricIcon";
import { CompactNodeCard } from "./CompactNodeCard";
import { HomeSortControl } from "./HomeSortControl";
import { MiniNodeCard } from "./MiniNodeCard";
import { NodeCard } from "./NodeCard";
import { NodeListView } from "./NodeListView";
import { OverviewTrafficChart } from "./OverviewTrafficChart";
import { RenewalReminder } from "./RenewalReminder";

// 卡片视图网格密度；列表档由独立组件布局。
const GRID_LAYOUT: Record<NodeViewMode, { className: string; minColumnWidth: number }> = {
  large: { className: "grid gap-4 xl:gap-5", minColumnWidth: 360 },
  compact: { className: "grid gap-3 xl:gap-4", minColumnWidth: 340 },
  mini: { className: "grid gap-3 xl:gap-3.5", minColumnWidth: 260 },
  // 占位以满足 Record 穷尽。
  list: { className: "", minColumnWidth: 0 },
};

type MiniGridStyle = CSSProperties & { "--mini-card-min-width": string };

// 标准 UUID 不含逗号，可安全拼成稳定签名。
const UUID_KEY_SEPARATOR = ",";

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
  avgCpu: number;
  totalRamUsed: number;
  totalRamTotal: number;
  ramPct: number;
  totalDiskUsed: number;
  totalDiskTotal: number;
  diskPct: number;
  totalTcpConn: number;
  totalUdpConn: number;
}

function TrafficBarsIcon({ size = 19 }: { size?: number }) {
  useLanguage();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <rect x="2" y="10" width="4" height="8" rx="1.2" fill="currentColor" />
      <rect x="8" y="5.5" width="4" height="12.5" rx="1.2" fill="currentColor" />
      <rect x="14" y="2" width="4" height="16" rx="1.2" fill="currentColor" />
    </svg>
  );
}

function HomeBrand({ siteName }: { siteName: string }) {
  const t = useTranslate();
  return (
    <header className="home-brand sr-only" aria-label={t("站点名称")}>
      <h1 className="home-brand-title" title={siteName}>
        {siteName}
      </h1>
    </header>
  );
}

function getTimeGreetingInfo(
  totalNodes: number,
  onlineNodes: number,
  offlineNodes: number,
  renewalCount: number,
): { greeting: string; subtitle: string } {
  const hour = new Date().getHours();
  let greeting = t("早上好");
  if (hour >= 0 && hour < 5) greeting = t("夜深了");
  else if (hour >= 5 && hour < 11) greeting = t("早上好");
  else if (hour >= 11 && hour < 13) greeting = t("中午好");
  else if (hour >= 13 && hour < 18) greeting = t("下午好");
  else greeting = t("晚上好");

  // 1. 存在离线异常时，精准贴合实际情况告警提示
  if (totalNodes > 0 && offlineNodes > 0) {
    if (onlineNodes === 0) {
      return {
        greeting,
        subtitle: t("您的服务器已全部离线，请及时排查网络与连接状态。"),
      };
    }
    return {
      greeting,
      subtitle: t("检测到 {0} 台服务器处于离线状态，请及时排查处理。", [offlineNodes]),
    };
  }

  // 2. 暂未连接服务器
  if (totalNodes === 0) {
    return {
      greeting,
      subtitle: t("暂未检测到在线服务器，等待节点客户端数据上报。"),
    };
  }

  // 3. 临期提醒（无离线节点但有临近到期节点）
  if (renewalCount > 0) {
    return {
      greeting,
      subtitle: t("当前有 {0} 台服务器临近到期，请留意续费维护。", [renewalCount]),
    };
  }

  // 4. 全员在线健康：按时段给出贴切且长度均衡的生产/工作问候
  if (hour >= 0 && hour < 5) {
    return {
      greeting,
      subtitle: t("夜间全站服务器运行平稳，各项指标持续实时监控中。"),
    };
  }
  if (hour >= 5 && hour < 11) {
    return {
      greeting,
      subtitle: t("全站服务器运行健康，系统资源与网络指标持续监控中。"),
    };
  }
  if (hour >= 11 && hour < 13) {
    return {
      greeting,
      subtitle: t("当前所有服务器运行平稳，系统负载与核心指标持续采集中。"),
    };
  }
  if (hour >= 13 && hour < 18) {
    return {
      greeting,
      subtitle: t("所有服务器运行稳定，系统负载与网络吞吐持续监控中。"),
    };
  }
  return {
    greeting,
    subtitle: t("全站服务器运行良好，网络状态与系统负载数据持续采集中。"),
  };
}

function HomeOverviewCards({
  overview,
  costSummary,
  costLoading,
  showTrafficRating,
  showBandwidthRating,
  showAssetRating,
  trafficRatingLabels,
  bandwidthRatingLabels,
  assetRatingLabels,
  showTrafficDetailButton = true,
  showDetailButton,
  showAssetCard,
  renewalNodes,
  dense,
  onWarmTraffic,
  username,
  loggedIn,
  todayTrafficTotal,
  todayTrafficLoading,
  visibleNodes = [],
  nameByUuid,
  clusterOverviewMode = "classic",
  matrixColorTheme = "default",
  matrixMockFill = false,
  matrixBootAnimation = true,
  matrixBootEffect = "laser-scan",
  matrixCustomPattern = null,
}: {
  overview: HomeOverview;
  costSummary: { remainingCny: number; totalOriginalPriceCny?: number } | null;
  costLoading: boolean;
  dense: boolean;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  showTrafficDetailButton?: boolean;
  showDetailButton: boolean;
  showAssetCard: boolean;
  renewalNodes: RenewalReminderSource[];
  onWarmTraffic: () => void;
  username: string;
  loggedIn?: boolean;
  todayTrafficTotal: number | null;
  todayTrafficLoading: boolean;
  visibleNodes?: HomeNodeSummary[];
  nameByUuid?: Map<string, string>;
  clusterOverviewMode?: "classic" | "nodes";
  matrixColorTheme?: MatrixColorTheme;
  matrixMockFill?: boolean;
  matrixBootAnimation?: boolean;
  matrixBootEffect?: MatrixBootEffect;
  matrixCustomPattern?: number[] | null;
}) {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const [renewalPopoverOpen, setRenewalPopoverOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState("");

  const handleStartEdit = () => {
    if (!loggedIn) return;
    setTempName(username === "Admin" ? "" : username);
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    const finalName = tempName.trim().slice(0, 40);
    if (finalName) {
      void saveAdminUsername(finalName);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["public"] }),
      ]);
    }
    setIsEditingName(false);
  };

  const todayTrafficBytes = todayTrafficTotal ?? 0;
  const [trafficValue, trafficUnit] = todayTrafficLoading && todayTrafficTotal === null
    ? ["—", ""]
    : formatBytes(todayTrafficBytes).split(" ");
  const [ramUsedValue, ramUsedUnit] = formatBytes(overview.totalRamUsed).split(" ");
  const [diskUsedValue, diskUsedUnit] = formatBytes(overview.totalDiskUsed).split(" ");
  const totalConnections = overview.totalTcpConn + overview.totalUdpConn;

  const onlinePct =
    overview.totalNodes > 0 ? (overview.onlineNodes / overview.totalNodes) * 100 : 0;
  const { isPriceVisible } = usePriceVisibility();
  const renderAssetValue = () => {
    if (!isPriceVisible) return t("保密");
    if (!costSummary) return costLoading ? t("计算中") : "—";
    const totalOriginal = costSummary.totalOriginalPriceCny ?? 0;
    if (totalOriginal > 0 || costSummary.remainingCny > 0) {
      return (
        <>
          <span>¥{Math.round(costSummary.remainingCny).toLocaleString("zh-CN")}</span>
          <em className="mao-stat-slash-total"> / ¥{Math.round(totalOriginal).toLocaleString("zh-CN")}</em>
        </>
      );
    }
    return "—";
  };

  const trafficDetailLabel = todayTrafficTotal !== null
    ? t("今日全节点出入站累计 {0}", [formatBytes(todayTrafficTotal)])
    : t("今日流量统计中...");
  const trafficRating =
    showTrafficRating && todayTrafficTotal !== null
      ? getOverviewRating({
        kind: "traffic",
        value: todayTrafficBytes,
        customLabels: trafficRatingLabels,
      })
      : null;
  const bandwidthRating =
    showBandwidthRating
      ? getOverviewRating({
        kind: "bandwidth",
        value: overview.netUp + overview.netDown,
        customLabels: bandwidthRatingLabels,
      })
      : null;
  const assetRating =
    isPriceVisible && showAssetRating && costSummary
      ? getOverviewRating({
        kind: "asset",
        value: costSummary.totalOriginalPriceCny ?? 0,
        customLabels: assetRatingLabels,
      })
      : null;

  const renderRating = (rating: OverviewRating | null) =>
    rating ? (
      <span className="overview-card-rating" data-rating-level={rating.level} title={rating.label}>
        {rating.label}
      </span>
    ) : null;

  const isAllHealthy = overview.offlineNodes === 0 && overview.totalNodes > 0;
  const renewalReminders = getRenewalReminders(renewalNodes, Date.now(), {
    requireOnlineForExpired: true,
  });
  const renewalCount = renewalReminders.length;
  const greetingInfo = getTimeGreetingInfo(
    overview.totalNodes,
    overview.onlineNodes,
    overview.offlineNodes,
    renewalCount,
  );

  return (
    <section
      className={`mao-dashboard-hero home-overview${dense ? " is-dense" : ""}`}
      aria-label={t("首页总览")}
      data-palette={matrixColorTheme || "default"}
    >
      {/* 左侧主要区域：问候语 + 6 宫格指标小卡片 */}
      <div className="mao-hero-main">
        <div className="mao-hero-header">
          <div className="mao-badge">
            <Sparkles size={12} className="text-(--text-primary)" />
            <span>{t("监控总览")}</span>
          </div>
          <h1 className="mao-hero-greeting flex items-center gap-1.5 flex-wrap">
            <span>{t("{0}，", [greetingInfo.greeting])}</span>
            {isEditingName ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  maxLength={40}
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveName();
                    if (e.key === "Escape") setIsEditingName(false);
                  }}
                  placeholder={t("输入昵称 (如 jerry)")}
                  className="px-2 py-0.5 text-base rounded bg-(--input-bg,rgba(0,0,0,0.3)) border border-(--accent) text-(--text-primary) focus:outline-none w-36"
                />
                <button
                  type="button"
                  onClick={handleSaveName}
                  className="p-1 rounded bg-(--accent) text-white font-medium hover:opacity-90 transition-opacity"
                  title={t("保存")}
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="p-1 rounded bg-white/10 text-(--text-muted) hover:text-(--text-primary) transition-colors"
                  title={t("取消")}
                >
                  <X size={14} />
                </button>
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-1.5 group ${loggedIn ? "cursor-pointer" : ""}`}
                onClick={loggedIn ? handleStartEdit : undefined}
                title={loggedIn ? t("点击快速修改管理员昵称") : undefined}
              >
                <DiaTextReveal text={username || "Guest"} />
                {loggedIn && (
                  <Pencil
                    size={13}
                    className="text-(--text-muted) opacity-0 group-hover:opacity-80 hover:text-(--accent) transition-all"
                  />
                )}
              </span>
            )}
          </h1>
          <p className="mao-hero-subtitle">
            {greetingInfo.subtitle}
          </p>
        </div>

        {/* 6 宫格指标卡片 */}
        <div className="mao-stat-grid" data-cards={showAssetCard ? 6 : 5}>
          {/* 1. 活跃连接 (全站活跃连接数) */}
          <div className="mao-stat-card" data-metric="connections">
            <div className="mao-stat-head">
              <div className="mao-stat-title-wrap">
                <StatMetricIcon metric="connections" icon={Network} />
                <span className="mao-stat-label">{t("活跃连接")}</span>
              </div>
            </div>
            <div className="mao-stat-value">
              {totalConnections.toLocaleString()} <span className="mao-stat-unit">Conn</span>
            </div>
            <div className="mao-stat-footer">
              <span
                className="mao-stat-caption"
                title={t("TCP 连接: {0} · UDP 连接: {1}", [overview.totalTcpConn.toLocaleString(), overview.totalUdpConn.toLocaleString()])}
              >
                TCP {overview.totalTcpConn.toLocaleString()} · UDP {overview.totalUdpConn.toLocaleString()}
              </span>
            </div>
          </div>

          {/* 2. 平均 CPU */}
          <div className="mao-stat-card" data-metric="cpu">
            <div className="mao-stat-head">
              <div className="mao-stat-title-wrap">
                <StatMetricIcon metric="cpu" icon={Cpu} />
                <span className="mao-stat-label">{t("平均 CPU")}</span>
              </div>
            </div>
            <div className="mao-stat-value">
              {overview.avgCpu.toFixed(1)} <span className="mao-stat-unit">%</span>
            </div>
            <div className="mao-stat-footer">
              <span className="mao-stat-caption">
                {overview.onlineNodes > 0 ? t("{0} 台在线服务器", [overview.onlineNodes]) : t("暂无在线服务器")}
              </span>
            </div>
          </div>

          {/* 3. 内存用量 */}
          <div className="mao-stat-card" data-metric="ram">
            <div className="mao-stat-head">
              <div className="mao-stat-title-wrap">
                <StatMetricIcon metric="ram" icon={Layers} />
                <span className="mao-stat-label">{t("内存用量")}</span>
              </div>
            </div>
            <div className="mao-stat-value">
              {ramUsedValue} <span className="mao-stat-unit">{ramUsedUnit}</span>
            </div>
            <div className="mao-stat-footer">
              <span className="mao-stat-caption" title={t("已用: {0} / 总量: {1}", [formatBytes(overview.totalRamUsed), formatBytes(overview.totalRamTotal)])}>
                {t("共")} {formatBytes(overview.totalRamTotal)} · {overview.ramPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* 4. 硬盘用量 */}
          <div className="mao-stat-card" data-metric="disk">
            <div className="mao-stat-head">
              <div className="mao-stat-title-wrap">
                <StatMetricIcon metric="disk" icon={HardDrive} />
                <span className="mao-stat-label">{t("硬盘用量")}</span>
              </div>
            </div>
            <div className="mao-stat-value">
              {diskUsedValue} <span className="mao-stat-unit">{diskUsedUnit}</span>
            </div>
            <div className="mao-stat-footer">
              <span className="mao-stat-caption" title={t("已用: {0} / 总量: {1}", [formatBytes(overview.totalDiskUsed), formatBytes(overview.totalDiskTotal)])}>
                {t("共")} {formatBytes(overview.totalDiskTotal)} · {overview.diskPct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* 5. 今日流量 */}
          <div className="mao-stat-card" data-metric="traffic">
            <div className="mao-stat-head">
              <div className="mao-stat-title-wrap">
                <StatMetricIcon metric="traffic" icon={TrendingUp} />
                <span className="mao-stat-label">{t("今日流量")}</span>
              </div>
              {showTrafficDetailButton && (
                <Link
                  to="/traffic"
                  className="overview-card-action mao-stat-action"
                  aria-label={t("打开今日流量统计页")}
                  title={t("今日流量详情")}
                  onPointerEnter={onWarmTraffic}
                  onFocus={onWarmTraffic}
                  onClick={onWarmTraffic}
                >
                  <TrafficBarsIcon size={14} />
                </Link>
              )}
            </div>
            <div className="mao-stat-value">
              {trafficValue}{trafficUnit && <span className="mao-stat-unit"> {trafficUnit}</span>}
            </div>
            <div className="mao-stat-footer">
              <span className="mao-stat-caption truncate" title={trafficDetailLabel}>
                {t("全节点出入站累计")}</span>
              {renderRating(trafficRating)}
            </div>
          </div>

          {/* 6. 资产总值 (右上角钱币图标集成临期提醒悬浮窗) */}
          {showAssetCard && (
            <div className={`mao-stat-card${renewalPopoverOpen ? " is-popover-open" : ""}`} data-metric="asset">
              <div className="mao-stat-head">
                <div className="mao-stat-title-wrap">
                  <StatMetricIcon metric="asset" icon={CircleDollarSign} />
                  <span className="mao-stat-label">{t("资产总值")}</span>
                </div>
                {showDetailButton && (
                  <RenewalReminder nodes={renewalNodes} onOpenChange={setRenewalPopoverOpen}>
                    <Link
                      to="/assets"
                      className="overview-card-action mao-stat-action"
                      aria-label={t("打开资产统计页")}
                      title={renewalCount > 0 ? t("{0} 台设备即将到期", [renewalCount]) : t("资产统计")}
                    >
                      <CircleDollarSign size={14} className={renewalCount > 0 ? "text-(--status-warning)" : ""} />
                    </Link>
                  </RenewalReminder>
                )}
              </div>
              <div className="mao-stat-value">
                {renderAssetValue()}
              </div>
              <div className="mao-stat-footer">
                <span className="mao-stat-caption">
                  {!isPriceVisible ? t("仅管理员可见") : t("实时汇率折算")}
                </span>
                {renderRating(assetRating)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右侧集群状态区域 */}
      <div className="mao-hero-side">
        <div
          className="mao-progress-container"
          data-palette={matrixColorTheme || "default"}
        >
          <div className="mao-progress-head">
            <div className="mao-progress-title-wrap">
              <h3 className="mao-progress-title">
                <Activity size={17} className="text-(--text-primary)" />
                <span>{t("集群状态")}</span>
              </h3>
              <p className="mao-progress-subtitle">
                {clusterOverviewMode === "classic"
                  ? t("服务器在线率与实时网络吞吐")
                  : t("全节点实时负载与机架全景")}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className={`mao-status-pill ${isAllHealthy ? "is-healthy" : "is-warning"}`}>
                <span className="mao-status-dot" />
                {isAllHealthy ? t("状态健康") : overview.totalNodes === 0 ? t("未连接") : t("存在离线 ({0})", [overview.offlineNodes])}
              </span>
              {bandwidthRating && (
                <span
                  className="overview-card-rating is-bandwidth-badge"
                  data-rating-level={bandwidthRating.level}
                  title={t("全站实时带宽评级: {0}", [bandwidthRating.label])}
                >
                  <span className="mao-status-dot" />
                  {bandwidthRating.label}
                </span>
              )}
            </div>
          </div>

          {/* 根据集群状态展示设置，分别呈现「经典布局」或「独立全屏版面」 */}
          {clusterOverviewMode === "classic" ? (
            <>
              {/* 进度模块 1：服务器在线状态 */}
              <div className="mao-progress-section">
                <div className="mao-progress-section-header">
                  <div className="flex items-baseline gap-1.5">
                    <span className="mao-progress-big-num">{onlinePct.toFixed(0)}%</span>
                    <span className="mao-progress-unit-label">{t("在线率")}</span>
                  </div>
                  <div className="mao-progress-tag-box">
                    <span className="mao-progress-tag-label">{t("离线服务器")}</span>
                    <span className="mao-progress-tag-val">{overview.offlineNodes} {t("台")}</span>
                  </div>
                </div>
                {/* 节点展示：达到 51 台时切换为纯无缝一体化进度条，少于 51 台时呈现经典胶囊块 */}
                {overview.totalNodes >= 51 ? (
                  <div
                    className="mao-seamless-progress"
                    role="progressbar"
                    aria-valuenow={Math.round(onlinePct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    title={t("在线: {0} 台 ({1}%) · 离线: {2} 台", [overview.onlineNodes, onlinePct.toFixed(1), overview.offlineNodes])}
                  >
                    <div
                      className="mao-seamless-segment is-online"
                      style={{ width: `${onlinePct}%` }}
                    />
                    {overview.offlineNodes > 0 && (
                      <div
                        className="mao-seamless-segment is-offline"
                        style={{
                          width: `${(overview.offlineNodes / overview.totalNodes) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="mao-node-blocks" role="presentation">
                    {overview.totalNodes > 0 ? (
                      Array.from({ length: overview.totalNodes }, (_, i) => {
                        const isOnline = i < overview.onlineNodes;
                        const isOffline = i >= overview.totalNodes - overview.offlineNodes;
                        const statusClass = isOnline
                          ? "is-online"
                          : isOffline
                            ? "is-offline"
                            : "is-unknown";
                        return (
                          <span
                            key={i}
                            className={`mao-node-block ${statusClass}`}
                            title={t("服务器 {0}: {1}", [i + 1, t(isOnline ? "在线" : isOffline ? "离线" : "未知")])}
                          />
                        );
                      })
                    ) : (
                      <span className="mao-node-block is-unknown" />
                    )}
                  </div>
                )}
                <div className="mao-progress-section-footer">
                  <span>{t("在线")} {overview.onlineNodes} {t("台")}</span>
                  <span>{t("总计")} {overview.totalNodes} {t("台")}</span>
                </div>
              </div>

              {/* 进度模块 2：实时动态网络曲线图 */}
              <OverviewTrafficChart
                netUp={overview.netUp}
                netDown={overview.netDown}
              />
            </>
          ) : (
            /* 矩阵布局：整屏呈现服务器机架方格热力矩阵 */
            <div className="mao-cluster-body-wrap">
              <div className="mao-cluster-pane">
                <ClusterHeatmap
                  nodes={visibleNodes}
                  nameByUuid={nameByUuid}
                  onlinePct={onlinePct}
                  onlineNodes={overview.onlineNodes}
                  offlineNodes={overview.offlineNodes}
                  totalNodes={overview.totalNodes}
                  colorTheme={matrixColorTheme}
                  mockFill={matrixMockFill}
                  bootAnimation={matrixBootAnimation}
                  bootEffect={matrixBootEffect}
                  customPattern={matrixCustomPattern}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function GroupTabs({
  groups,
  hasUngrouped,
  selectedGroup,
  onSelectGroup,
}: {
  groups: string[];
  hasUngrouped?: boolean;
  selectedGroup: string;
  onSelectGroup: (group: string) => void;
}) {
  const t = useTranslate();
  return (
    <div className="home-group-tabs" role="group" aria-label={t("服务器分组")}>
      <button
        type="button"
        aria-pressed={selectedGroup === HOME_ALL_GROUP}
        data-active={selectedGroup === HOME_ALL_GROUP ? "true" : "false"}
        onClick={() => onSelectGroup(HOME_ALL_GROUP)}
      >
        {t("全部")}</button>
      {groups.map((group) => (
        <button
          key={group}
          type="button"
          aria-pressed={selectedGroup === group}
          data-active={selectedGroup === group ? "true" : "false"}
          onClick={() => onSelectGroup(group)}
          title={group}
        >
          {group}
        </button>
      ))}
      {hasUngrouped && groups.length > 0 && (
        <button
          type="button"
          aria-pressed={selectedGroup === HOME_UNGROUPED}
          data-active={selectedGroup === HOME_UNGROUPED ? "true" : "false"}
          onClick={() => onSelectGroup(HOME_UNGROUPED)}
          title={t("未分组")}
        >
          {t("未分组")}</button>
      )}
    </div>
  );
}

// 地区筛选栏:按国旗聚合节点,点击某地区只看该地区;再点一次(或点已选中项)回到全部。
// 与分组栏是两条独立筛选,可叠加(先分组、后地区)。
function RegionTabs({
  regions,
  selectedRegion,
  onSelectRegion,
}: {
  regions: HomeRegionOption[];
  selectedRegion: string;
  onSelectRegion: (region: string) => void;
}) {
  const t = useTranslate();
  return (
    <section className="home-region-bar" aria-label={t("地区筛选")}>
      <div className="home-region-chips" role="group">
        {regions.map(({ code, count }) => {
          const active = selectedRegion === code;
          return (
            <button
              key={code}
              type="button"
              className="home-region-chip"
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => onSelectRegion(active ? HOME_ALL_REGION : code)}
              title={code}
            >
              <Flag region={code} size={14} />
              <span className="home-region-chip-code">{code}</span>
              <span className="home-region-chip-count">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function NodeGrid() {
  const t = useTranslate();
  const now = useHourlyClock();
  const queryClient = useQueryClient();
  const nodes = useHomeNodeSummaries();
  const nodeOnlineSummaries = useNodeOnlineSummaries();
  const allMeta = useAllNodeMeta();
  const { hydrated: storeHydrated, nodeInfoError } = useNodeStoreStatus();
  const { data: me } = useAuth();
  const { data: publicConfig } = usePublicConfig();
  const siteName = publicConfig?.sitename?.trim() || t("节点概览");
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const sort = useHomeSort();
  // enableHomeSort 控制访客能否改排序;关闭时无视 session 覆盖、直接用管理员默认序(默认仍是 weight)。
  const sortEnabled = themeSettings.isReady && themeSettings.enableHomeSort;
  const sortField = sortEnabled ? sort.field : themeSettings.homeSortField;
  const sortDirection = sortEnabled ? sort.direction : themeSettings.homeSortDirection;
  const [selectedGroup, setSelectedGroup] = useState(HOME_ALL_GROUP);
  const [selectedRegion, setSelectedRegion] = useState(HOME_ALL_REGION);
  useHomepagePingOverview(mode);

  // 摘要不含名称，先从完整 meta 解析主题隐藏列表，再统一过滤各类数据。
  const hiddenUuids = useHiddenNodeUuids();
  const visibleNodes = useMemo(
    () =>
      nodes.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [me?.logged_in, nodes, hiddenUuids],
  );
  // 资产统计与卡片使用同一可见性规则，避免泄露隐藏节点信息。
  const visibleMeta = useMemo(
    () =>
      allMeta.filter(
        (node) => (me?.logged_in === true || !node.hidden) && !hiddenUuids.has(node.uuid),
      ),
    [allMeta, me?.logged_in, hiddenUuids],
  );
  const renewalNodes = useMemo<RenewalReminderSource[]>(() => {
    const onlineByUuid = new Map(
      nodeOnlineSummaries.map((node) => [node.uuid, node.online]),
    );
    return visibleMeta.map((node) => ({
      ...node,
      online: onlineByUuid.get(node.uuid) ?? null,
    }));
  }, [nodeOnlineSummaries, visibleMeta]);
  const trafficUuids = useMemo(
    () => visibleMeta.map((node) => node.uuid),
    [visibleMeta],
  );
  const warmTrafficPage = useCallback(() => {
    void preloadTodayTrafficStats(queryClient, trafficUuids, Date.now());
  }, [queryClient, trafficUuids]);
  const todayTrafficClock = useMinuteClock();
  const todayTrafficQuery = useTodayTrafficStats(trafficUuids, todayTrafficClock, "summary");
  const initialTrafficRef = useRef<Map<string, number>>(new Map());

  // 跟踪节点初始累计流量，用于捕获当前会话中的测速与实时流量增量
  useEffect(() => {
    for (const node of visibleNodes) {
      const currentTotal = (node.trafficUp || 0) + (node.trafficDown || 0);
      if (currentTotal > 0 && !initialTrafficRef.current.has(node.uuid)) {
        initialTrafficRef.current.set(node.uuid, currentTotal);
      }
    }
  }, [visibleNodes]);

  const todayTrafficTotal = useMemo(() => {
    // 1. 服务端原生权威日流量 (day_rx + day_tx) 汇总
    let rawDaySum = 0;
    let hasServerDayTraffic = false;
    for (const node of visibleMeta) {
      const raw = getRawNode(node.uuid);
      if (raw && (typeof raw.day_rx === "number" || typeof raw.day_tx === "number")) {
        hasServerDayTraffic = true;
        rawDaySum += Math.max(0, raw.day_rx || 0) + Math.max(0, raw.day_tx || 0);
      }
    }
    if (hasServerDayTraffic) {
      return rawDaySum;
    }

    // 2. 计算当前会话测速增量 (通过实时 WS 节点累计流量的 delta)
    let liveSessionDelta = 0;
    for (const node of visibleNodes) {
      const currentTotal = (node.trafficUp || 0) + (node.trafficDown || 0);
      const initialTotal = initialTrafficRef.current.get(node.uuid) ?? currentTotal;
      if (currentTotal > initialTotal) {
        liveSessionDelta += currentTotal - initialTotal;
      }
    }

    // 3. 基于历史查询基准值 + 实时测速增量
    if (todayTrafficQuery.data && todayTrafficQuery.data.rows.length > 0) {
      const querySum = todayTrafficQuery.data.rows.reduce(
        (sum, row) => sum + row.trafficUp + row.trafficDown,
        0,
      );
      return querySum + liveSessionDelta;
    }

    if (liveSessionDelta > 0) {
      return liveSessionDelta;
    }

    if (!todayTrafficQuery.data) return null;
    return 0;
  }, [todayTrafficQuery.data, visibleMeta, visibleNodes]);
  // 「名称」排序需要展示名(摘要无 name),从 meta 注入。
  const nameByUuid = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of visibleMeta) map.set(node.uuid, node.name?.trim() || node.uuid);
    return map;
  }, [visibleMeta]);

  const groupOptions = useMemo(
    () =>
      sortHomeGroupOptions(
        getHomeGroupOptions(visibleNodes),
        themeSettings.isReady ? themeSettings.homeGroupOrder : [],
      ),
    [visibleNodes, themeSettings.homeGroupOrder, themeSettings.isReady],
  );
  const hasUngrouped = useMemo(() => hasUngroupedNodes(visibleNodes), [visibleNodes]);
  const isUngroupedTabEnabled =
    themeSettings.isReady && themeSettings.showUngroupedTab && hasUngrouped;
  const groupFilteredNodes = useMemo(() => {
    if (selectedGroup === HOME_ALL_GROUP) return visibleNodes;
    if (selectedGroup === HOME_UNGROUPED) {
      return isUngroupedTabEnabled
        ? visibleNodes.filter((node) => !getHomeGroupLabel(node.group))
        : visibleNodes;
    }
    return visibleNodes.filter((node) => getHomeGroupLabel(node.group) === selectedGroup);
  }, [visibleNodes, selectedGroup, isUngroupedTabEnabled]);

  const overviewNodes =
    themeSettings.isReady && themeSettings.overviewFollowGroup
      ? groupFilteredNodes
      : visibleNodes;

  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    let totalCpu = 0;
    let totalRamUsed = 0;
    let totalRamTotal = 0;
    let totalDiskUsed = 0;
    let totalDiskTotal = 0;
    let totalTcpConn = 0;
    let totalUdpConn = 0;

    for (const node of overviewNodes) {
      if (node.online === true) {
        onlineNodes += 1;
        totalCpu += node.cpuPct || 0;
        totalRamUsed += node.ramUsed || 0;
        totalDiskUsed += node.diskUsed || 0;
        totalTcpConn += node.connectionsTcp || 0;
        totalUdpConn += node.connectionsUdp || 0;
      } else if (node.online === false) {
        offlineNodes += 1;
      }
      totalRamTotal += node.ramTotal || 0;
      totalDiskTotal += node.diskTotal || 0;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    const avgCpu = onlineNodes > 0 ? totalCpu / onlineNodes : 0;
    const ramPct = totalRamTotal > 0 ? (totalRamUsed / totalRamTotal) * 100 : 0;
    const diskPct = totalDiskTotal > 0 ? (totalDiskUsed / totalDiskTotal) * 100 : 0;

    return {
      totalNodes: overviewNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
      avgCpu,
      totalRamUsed,
      totalRamTotal,
      ramPct,
      totalDiskUsed,
      totalDiskTotal,
      diskPct,
      totalTcpConn,
      totalUdpConn,
    };
  }, [overviewNodes]);

  const overviewRenewalNodes = useMemo(() => {
    if (!themeSettings.isReady || !themeSettings.overviewFollowGroup) return renewalNodes;
    const groupUuids = new Set(groupFilteredNodes.map((n) => n.uuid));
    return renewalNodes.filter((n) => groupUuids.has(n.uuid));
  }, [renewalNodes, groupFilteredNodes, themeSettings.isReady, themeSettings.overviewFollowGroup]);
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const showTrafficPopover = themeSettings.isReady && themeSettings.showTodayTrafficPopover;
  const loggedIn = Boolean(me?.logged_in);
  const canAccessTraffic = loggedIn || themeSettings.showTrafficPageForGuests;
  const showTrafficDetailButton =
    (themeSettings.isReady ? themeSettings.showTrafficPageButton : true) && canAccessTraffic;
  const hasNodes = visibleMeta.length > 0;
  const canAccessAssets = loggedIn || themeSettings.showPriceForGuests;
  // 卡内入口与悬浮入口互斥，避免重复操作入口。
  const showAssetCard = showHomeOverview && hasNodes;
  const showCostDetailButton =
    showAssetCard && themeSettings.isReady && themeSettings.showCostSummary && canAccessAssets;
  const showCostFloatingButton =
    themeSettings.isReady &&
    themeSettings.showCostSummaryFloatingButton &&
    hasNodes &&
    canAccessAssets &&
    !showCostDetailButton;

  useEffect(() => {
    if (!showCostDetailButton && !showCostFloatingButton) return;

    const idleWindow = window as IdleCapableWindow;
    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preloadAssetsPage, { timeout: 2_000 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    // Safari 等无 requestIdleCallback 的浏览器，在首页稳定后再低优先级预取。
    const handle = window.setTimeout(preloadAssetsPage, 1_000);
    return () => window.clearTimeout(handle);
  }, [showCostDetailButton, showCostFloatingButton]);

  // 资产入口存在时预热汇率，供概览、价格排序和资产页复用。
  const costNeeded = showAssetCard || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(themeSettings.costRateApiUrl, { signal }),
    staleTime: 60 * 60 * 1000,
    // 「价格」排序也要汇率换算月化价,即便没显示资产卡也得拉一次;但空列表无需拉。
    enabled: (costNeeded || sortField === "price") && hasNodes,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(
          visibleMeta,
          themeSettings.costIgnoredNodes,
          rateQuery.data.rates,
          themeSettings.costPremiums,
          now,
        )
        : null,
    [now, visibleMeta, themeSettings.costIgnoredNodes, themeSettings.costPremiums, rateQuery.data],
  );
  // 「价格」排序键:月化价格(CNY);免费/忽略/汇率缺失的节点 null,排到默认序之后。
  const priceByUuid = useMemo(() => {
    const map = new Map<string, number | null>();
    if (costSummary) {
      for (const detail of costSummary.details) {
        map.set(detail.uuid, detail.counted ? detail.monthlyCny : null);
      }
    }
    return map;
  }, [costSummary]);
  const costLoading = costNeeded && rateQuery.isLoading;
  // 地区选项在分组筛选之后统计,让国旗计数反映当前分组内的分布。
  const regionOptions = useMemo(
    () => getHomeRegionOptions(groupFilteredNodes),
    [groupFilteredNodes],
  );
  const filteredNodes = useMemo(
    () =>
      selectedRegion === HOME_ALL_REGION
        ? groupFilteredNodes
        : groupFilteredNodes.filter((node) => getDisplayRegionCode(node.region) === selectedRegion),
    [groupFilteredNodes, selectedRegion],
  );
  // 排序在分组筛选之后。离线永远沉底(写死,见 homeSort);实时网速走防抖(键平滑+滞回+5s 重排)。
  const orderedNodes = useHomeNodeOrder({
    nodes: filteredNodes,
    field: sortField,
    direction: sortDirection,
    nameByUuid,
    priceByUuid,
  });

  useEffect(() => {
    if (
      selectedGroup !== HOME_ALL_GROUP &&
      selectedGroup !== HOME_UNGROUPED &&
      !groupOptions.includes(selectedGroup)
    ) {
      setSelectedGroup(HOME_ALL_GROUP);
    } else if (selectedGroup === HOME_UNGROUPED && !hasUngrouped) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [groupOptions, hasUngrouped, selectedGroup]);

  // 选中的地区在当前分组里不存在了(切换分组/节点变化)就回到全部。
  useEffect(() => {
    if (
      selectedRegion !== HOME_ALL_REGION &&
      !regionOptions.some((option) => option.code === selectedRegion)
    ) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [regionOptions, selectedRegion]);

  // 地区栏被配置关闭(热更新)时,清掉可能残留的地区筛选,否则会留下一个不可见的过滤条件。
  useEffect(() => {
    if (!themeSettings.showRegionBar && selectedRegion !== HOME_ALL_REGION) {
      setSelectedRegion(HOME_ALL_REGION);
    }
  }, [themeSettings.showRegionBar, selectedRegion]);

  useEffect(() => {
    if (!themeSettings.showGroupTabs && selectedGroup !== HOME_ALL_GROUP) {
      setSelectedGroup(HOME_ALL_GROUP);
    } else if (!isUngroupedTabEnabled && selectedGroup === HOME_UNGROUPED) {
      setSelectedGroup(HOME_ALL_GROUP);
    }
  }, [themeSettings.showGroupTabs, isUngroupedTabEnabled, selectedGroup]);

  // 卡片列表只随 UUID 集合/顺序变化；卡片内部各自订阅实时数据。
  const uuidsKey = useMemo(
    () => orderedNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [orderedNodes],
  );
  const orderedUuids = useMemo(
    () => (uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : []),
    [uuidsKey],
  );
  // 列表档由下方 NodeListView 渲染,这里不必构造卡片元素。
  const cards = useMemo(
    () =>
      mode === "list"
        ? null
        : orderedUuids.map((uuid) => (
          <div key={uuid} className="min-w-0">
            {mode === "mini" ? (
              <MiniNodeCard
                uuid={uuid}
                showTodayTraffic={showTrafficPopover}
              />
            ) : mode === "compact" ? (
              <CompactNodeCard
                uuid={uuid}
                showTodayTraffic={showTrafficPopover}
              />
            ) : (
              <NodeCard
                uuid={uuid}
                showTodayTraffic={showTrafficPopover}
              />
            )}
          </div>
        )),
    [orderedUuids, mode, showTrafficPopover],
  );
  const showGroupTabs =
    themeSettings.isReady && themeSettings.showGroupTabs && groupOptions.length > 0;
  const showHomeSort = sortEnabled && visibleNodes.length > 1;
  // 地区栏:只有一个地区时筛选无意义,>1 才显示。
  const showRegionBar =
    themeSettings.isReady && themeSettings.showRegionBar && regionOptions.length > 1;
  // 分组标签栏与卡片网格共用列定义，让标签栏左缘对齐首卡。
  const isMini = mode === "mini";
  const isList = mode === "list";
  const { className: gridClassName, minColumnWidth } = GRID_LAYOUT[mode];
  const gridWrapClassName = isMini ? `${gridClassName} node-grid-mini` : gridClassName;
  const gridStyle = isList
    ? undefined
    : isMini
      ? ({ "--mini-card-min-width": `${minColumnWidth}px` } as MiniGridStyle)
      : { gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${minColumnWidth}px), 1fr))` };
  const gridElement = (
    <div className={gridWrapClassName} style={gridStyle}>
      {cards}
    </div>
  );
  // 迷你与列表档的控件栏借用小卡列宽，避免跟随密集内容列而被压窄。
  const borrowControlsGrid = isMini || isList;
  const controlsWrapClassName = borrowControlsGrid
    ? "grid gap-3 home-controls-bar mb-4"
    : `${gridWrapClassName} home-controls-bar mb-4`;
  const controlsStyle = borrowControlsGrid
    ? {
      gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${GRID_LAYOUT.compact.minColumnWidth}px), 1fr))`,
    }
    : gridStyle;

  if (!themeSettings.isReady || !storeHydrated) {
    if (!nodeInfoError) return null;
    return (
      <div
        className="flex h-[40vh] flex-col items-center justify-center gap-2 text-(--text-tertiary)"
        aria-live="polite"
      >
        <span className="text-[14px]">{t("节点数据暂时无法加载")}</span>
        <span className="text-[12px]">{t("正在等待后端自动重试")}</span>
      </div>
    );
  }

  // 资产页悬浮入口 + 首页概览卡在「空节点」与正常两个分支里完全一致，提取一次复用。
  const homeHeader = (
    <>
      {showCostFloatingButton && <FloatingAssetButton />}
      <HomeBrand siteName={siteName} />
      {showHomeOverview && (
        <HomeOverviewCards
          overview={overview}
          dense={mode === "mini" || mode === "list"}
          showTrafficDetailButton={showTrafficDetailButton}
          showDetailButton={showCostDetailButton}
          showAssetCard={showAssetCard}
          renewalNodes={overviewRenewalNodes}
          costSummary={costSummary}
          costLoading={costLoading}
          showTrafficRating={themeSettings.showTrafficRating}
          showBandwidthRating={themeSettings.showBandwidthRating}
          showAssetRating={themeSettings.showAssetRating}
          trafficRatingLabels={themeSettings.trafficRatingLabels}
          bandwidthRatingLabels={themeSettings.bandwidthRatingLabels}
          assetRatingLabels={themeSettings.assetRatingLabels}
          onWarmTraffic={warmTrafficPage}
          username={loggedIn ? (themeSettings.adminNickname || me?.username || "Admin") : "Guest"}
          loggedIn={loggedIn}
          todayTrafficTotal={todayTrafficTotal}
          todayTrafficLoading={todayTrafficQuery.isPending}
          visibleNodes={visibleNodes}
          nameByUuid={nameByUuid}
          clusterOverviewMode={themeSettings.clusterOverviewMode}
          matrixColorTheme={themeSettings.matrixColorTheme}
          matrixMockFill={themeSettings.matrixMockFill}
          matrixBootAnimation={themeSettings.matrixBootAnimation}
          matrixBootEffect={themeSettings.matrixBootEffect}
          matrixCustomPattern={themeSettings.matrixCustomPattern}
        />
      )}
    </>
  );

  if (visibleNodes.length === 0) {
    return (
      <>
        {homeHeader}
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-(--text-tertiary)">
          <span className="text-[15px]">{t("尚未连接到任何节点")}</span>
          <span className="text-[12px]">{t("等待后端推送或前往管理后台添加")}</span>
        </div>
      </>
    );
  }

  return (
    <>
      {homeHeader}
      <section
        className="mao-cluster-card"
        aria-label={t("服务器集群与监控列表")}
        data-palette={themeSettings.matrixColorTheme || "default"}
      >
        {showHomeOverview && (
          <div className="mao-section-header">
            <div className="mao-section-top-row">
              <div className="mao-badge">
                <Server size={12} className="text-(--text-primary)" />
                <span>{t("服务器集群")}</span>
              </div>
              {showHomeSort && (
                <div className="mao-section-header-actions">
                  <HomeSortControl state={sort} />
                </div>
              )}
            </div>
            <div className="mao-section-title-wrap">
              <h2 className="mao-section-title">{t("服务器矩阵与实时监控")}</h2>
              <p className="mao-section-sub">
                {t("实时监控服务器负载、资源占用、网络吞吐与在线状态。")}</p>
            </div>
          </div>
        )}
        {((!showHomeOverview && showHomeSort) || showGroupTabs) && (
          <div className={controlsWrapClassName} style={controlsStyle}>
            {showGroupTabs && (
              <GroupTabs
                groups={groupOptions}
                hasUngrouped={isUngroupedTabEnabled}
                selectedGroup={selectedGroup}
                onSelectGroup={setSelectedGroup}
              />
            )}
            {!showHomeOverview && showHomeSort && <HomeSortControl state={sort} />}
          </div>
        )}
        {showRegionBar && (
          <RegionTabs
            regions={regionOptions}
            selectedRegion={selectedRegion}
            onSelectRegion={setSelectedRegion}
          />
        )}
        {isList ? (
          <NodeListView uuids={orderedUuids} />
        ) : showTrafficPopover ? (
          <TodayTrafficStatsProvider uuids={trafficUuids}>
            {gridElement}
          </TodayTrafficStatsProvider>
        ) : (
          gridElement
        )}
      </section>
    </>
  );
}
