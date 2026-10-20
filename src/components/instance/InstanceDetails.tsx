import { useMinuteClock } from "@/hooks/useClock";
import { useNodeMeta, useNodeMetrics } from "@/hooks/useNode";
import { useTodayTrafficStats } from "@/hooks/useTodayTrafficStats";
import { useTranslate } from "@/i18n";
import { formatBytes, formatOfflineDuration, formatUptimeDays } from "@/utils/format";
import { resolveTrafficUsage } from "@/utils/traffic";
import { RefreshCw } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { InstancePanel } from "./InstancePanel";
import { InstanceSwitcher } from "./InstanceSwitcher";
import { formatTodayPeakValue, formatTodayTrafficValue } from "./instanceTodayTrafficFormat";

// Intl.DateTimeFormat 构造开销大，复用一个实例，别每次 metrics 更新都重建
const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function InstanceDetails({
  uuid,
  onNodeReady,
}: {
  uuid: string;
  onNodeReady?: () => (() => void) | void;
}) {
  const t = useTranslate();
  const now = useMinuteClock();
  const meta = useNodeMeta(uuid);
  const metrics = useNodeMetrics(uuid);
  const trafficQuery = useTodayTrafficStats([uuid], now, "summary");
  const todayStat = trafficQuery.data?.rows.find((row) => row.uuid === uuid);
  const isReady = Boolean(meta && metrics);

  useEffect(() => {
    if (!isReady) return;
    return onNodeReady?.();
  }, [isReady, onNodeReady, uuid]);

  if (!meta || !metrics) return null;

  const isOnline = metrics.online;
  const uptime = formatUptimeDays(metrics.uptime);
  // 与卡片共用周期账本，累计上下行只作独立统计展示。
  const trafficUsage = resolveTrafficUsage(
    meta.traffic_limit_type,
    metrics,
    meta.traffic_limit,
  );
  const lastUpdated =
    metrics.updatedAt > 0 ? TIME_FORMATTER.format(metrics.updatedAt) : "—";
  const offlineDuration = !isOnline
    ? formatOfflineDuration(
        meta.last_seen_ago ?? metrics.last_seen_ago,
        metrics.updatedAt > 0 ? metrics.updatedAt / 1000 : null,
        now,
      )
    : null;
  const trimmedName = meta.name?.trim();
  const panelTitle = trimmedName ? t("{0} 信息", [trimmedName]) : t("实例信息");

  return (
    <InstancePanel
      title={panelTitle}
      titleAction={<InstanceSwitcher currentUuid={uuid} />}
      description={
        isOnline
          ? undefined
          : t("节点当前离线{0}，以下展示最近一次上报的缓存数据。", [offlineDuration ? `（${offlineDuration}）` : ""])
      }
    >
      <div className="instance-info-groups">
        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("系统")}</div>
          <InfoRow
            label={t("状态")}
            value={isOnline ? t("在线") : offlineDuration ? t("离线 ({0})", [offlineDuration]) : t("离线")}
          />
          {meta.group ? <InfoRow label={t("分组")} value={meta.group} /> : null}
          {meta.public_remark ? (
            <InfoRow label={t("公开备注")} value={meta.public_remark} />
          ) : null}
          <InfoRow
            label="CPU"
            value={`${meta.cpu_name || "—"}${meta.cpu_cores > 0 ? ` (x${meta.cpu_cores})` : ""}`}
          />
          <InfoRow label={t("架构")} value={meta.arch || "—"} />
          <InfoRow label={t("虚拟化")} value={meta.virtualization || "—"} />
          <InfoRow label={t("显卡")} value={meta.gpu_name || "—"} />
          <InfoRow label={t("操作系统")} value={meta.os || "—"} />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("资源")}</div>
          <InfoRow label={t("内存")} value={`${formatBytes(metrics.ramUsed)} / ${formatBytes(metrics.ramTotal)}`} />
          <InfoRow
            label="Swap"
            value={
              metrics.swapTotal > 0
                ? `${formatBytes(metrics.swapUsed)} / ${formatBytes(metrics.swapTotal)}`
                : t("无")
            }
          />
          <InfoRow label={t("磁盘")} value={`${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`} />
          <InfoRow
            label={t("负载")}
            value={`${metrics.load1.toFixed(2)} | ${metrics.load5.toFixed(2)} | ${metrics.load15.toFixed(2)}`}
          />
          <InfoRow
            label={t("运行时长")}
            value={uptime.unit ? `${uptime.value} ${uptime.unit}` : uptime.value}
          />
        </div>

        <div className="instance-info-group">
          <div className="instance-info-group-title">{t("网络")}</div>
          <InfoRow
            label={isOnline ? t("实时网络") : t("缓存网络")}
            value={`↑ ${formatBytes(metrics.netUp)}/s · ↓ ${formatBytes(metrics.netDown)}/s`}
          />
          <InfoRow label={isOnline ? t("最近更新") : t("最后上报")} value={lastUpdated} />
          <InfoRow
            label={t("今日流量")}
            value={
              <span className="instance-info-inline-value">
                <span>
                  {formatTodayTrafficValue(
                    todayStat,
                    trafficQuery.isPending,
                    trafficQuery.isError,
                  )}
                </span>
                <button
                  type="button"
                  className={`instance-info-refresh${trafficQuery.isFetching ? " is-spinning" : ""}`}
                  onClick={() => void trafficQuery.refetch()}
                  disabled={trafficQuery.isFetching}
                  aria-busy={trafficQuery.isFetching}
                  aria-label={t("刷新今日流量")}
                  title={t("刷新今日流量")}
                >
                  <RefreshCw size={13} strokeWidth={2.2} />
                </button>
              </span>
            }
          />
          <InfoRow
            label={t("峰值速度")}
            value={formatTodayPeakValue(todayStat, trafficQuery.isPending)}
          />
          {metrics.month_start && <InfoRow label={t("周期开始日")} value={metrics.month_start} />}
          <div className="instance-info-item is-stack">
            <span className="instance-info-label">{t("累计流量")}</span>
            <div className="instance-info-traffic">
              <span className="instance-info-value">{`↑ ${formatBytes(metrics.trafficUp)} · ↓ ${formatBytes(metrics.trafficDown)}`}</span>
              <div
                className={`instance-progress-track${trafficUsage.unlimited ? " is-unlimited" : ""}`}
                aria-hidden
              >
                {trafficUsage.available && !trafficUsage.unlimited && (
                  <span
                    className="instance-progress-fill"
                    style={{ width: `${trafficUsage.fraction * 100}%` }}
                  />
                )}
              </div>
              <span className="instance-info-note">
                {t("本周期流量")} · {!trafficUsage.available ? t("本周期暂无数据") : trafficUsage.unlimited
                  ? `${formatBytes(trafficUsage.used, 2)} / ∞`
                  : `${formatBytes(trafficUsage.used, 2)} / ${formatBytes(trafficUsage.limit)}`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </InstancePanel>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  const t = useTranslate();
  return (
    <div className="instance-info-item">
      <span className="instance-info-label">{t(label)}</span>
      <div className="instance-info-value">{value}</div>
    </div>
  );
}
