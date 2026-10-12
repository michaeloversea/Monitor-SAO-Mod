import { Flag } from "@/components/ui/Flag";
import { Spinner } from "@/components/ui/Spinner";
import { useAuth } from "@/hooks/useAuth";
import { useHourlyClock } from "@/hooks/useClock";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useVisibleNodes } from "@/hooks/useVisibleNodes";
import { t, useLanguage, useTranslate } from "@/i18n";
import { formatBillingCycle } from "@/utils/billing";
import { calculateCostSummary, formatCnyMoney, formatSignedCny, getExchangeRates } from "@/utils/cost";
import { getExpireDaysRemaining, LONG_TERM_EXPIRE_DAYS } from "@/utils/format";
import { getRenewalReminders } from "@/utils/renewalReminder";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronUp, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";

type AssetDetail = ReturnType<typeof calculateCostSummary>["details"][number];
type AssetsSortField =
  | "weight"
  | "price"
  | "originalPrice"
  | "remaining"
  | "premium"
  | "premiumMonthly"
  | "expiry";
type AssetsSortDirection = "asc" | "desc";

const NATURAL_DIRECTION: Record<AssetsSortField, AssetsSortDirection> = {
  weight: "asc",
  price: "desc",
  originalPrice: "desc",
  remaining: "desc",
  premium: "desc",
  premiumMonthly: "desc",
  expiry: "asc",
};

const TABLE_COLUMNS: Array<{ field: AssetsSortField; label: string; numeric?: boolean }> = [
  { field: "weight", label: "节点" },
  { field: "price", label: "CNY 价格", numeric: true },
  { field: "originalPrice", label: "原始价格", numeric: true },
  { field: "remaining", label: "剩余价值", numeric: true },
  { field: "premium", label: "溢价", numeric: true },
  { field: "premiumMonthly", label: "溢价月摊", numeric: true },
  { field: "expiry", label: "到期", numeric: true },
];

const MOBILE_SORT_OPTIONS: Array<{ field: AssetsSortField; label: string }> = [
  { field: "weight", label: "权重" },
  { field: "price", label: "价格" },
  { field: "premium", label: "溢价" },
  { field: "expiry", label: "到期" },
];

const ASSETS_MOBILE_QUERY = "(max-width: 720px)";

function sortValue(detail: AssetDetail, field: AssetsSortField): number {
  switch (field) {
    case "price":
    case "originalPrice":
      return detail.priceCny;
    case "remaining":
      return detail.remainingCny;
    case "premium":
      return detail.premiumCny;
    case "premiumMonthly":
      return detail.premiumMonthlyCny;
    case "expiry": {
      const days = getExpireDaysRemaining(detail.expiredAt);
      return days == null ? Number.POSITIVE_INFINITY : days;
    }
    default:
      return detail.weight;
  }
}

function formatCostExpiry(expiredAt: string) {
  const days = getExpireDaysRemaining(expiredAt);
  if (days == null) return t("到期未知");
  if (days > LONG_TERM_EXPIRE_DAYS) return t("长期");
  if (days < 0) return t("已过期");
  if (days === 0) return t("今日到期");
  return t("{0} 天后到期", [days]);
}

function premiumTone(value: number) {
  if (value > 0) return "var(--status-error)";
  if (value < 0) return "var(--status-success)";
  return "var(--text-tertiary)";
}

function assetsRenewalTone(daysRemaining: number): "critical" | "warning" {
  return daysRemaining <= 3 ? "critical" : "warning";
}

function assetsRenewalLabel(daysRemaining: number) {
  return daysRemaining < 0 ? t("已过期") : t("即将到期");
}

function AssetTag({ children, tone, title }: {
  children: ReactNode;
  tone: "price" | "original" | "remaining" | "premium" | "monthly" | "expiry";
  title?: string;
}) {
  useLanguage();
  return <span className="asset-value-tag" data-tone={tone} title={title}>
    <span className="asset-value-tag-dot" aria-hidden="true" />{children}
  </span>;
}

// "¥ 1,234.56" → 货币符号 / 整数位 / 小数位三段,按报表数字惯例分级排印。
function HeroMoney({ value }: { value: number | null }) {
  const t = useTranslate();
  if (value == null) {
    return <span className="assets-hero-value is-pending">{t("计算中")}</span>;
  }
  const [int, frac = "00"] = formatCnyMoney(value).replace("¥", "").trim().split(".");
  return (
    <span className="assets-hero-value">
      <span className="assets-hero-currency">¥</span>
      {int}
      <span className="assets-hero-frac">.{frac}</span>
    </span>
  );
}

export function Assets() {
  const t = useTranslate();
  const localizeOriginalPrice = (price: string) => {
    const slash = price.lastIndexOf("/");
    if (slash < 0) return price;
    const unit = price.slice(slash + 1);
    const match = /^(\d+)(个月|月|天|年)$/.exec(unit);
    const period = match ? t(`{0}${match[2]}`, [match[1]]) : t(unit);
    return `${price.slice(0, slash)}/${period}`;
  };
  const [sortField, setSortField] = useState<AssetsSortField>("weight");
  const [sortDirection, setSortDirection] = useState<AssetsSortDirection>("asc");
  const isMobileLayout = useMediaQuery(ASSETS_MOBILE_QUERY);
  const now = useHourlyClock();
  const themeSettings = useThemeSettings();
  const forceRateRefresh = useRef(false);
  const nodes = useVisibleNodes();
  // 资产详情页是风险核对入口：这里始终按真实到期数据展示，不读取首页的关闭/稍后偏好。
  const renewalReminders = useMemo(() => getRenewalReminders(nodes, now), [nodes, now]);
  const renewalByUuid = useMemo(
    () => new Map(renewalReminders.map((item) => [item.uuid, item])),
    [renewalReminders],
  );
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: ({ signal }) => {
      const ignoreCache = forceRateRefresh.current;
      forceRateRefresh.current = false;
      return getExchangeRates(themeSettings.costRateApiUrl, { signal, ignoreCache });
    },
    staleTime: 60 * 60 * 1000,
    enabled: themeSettings.isReady && nodes.length > 0,
    retry: 1,
  });
  const summary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(
            nodes,
            themeSettings.costIgnoredNodes,
            rateQuery.data.rates,
            themeSettings.costPremiums,
            now,
          )
        : null,
    [nodes, now, themeSettings.costIgnoredNodes, themeSettings.costPremiums, rateQuery.data],
  );
  const detailRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    // 排序键先算好,避免比较器里 O(n log n) 次重复解析到期日。
    const rows = (summary?.details ?? []).map((detail) => ({
      detail,
      key: sortValue(detail, sortField),
    }));
    rows.sort((a, b) => {
      if (a.detail.counted !== b.detail.counted) return a.detail.counted ? -1 : 1;
      return (
        (a.key - b.key) * direction || a.detail.name.localeCompare(b.detail.name, "zh-CN")
      );
    });
    return rows.map(({ detail }) => detail);
  }, [sortDirection, sortField, summary]);
  const exchangeRateRows = useMemo(() => {
    if (!rateQuery.data?.rates.CNY) return [];
    const rates = rateQuery.data.rates;
    return ["USD", "HKD", "EUR", "GBP", "JPY"]
      .map((code) => (rates[code] ? { code, value: rates.CNY / rates[code] } : null))
      .filter((item): item is { code: string; value: number } => Boolean(item));
  }, [rateQuery.data]);

  const handleSort = (field: AssetsSortField) => {
    if (field === sortField) {
      setSortDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(NATURAL_DIRECTION[field]);
    }
  };

  const { data: me } = useAuth();
  const loggedIn = Boolean(me?.logged_in);

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  // 两个入口都关闭或对访客隐藏资产时，未登录访客直连 URL 回首页。
  if (
    (!themeSettings.showCostSummary && !themeSettings.showCostSummaryFloatingButton) ||
    (!loggedIn && !themeSettings.showPriceForGuests)
  ) {
    return <Navigate to="/" replace />;
  }

  const hasPremium = summary?.details.some((detail) => detail.premiumCny !== 0) ?? false;
  const ledgerRows: Array<{
    label: string;
    value: string;
    tone?: string;
    title?: string;
  }> = [
    { label: t("年化总支出"), value: summary ? formatCnyMoney(summary.totalCny) : "--" },
    { label: t("月均支出"), value: summary ? formatCnyMoney(summary.monthlyCny) : "--" },
    ...(summary != null && hasPremium
      ? [
          {
            label: t("溢价盈亏"),
            value: formatSignedCny(summary.premiumTotalCny),
            tone: premiumTone(summary.premiumTotalCny),
            title:
              t("所有节点「收购溢价」的加总（正数=溢价多花钱，负数=折价少花钱），只反映溢价本身的赚亏，不叠加到剩余价值/年化/月均里"),
          },
        ]
      : []),
    ...(summary != null && summary.premiumMonthlyTotalCny !== 0
      ? [
          {
            label: t("真实月均"),
            value: formatCnyMoney(summary.effectiveMonthlyCny),
            title:
              t("月均支出 + 溢价月摊（各节点溢价 ÷ 收购日至到期日的月数，无到期按已持有月数；仅计入填写了收购日期的节点），仅作参考，不改变月均支出口径"),
          },
        ]
      : []),
    ...(summary != null && hasPremium
      ? [
          {
            label: t("实际剩余价值"),
            value: formatCnyMoney(summary.actualRemainingCny),
            title: t("剩余价值 + 尚未摊销的溢价；固定期限节点的溢价随到期临近衰减，到期后归零"),
          },
        ]
      : []),
  ];

  const directionIcon =
    sortDirection === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />;

  return (
    <div className="assets-page flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <Link to="/" className="instance-page-back">
          <ChevronLeft size={14} />
          {t("返回")}</Link>
        <button
          type="button"
          className={`cost-summary-action${rateQuery.isFetching ? " is-spinning" : ""}`}
          onClick={() => {
            forceRateRefresh.current = true;
            void rateQuery.refetch();
          }}
          disabled={rateQuery.isFetching}
          aria-busy={rateQuery.isFetching}
          aria-label={t("刷新汇率与统计")}
          title={t("刷新")}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-(--text-tertiary)">
          <span className="text-[15px]">{t("暂无节点数据")}</span>
          <span className="text-[12px]">{t("等待后端推送或前往管理后台添加")}</span>
        </div>
      ) : (
        <>
          <section className="assets-hero" aria-label={t("资产汇总")}>
            <span className="assets-hero-mark" aria-hidden>
              ¥
            </span>
            <div className="assets-hero-main">
              <span className="assets-eyebrow" title={t("按各节点账单价格折算的剩余价值，不含收购溢价")}>
                {t("剩余价值")}</span>
              <HeroMoney value={summary ? summary.remainingCny : null} />
            </div>
            <dl className="assets-ledger">
              {ledgerRows.map((row) => (
                <div className="assets-ledger-row" key={row.label} title={row.title}>
                  <dt>{row.label}</dt>
                  <dd style={row.tone ? { color: row.tone } : undefined}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="assets-section-head">
            <span className="assets-eyebrow">{t("明细")}</span>
            <span className="assets-count">{detailRows.length} {t("台")}</span>
            {renewalReminders.length > 0 && (
              <span className="assets-renewal-inline">
                <CalendarClock size={12} strokeWidth={2.1} />
                {renewalReminders.length} {t("台临期")}</span>
            )}
            <div className="assets-mobile-tools">
              <div className="cost-summary-sort-tabs" role="group" aria-label={t("排序字段")}>
                {MOBILE_SORT_OPTIONS.map((option) => (
                  <button
                    key={option.field}
                    type="button"
                    className="cost-summary-sort-tab"
                    data-active={sortField === option.field}
                    onClick={() => handleSort(option.field)}
                    aria-pressed={sortField === option.field}
                  >
                    {t(option.label)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cost-summary-action is-direction"
                onClick={() => setSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
                aria-label={sortDirection === "asc" ? t("切换为倒序") : t("切换为正序")}
                title={sortDirection === "asc" ? t("正序") : t("倒序")}
              >
                {sortDirection === "asc" ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            </div>
          </div>

          {summary ? (
            <>
              {!isMobileLayout ? (
                <div className="assets-table-wrap">
                <table className="assets-table">
                  <thead>
                    <tr>
                      {TABLE_COLUMNS.map((column) => (
                        <th
                          key={column.field}
                          data-numeric={column.numeric || undefined}
                          aria-sort={
                            sortField === column.field
                              ? sortDirection === "asc"
                                ? "ascending"
                                : "descending"
                              : undefined
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleSort(column.field)}
                            data-active={sortField === column.field}
                          >
                            {t(column.label)}
                            {sortField === column.field && directionIcon}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((detail) => {
                      const reminder = renewalByUuid.get(detail.uuid);
                      const renewalTone = reminder
                        ? assetsRenewalTone(reminder.daysRemaining)
                        : undefined;
                      const renewalLabel = reminder
                        ? assetsRenewalLabel(reminder.daysRemaining)
                        : undefined;
                      return (
                        <tr
                          key={detail.uuid}
                          data-counted={detail.counted}
                          data-renewal-tone={renewalTone}
                        >
                        <td>
                          <Link
                            to={`/instance/${encodeURIComponent(detail.uuid)}`}
                            className="assets-node-link"
                            title={detail.name}
                          >
                            <Flag region={detail.region} size={12} />
                            <span>{detail.name}</span>
                          </Link>
                        </td>
                        <td data-numeric>
                          <AssetTag tone="price">{detail.counted ? `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}` : t(detail.note)}</AssetTag>
                        </td>
                        <td data-numeric>
                          {detail.originalRenewalPrice ? <AssetTag tone="original" title={t("原币续费价格")}>{localizeOriginalPrice(detail.originalRenewalPrice)}</AssetTag> : "—"}
                        </td>
                        <td data-numeric data-strong>
                          {detail.counted ? <AssetTag tone="remaining">{formatCnyMoney(detail.remainingCny)}</AssetTag> : "—"}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 ? (
                            <AssetTag tone="premium">
                              {formatSignedCny(detail.premiumCny)}
                            </AssetTag>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-numeric>
                          {detail.premiumCny !== 0 && detail.amortMonths != null ? (
                            <AssetTag tone="monthly"
                              title={t("摊销 {0} 个月（收购日 → 到期日；无到期按已持有）", [Math.round(detail.amortMonths)])}
                            >
                              {formatSignedCny(detail.premiumMonthlyCny)}{t("/月")}</AssetTag>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td data-numeric>
                          <AssetTag tone="expiry">{reminder ? (
                            <span
                              className="assets-expiry-reminder"
                              data-tone={renewalTone}
                              title={renewalLabel}
                            >
                              <span>{formatCostExpiry(detail.expiredAt)}</span>
                              <small>{renewalLabel}</small>
                            </span>
                          ) : (
                            formatCostExpiry(detail.expiredAt)
                          )}</AssetTag>
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              ) : (
                <div className="assets-card-list">
                {detailRows.map((detail) => {
                  const reminder = renewalByUuid.get(detail.uuid);
                  const renewalTone = reminder
                    ? assetsRenewalTone(reminder.daysRemaining)
                    : undefined;
                  const renewalLabel = reminder
                    ? assetsRenewalLabel(reminder.daysRemaining)
                    : undefined;
                  const priceLabel =
                    t(detail.note) ||
                    `${formatCnyMoney(detail.priceCny)}/${formatBillingCycle(detail.billingCycleDays)}`;
                  return (
                    <div
                      key={detail.uuid}
                      className="cost-summary-detail-item"
                      data-counted={detail.counted}
                      data-renewal-tone={renewalTone}
                      title={detail.name}
                    >
                      <div className="cost-summary-detail-head">
                        <Link
                          to={`/instance/${encodeURIComponent(detail.uuid)}`}
                          className="cost-summary-detail-name"
                        >
                          <Flag region={detail.region} size={12} />
                          <span className="cost-summary-detail-title">{detail.name}</span>
                        </Link>
                        <AssetTag tone="remaining" title={t("剩余价值")}>
                          {detail.counted ? formatCnyMoney(detail.remainingCny) : "—"}
                        </AssetTag>
                      </div>
                      <div className="cost-summary-detail-meta">
                        <AssetTag tone="price" title={t("CNY 价格")}>{priceLabel}</AssetTag>
                        {detail.originalRenewalPrice && <AssetTag tone="original" title={t("原始价格")}>{localizeOriginalPrice(detail.originalRenewalPrice)}</AssetTag>}
                        {detail.premiumCny !== 0 && (
                          <AssetTag tone="premium"
                            title={t("收购溢价（正数=多花钱溢价买入，负数=折价买入）")}
                          >
                            {formatSignedCny(detail.premiumCny)} {t("溢价")}</AssetTag>
                        )}
                        {detail.premiumCny !== 0 && detail.amortMonths != null && (
                          <AssetTag tone="monthly"
                            title={t("溢价月摊 = 收购溢价 ÷ 摊销月数（收购日 → 到期日；无到期按已持有）")}
                          >
                            {t("月摊")}{formatSignedCny(detail.premiumMonthlyCny)} {t("· 摊")}{Math.round(detail.amortMonths)} {t("月")}</AssetTag>
                        )}
                        <AssetTag tone="expiry">
                          {formatCostExpiry(detail.expiredAt)}
                          {renewalLabel && <small>{renewalLabel}</small>}
                        </AssetTag>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </>
          ) : (
            <div className="cost-summary-empty">
              {rateQuery.isError ? t("汇率获取失败，点击右上角刷新重试") : t("费用明细加载中")}
            </div>
          )}

          <details className="cost-summary-rate-details">
            <summary>
              <span>{t("汇率")}</span>
              <strong>
                {exchangeRateRows.length > 0
                  ? exchangeRateRows
                      .slice(0, 3)
                      .map((item) => `${item.code} ${formatCnyMoney(item.value)}`)
                      .join(" · ")
                  : t("暂无汇率")}
              </strong>
            </summary>
            {exchangeRateRows.length > 0 ? (
              <div className="cost-summary-rate-list" aria-label={t("汇率")}>
                {exchangeRateRows.map((item) => (
                  <div className="cost-summary-rate-item" key={item.code}>
                    <span>1 {item.code}</span>
                    <strong>{formatCnyMoney(item.value)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cost-summary-empty is-compact">{t("暂无可用汇率")}</div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
