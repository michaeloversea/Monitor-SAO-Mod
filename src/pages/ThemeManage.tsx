import { InstancePanel } from "@/components/instance/InstancePanel";
import { MatrixPatternEditor } from "@/components/matrix/MatrixPatternEditor";
import { HomepageNodePingEditor } from "@/components/node/HomepageNodePingEditor";
import { LatencyBars } from "@/components/node/LatencyBars";
import { QualityBars } from "@/components/node/QualityBars";
import { Flag } from "@/components/ui/Flag";
import { SettingSelect } from "@/components/ui/SettingSelect";
import { Spinner } from "@/components/ui/Spinner";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useHourlyClock } from "@/hooks/useClock";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { LANGUAGE_OPTIONS, t, useLanguage, useTranslate, type Language } from "@/i18n";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  getNodes,
  saveThemeSettings,
} from "@/services/api";
import { queryClient } from "@/services/queryClient";
import type { AdminClient, PingLatencyColors, PingLatencyThresholds, PingLossColors, PingLossThresholds, PingOverviewBucket, PingTask, ThemeSettings, TrafficSpectrumColors } from "@/types/theme";
import {
  calculateCostPremiumAmount,
  calculateCostPremiumBasisAt,
  calculateCostSummary,
  formatCnyMoney,
  formatSignedCny,
  getExchangeRates,
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostPremiums,
  normalizeCostRateApiUrl,
  type CostPremiumEntry,
} from "@/utils/cost";
import { dedupeGroupLabels, normalizeHomeGroupOrder, sortHomeGroupOptions } from "@/utils/homeNodes";
import { HOME_SORT_FIELD_LABELS, HOME_SORT_FIELDS } from "@/utils/homeSort";
import { buildTrafficQuotaSegmentColors } from "@/utils/metricTone";
import { normalizeNodeIdentityList } from "@/utils/nodeIdentity";
import { getDefaultOverviewRatingLabelText, type OverviewRatingKind } from "@/utils/overviewRating";
import {
  assignHomepageMultiPingTask,
  HOMEPAGE_MULTI_PING_MAX_COUNT,
  HOMEPAGE_MULTI_PING_MIN_COUNT,
  normalizeHomepageMultiPingTaskIds,
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { DEFAULT_PING_LATENCY_COLORS, DEFAULT_PING_LATENCY_THRESHOLDS, DEFAULT_PING_LOSS_COLORS, DEFAULT_PING_LOSS_THRESHOLDS, DEFAULT_THEME_SETTINGS, DEFAULT_TRAFFIC_SPECTRUM_COLORS, normalizePingLatencyColors, normalizePingLatencyThresholds, normalizePingLossColors, normalizePingLossThresholds, normalizeThemeSettings, normalizeTrafficSpectrumColors, STATUS_BAR_PRESETS, type MatrixBootEffect, type MatrixColorTheme, type ResolvedThemeSettings, type StatusBarPreset } from "@/utils/themeSettings";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Compass,
  Grid3x3,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  List,
  ListFilter,
  Moon,
  RefreshCw, RotateCcw, Rows3,
  Save,
  Search, Server, Sliders, Sparkles, Square,
  Sun,
  SunMoon
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
const LATENCY_TIER_CONFIG = [
  { key: "excellent" as const, label: "极好", hint: "极低延迟，最流畅体验", defaultColor: DEFAULT_PING_LATENCY_COLORS.excellent },
  { key: "good" as const, label: "良好", hint: "正常低延迟，无感知波动", defaultColor: DEFAULT_PING_LATENCY_COLORS.good },
  { key: "moderate" as const, label: "中等", hint: "稍有延迟，基本稳定可用", defaultColor: DEFAULT_PING_LATENCY_COLORS.moderate },
  { key: "elevated" as const, label: "偏高", hint: "高延迟警示，网络较吃紧", defaultColor: DEFAULT_PING_LATENCY_COLORS.elevated },
  { key: "critical" as const, label: "极高", hint: "严重延迟，极度拥堵或告警", defaultColor: DEFAULT_PING_LATENCY_COLORS.critical },
] as const;

const LOSS_TIER_CONFIG = [
  { key: "zero" as const, label: "无丢包 (0%)", hint: "网络通畅，零样本丢失", defaultColor: DEFAULT_PING_LOSS_COLORS.zero },
  { key: "low" as const, label: "轻微丢包", hint: "偶发微量丢包，基本可用", defaultColor: DEFAULT_PING_LOSS_COLORS.low },
  { key: "medium" as const, label: "中度丢包", hint: "较明显持续丢包，需注意", defaultColor: DEFAULT_PING_LOSS_COLORS.medium },
  { key: "high" as const, label: "严重丢包", hint: "严重丢包甚至失联脱网", defaultColor: DEFAULT_PING_LOSS_COLORS.high },
] as const;

const TRAFFIC_SPECTRUM_ANCHOR_CONFIG = [
  {
    key: "start" as const,
    label: "充裕健康色 (0% ~ 15%)",
    stage: "充裕健康期",
    hint: "初始充裕配额，健康充足状态",
    defaultColor: DEFAULT_TRAFFIC_SPECTRUM_COLORS.start,
  },
  {
    key: "mid" as const,
    label: "半程消耗色 (~50%)",
    stage: "半程过渡期",
    hint: "中位消耗阶段，稳定过渡",
    defaultColor: DEFAULT_TRAFFIC_SPECTRUM_COLORS.mid,
  },
  {
    key: "high" as const,
    label: "高耗预警色 (~80%)",
    stage: "高耗预警期",
    hint: "配额消耗过半，提示关注用量",
    defaultColor: DEFAULT_TRAFFIC_SPECTRUM_COLORS.high,
  },
  {
    key: "end" as const,
    label: "危险耗尽色 (100% 警报红)",
    stage: "耗尽警报红",
    hint: "临近或已耗尽，末端绝对保证警报红",
    defaultColor: DEFAULT_TRAFFIC_SPECTRUM_COLORS.end,
  },
] as const;
interface ColorThemeOption {
  id: MatrixColorTheme;
  label: string;
  badge: string;
  desc: string;
  colors: [string, string, string, string];
  badgeClass: string;
}

const COLOR_THEME_OPTIONS: ColorThemeOption[] = [
  {
    id: "default",
    label: "经典标准",
    badge: "CLASSIC",
    desc: "绿 · 橙 · 红 常规监控色阶",
    colors: ["#34d399", "#10b981", "#f59e0b", "#ef4444"],
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  },
  {
    id: "eva",
    label: "EVA 初号机",
    badge: "UNIT-01",
    desc: "机体紫 · 荧光绿 · 警告橙 · 暴走红",
    colors: ["#7c3aed", "#00ff66", "#f97316", "#ef4444"],
    badgeClass: "bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30",
  },
  {
    id: "cyberpunk",
    label: "夜之城 2077",
    badge: "NIGHT CITY",
    desc: "斯安威斯坦青 · 霓虹亮黄 · 超频绯红",
    colors: ["#00f0ff", "#fcee0a", "#ff0055", "#ef4444"],
    badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30",
  },
  {
    id: "divergence",
    label: "命运石之门",
    badge: "1.048596%",
    desc: "待机暖杏橙 · 氖气放电暖橙 · 烈焰超频红橙",
    colors: ["#fdba74", "#f97316", "#ea580c", "#ef4444"],
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30",
  },
];

interface BootEffectOption {
  id: MatrixBootEffect;
  label: string;
  badge: string;
  desc: string;
  badgeClass: string;
}

const BOOT_EFFECT_OPTIONS: BootEffectOption[] = [
  {
    id: "laser-scan",
    label: "激光横扫 (Laser Scan)",
    badge: "RADAR",
    desc: "经典雷达激光束自左向右横向扫描显影",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  },
  {
    id: "digital-rain",
    label: "数码雨流 (Digital Rain)",
    badge: "CASCADE",
    desc: "交错流光瀑布自上而下倾泻显影，如黑客帝国代码雨般涌现",
    badgeClass: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border-cyan-500/30",
  },
  {
    id: "cyber-glitch",
    label: "神经故障 (Cyber Glitch)",
    badge: "OVERCLOCK",
    desc: "斯安威斯坦电光青与超频品红噪波爆闪、行撕裂与协议校准咬合",
    badgeClass: "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300 border-fuchsia-500/30",
  },
  {
    id: "divergence-flux",
    label: "世界线跳变 (Divergence Flux)",
    badge: "1.048596%",
    desc: "真空管惰性氖气放电赤橙火花高频跳动，自左向右逐位锁定定格",
    badgeClass: "bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30",
  },
];

const PREVIEW_LATENCY_SAMPLES = [
  15, 25, 40, 55, 65, 80, 95, 110, 130, 150, 165, 185, 195, 210, 260, 320,
];

const PREVIEW_LOSS_SAMPLES = [
  0, 0, 0, 1.2, 0, 0, 2.5, 0, 4.8, 7.5, 0, 12.0, 18.5, 0, 25.0, 0,
];

const PREVIEW_LATENCY_BUCKETS: PingOverviewBucket[] = PREVIEW_LATENCY_SAMPLES.map(
  (value, index) => ({
    index,
    total: 10,
    successful: 10,
    lost: 0,
    loss: 0,
    value,
    startAt: null,
    endAt: null,
  }),
);

const PREVIEW_LOSS_BUCKETS: PingOverviewBucket[] = PREVIEW_LOSS_SAMPLES.map(
  (loss, index) => ({
    index,
    total: 10,
    successful: Math.round(10 * (1 - loss / 100)),
    lost: Math.round(10 * (loss / 100)),
    loss,
    value: 40,
    startAt: null,
    endAt: null,
  }),
);

const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "system", label: "跟随系统", icon: SunMoon },
  { value: "dark", label: "深色", icon: Moon },
] as const;
const NODE_VIEW_MODE_OPTIONS = [
  { value: "large", label: "大卡片", icon: Square },
  { value: "compact", label: "小卡片", icon: LayoutGrid },
  { value: "mini", label: "迷你卡片", icon: Grid3x3 },
  { value: "list", label: "列表", icon: List },
] as const;
const MOBILE_VIEW_MODE_OPTIONS = NODE_VIEW_MODE_OPTIONS.filter((option) => option.value !== "list");

function localDateInputMax() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

const OVERVIEW_RATING_LABEL_FIELDS: Array<{
  key: OverviewRatingKind;
  title: string;
  scopeBadge: string;
  description: string;
  toggleKey: "showTrafficRating" | "showBandwidthRating" | "showAssetRating";
  tierHint: string;
  isBadge?: boolean;
}> = [
  {
    key: "traffic",
    title: "今日流量",
    scopeBadge: "指标卡片底部",
    description: "显示在首页「今日流量」指标卡片右下角，依据全节点当日出入站总量划分等级。",
    toggleKey: "showTrafficRating",
    tierHint: "对应阶梯：≤10GB、≤50GB、≤200GB、>200GB",
  },
  {
    key: "bandwidth",
    title: "实时带宽徽章",
    scopeBadge: "右上角集群状态",
    description: "显示在右上角「集群状态」卡片顶部标题栏（状态健康旁），以呼吸灯徽章实时反馈集群总吞吐负荷。",
    toggleKey: "showBandwidthRating",
    tierHint: "对应阶梯：≤1Mbps、≤10Mbps、≤100Mbps、>100Mbps",
    isBadge: true,
  },
  {
    key: "asset",
    title: "资产概览",
    scopeBadge: "指标卡片底部",
    description: "显示在首页「资产总值」指标卡片右下角，依据折算人民币总资产规模划分等级。",
    toggleKey: "showAssetRating",
    tierHint: "对应阶梯：≤500元、≤1500元、≤3000元、>3000元",
  },
];

function sortTasks(tasks: PingTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    if (left.id !== right.id) return left.id - right.id;
    return left.name.localeCompare(right.name);
  });
}

function buildPremiumEntry(
  amount: number,
  paidCny?: number,
  acquiredAt?: string,
): CostPremiumEntry {
  return {
    amount,
    ...(paidCny != null ? { paidCny } : {}),
    ...(acquiredAt ? { acquiredAt } : {}),
  };
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
  });
}

function filterClients(clients: AdminClient[], rawKeyword: string) {
  const keyword = rawKeyword.trim().toLowerCase();
  if (!keyword) return clients;
  return clients.filter((client) => {
    const group = String(client.group || "").toLowerCase();
    const region = String(client.region || "").toLowerCase();
    return (
      client.name.toLowerCase().includes(keyword) ||
      client.uuid.toLowerCase().includes(keyword) ||
      group.includes(keyword) ||
      region.includes(keyword)
    );
  });
}

function summarizeNodes(
  uuids: string[],
  clientsById: Map<string, AdminClient>,
) {
  if (uuids.length === 0) return t("未绑定节点");
  const names = uuids.map((uuid) => clientsById.get(uuid)?.name || uuid);
  const summary = names.join("、");
  return summary.length > 92 ? `${summary.slice(0, 92)}...` : summary;
}

function pruneBindings(bindings: HomepagePingTaskBindings) {
  const normalized = normalizeHomepagePingTaskBindings(bindings);
  const pruned: HomepagePingTaskBindings = {};

  for (const [taskId, clients] of Object.entries(normalized)) {
    if (clients.length > 0) {
      pruned[taskId] = clients;
    }
  }

  return pruned;
}

function applyClientAssignment(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuid: string,
  checked: boolean,
) {
  const taskKey = String(taskId);
  const next = pruneBindings(bindings);

  for (const [currentTaskId, clients] of Object.entries(next)) {
    const filtered = clients.filter((uuid) => uuid !== clientUuid);
    if (filtered.length > 0) {
      next[currentTaskId] = filtered;
    } else {
      delete next[currentTaskId];
    }
  }

  if (checked) {
    const selected = next[taskKey] ?? [];
    next[taskKey] = Array.from(new Set([...selected, clientUuid])).sort((left, right) =>
      left.localeCompare(right),
    );
  }

  return next;
}

// 反查:client uuid → 所属 task id(字符串 key)。UI 保证每个 client 最多归属一个
// task,所以简单的后写覆盖 map 就是精确的。下面的「全选可用」reducer 和每次渲染的
// 可选节点过滤共用它,把「某 client 归属哪个 task」的推导收在一处。
function invertBindings(bindings: HomepagePingTaskBindings): Map<string, string> {
  const assignedTaskByClient = new Map<string, string>();
  for (const [taskId, clients] of Object.entries(bindings)) {
    for (const clientUuid of clients) {
      assignedTaskByClient.set(clientUuid, taskId);
    }
  }
  return assignedTaskByClient;
}

function applyAvailableClientAssignments(
  bindings: HomepagePingTaskBindings,
  taskId: number,
  clientUuids: string[],
) {
  const taskKey = String(taskId);
  const next = pruneBindings(bindings);
  const assignedTaskByClient = invertBindings(next);
  const selected = new Set(next[taskKey] ?? []);

  for (const clientUuid of clientUuids) {
    const assignedTaskId = assignedTaskByClient.get(clientUuid);
    if (assignedTaskId && assignedTaskId !== taskKey) continue;
    selected.add(clientUuid);
  }

  if (selected.size > 0) {
    next[taskKey] = [...selected].sort((left, right) => left.localeCompare(right));
  } else {
    delete next[taskKey];
  }

  return next;
}

// 本页托管设置的键清单唯一来源:草稿类型(ThemeDraft)、seed(draftFromSettings)与内容签名
// 都从它派生。新增一项设置只需在这里加一行,再到 JSX 里接 patch()。
// 刻意不标注返回类型:让推断给出全字段必填的具体类型,ThemeDraft 才能安全地 Omit/扩展。
function pickManagedThemeSettings(settings: ResolvedThemeSettings) {
  return {
    defaultLanguage: settings.defaultLanguage,
    defaultAppearance: settings.defaultAppearance,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    clusterOverviewMode: settings.clusterOverviewMode,
    matrixColorTheme: settings.matrixColorTheme,
    matrixBootEffect: settings.matrixBootEffect,
    pingLatencyThresholds: settings.pingLatencyThresholds,
    pingLatencyColors: settings.pingLatencyColors,
    pingLossThresholds: settings.pingLossThresholds,
    pingLossColors: settings.pingLossColors,
    trafficSpectrumColors: settings.trafficSpectrumColors,
    matrixMockFill: settings.matrixMockFill,
    matrixBootAnimation: settings.matrixBootAnimation,
    matrixCustomPattern: settings.matrixCustomPattern,
    matrixUserPresets: settings.matrixUserPresets,
    homepagePingBindings: settings.homepagePingBindings,
    enableHomepageMultiPing: settings.enableHomepageMultiPing,
    homepageLatencyDisplay: settings.homepageLatencyDisplay,
    homepageMultiPingTaskIds: settings.homepageMultiPingTaskIds,
    homepageNodePingSettings: settings.homepageNodePingSettings,
    fakePingForUnbound: settings.fakePingForUnbound,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    showRegionBar: settings.showRegionBar,
    showCardGroup: settings.showCardGroup,
    homeGroupOrder: settings.homeGroupOrder,
    enableHomeSort: settings.enableHomeSort,
    homeSortField: settings.homeSortField,
    homeSortDirection: settings.homeSortDirection,
    showCostSummary: settings.showCostSummary,
    showCostSummaryFloatingButton: settings.showCostSummaryFloatingButton,
    showTrafficPageButton: settings.showTrafficPageButton,
    showTrafficPageForGuests: settings.showTrafficPageForGuests,
    showPriceForGuests: settings.showPriceForGuests,
    showOverviewRatings: settings.showOverviewRatings,
    showTrafficRating: settings.showTrafficRating,
    showBandwidthRating: settings.showBandwidthRating,
    showAssetRating: settings.showAssetRating,
    trafficRatingLabels: settings.trafficRatingLabels,
    bandwidthRatingLabels: settings.bandwidthRatingLabels,
    assetRatingLabels: settings.assetRatingLabels,
    compactShowTrafficTotal: settings.compactShowTrafficTotal,
    compactShowBilling: settings.compactShowBilling,
    compactShowUptime: settings.compactShowUptime,
    showConnections: settings.showConnections,
    showTodayTrafficPopover: settings.showTodayTrafficPopover,
    hiddenNodes: settings.hiddenNodes,
    costIgnoredNodes: settings.costIgnoredNodes,
    // 按键排序:costPremiums 的键序随编辑历史漂移(删掉再加回同一键会排到最后),而 dirty /
    // reseed 判断都走 JSON.stringify 签名——不排序会把"内容相同、键序不同"误判成有未保存改动。
    costPremiums: Object.fromEntries(
      Object.keys(settings.costPremiums)
        .sort()
        .map((uuid) => [uuid, settings.costPremiums[uuid]]),
    ),
    costRateApiUrl: settings.costRateApiUrl,
  };
}

function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(pickManagedThemeSettings(normalizeThemeSettings(settings)));
}

type ManagedThemeSettings = ReturnType<typeof pickManagedThemeSettings>;

// 表单草稿:与托管设置同名同构,仅三处以「编辑态」存储——隐藏/忽略列表在表单里是多行文本
// (提交时再归一化回数组),三个评级名称合成按 kind 索引的对象(UI 按 OVERVIEW_RATING_LABEL_FIELDS
// 循环渲染)。其余字段直接透传,不维护第二份键清单。
type ThemeDraft = Omit<
  ManagedThemeSettings,
  | "hiddenNodes"
  | "costIgnoredNodes"
  | "trafficRatingLabels"
  | "bandwidthRatingLabels"
  | "assetRatingLabels"
> & {
  ratingLabels: Record<OverviewRatingKind, string>;
  hiddenNodesText: string;
  costIgnoredText: string;
};

// 服务端设置 → 表单草稿。reseed effect 和重置按钮都经 seedDrafts 走这里。
function draftFromSettings(settings: ResolvedThemeSettings): ThemeDraft {
  const {
    hiddenNodes,
    costIgnoredNodes,
    trafficRatingLabels,
    bandwidthRatingLabels,
    assetRatingLabels,
    ...rest
  } = pickManagedThemeSettings(settings);
  return {
    ...rest,
    ratingLabels: {
      traffic: trafficRatingLabels,
      bandwidth: bandwidthRatingLabels,
      asset: assetRatingLabels,
    },
    hiddenNodesText: hiddenNodes.join("\n"),
    costIgnoredText: costIgnoredNodes.join("\n"),
  };
}

type BooleanDraftKey = {
  [K in keyof ThemeDraft]: ThemeDraft[K] extends boolean ? K : never;
}[keyof ThemeDraft];

// 统一的「标题 + 说明 + 开关」行。memo + 稳定的 patch 引用:编辑无关字段的击键不再重渲这些行。
const ToggleRow = memo(function ToggleRow({
  field,
  title,
  desc,
  checked,
  onPatch,
}: {
  field: BooleanDraftKey;
  title: string;
  desc: string;
  checked: boolean;
  onPatch: (key: BooleanDraftKey, value: boolean) => void;
}) {
  useLanguage();
  return (
    <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-(--text-primary)">{title}</span>
        <span className="mt-1 block text-[11px] text-(--text-tertiary)">{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onPatch(field, event.target.checked)}
        className="h-4 w-4 shrink-0 accent-(--accent-500)"
      />
    </label>
  );
});

type ThemeTabId = "home" | "card" | "cost";

const THEME_TABS: ReadonlyArray<{
  id: ThemeTabId;
  label: string;
  hint: string;
  icon: typeof ListFilter;
}> = [
  { id: "home", label: "首页", hint: "外观、总览、权限与评级", icon: ListFilter },
  { id: "card", label: "服务器", hint: "视图、指标、排序、延迟与光柱", icon: Server },
  { id: "cost", label: "资产", hint: "财务汇率与买入溢价", icon: CircleDollarSign },
];

const DEFAULT_THEME_TAB: ThemeTabId = "home";

function isThemeTabId(value: string | null): value is ThemeTabId {
  return value != null && THEME_TABS.some((tab) => tab.id === value);
}

const BODY_BOTTOM_GAP = 2;
const MIN_BODY_HEIGHT = 320;

const EMPTY_ASSIGNED_CLIENTS: string[] = [];
const EMPTY_ADMIN_CLIENTS: AdminClient[] = [];

// 单个 Ping 任务的绑定卡片。memo:编辑无关设置的击键不再重渲任务列表;展开态的
// tasks×clients 复选网格只在绑定/搜索/展开变化时重算。
const TaskBindingSection = memo(function TaskBindingSection({
  task,
  assigned,
  expanded,
  clientsById,
  visibleClients,
  assignedTaskByClientUuid,
  nodeSearch,
  onNodeSearch,
  onToggleExpand,
  onPatchBindings,
}: {
  task: PingTask;
  assigned: string[];
  expanded: boolean;
  clientsById: Map<string, AdminClient>;
  visibleClients: AdminClient[];
  assignedTaskByClientUuid: Map<string, string>;
  nodeSearch: string;
  onNodeSearch: (value: string) => void;
  onToggleExpand: (taskId: number) => void;
  onPatchBindings: (
    updater: (prev: HomepagePingTaskBindings) => HomepagePingTaskBindings,
  ) => void;
}) {
  const t = useTranslate();
  const assignedSummary = summarizeNodes(assigned, clientsById);
  // 过滤只有展开的任务需要;收起的卡片跳过,搜索输入不再对每个任务做 O(clients) 扫描。
  const selectableVisibleClients = expanded
    ? visibleClients.filter((client) => {
        const assignedTaskId = assignedTaskByClientUuid.get(client.uuid);
        return !assignedTaskId || assignedTaskId === String(task.id);
      })
    : EMPTY_ADMIN_CLIENTS;
  const allVisibleSelectableAssigned =
    selectableVisibleClients.length > 0 &&
    selectableVisibleClients.every((client) => assigned.includes(client.uuid));
  return (
    <section className="surface-inset px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-(--text-primary)">
              {task.name || t("任务 #{0}", [task.id])}
            </h3>
            <span className="rounded-full border border-(--hairline) px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-(--text-tertiary)">
              {task.type || "icmp"}
            </span>
            <span className="rounded-full border border-(--hairline) px-2 py-0.5 text-[10px] font-medium text-(--text-tertiary)">
              {task.interval}s
            </span>
            <span className="rounded-full border border-(--hairline) px-2 py-0.5 text-[10px] font-medium text-(--text-tertiary)">
              ID {task.id}
            </span>
          </div>
          <div className="mt-2 text-[12px] text-(--text-secondary)">
            <span className="font-medium text-(--text-primary)">
              {t("已绑定")}{assigned.length} {t("个节点")}</span>
            <span className="mx-2 text-(--text-tertiary)">·</span>
            <span title={task.target || ""}>{task.target || t("未填写目标")}</span>
          </div>
          <p className="mt-2 text-[12px] text-(--text-tertiary)" title={assignedSummary}>
            {assignedSummary}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {expanded && (
            <button
              type="button"
              disabled={selectableVisibleClients.length === 0 || allVisibleSelectableAssigned}
              onClick={() => {
                onPatchBindings((prev) =>
                  applyAvailableClientAssignments(
                    prev,
                    task.id,
                    selectableVisibleClients.map((client) => client.uuid),
                  ),
                );
              }}
              className="theme-manage-button is-compact"
            >
              {allVisibleSelectableAssigned ? t("已全选可用") : t("全选可用")}
            </button>
          )}
          {assigned.length > 0 && (
            <button
              type="button"
              onClick={() => {
                onPatchBindings((prev) => {
                  const next = { ...prev };
                  delete next[String(task.id)];
                  return pruneBindings(next);
                });
              }}
              className="theme-manage-button is-compact is-danger"
            >
              {t("清空节点")}</button>
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggleExpand(task.id)}
            className="theme-manage-button is-compact"
          >
            {expanded ? t("收起节点") : t("编辑节点")}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-(--hairline) pt-4">
          <label className="surface-inset flex items-center gap-2 px-3 py-2">
            <Search size={14} className="text-(--text-tertiary)" />
            <input
              value={nodeSearch}
              onChange={(event) => onNodeSearch(event.target.value)}
              placeholder={t("搜索节点名称 / UUID / 分组 / 地区")}
              aria-label={t("搜索节点")}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--text-tertiary)"
            />
          </label>

          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {visibleClients.map((client) => {
              const checked = assigned.includes(client.uuid);
              const subtitle = [client.group, client.uuid].filter(Boolean).join(" · ");
              return (
                <label
                  key={client.uuid}
                  className={clsx(
                    "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors",
                    checked
                      ? "border-(--border-strong) bg-[color-mix(in_srgb,var(--hover-bg)_72%,transparent)]"
                      : "border-(--hairline) bg-transparent hover:bg-(--hover-bg)",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const nextChecked = event.target.checked;
                      onPatchBindings((prev) =>
                        applyClientAssignment(prev, task.id, client.uuid, nextChecked),
                      );
                    }}
                    className="mt-1 h-4 w-4 shrink-0 accent-(--accent-500)"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Flag region={client.region} size={14} />
                      <span className="truncate text-[13px] font-medium text-(--text-primary)">
                        {client.name}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-(--text-tertiary)">
                      {subtitle || client.region || t("未设置分组")}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
});

type PremiumDetail = ReturnType<typeof calculateCostSummary>["details"][number];

// 溢价录入列表。memo:编辑其他设置的击键不重渲整表——引用变化只来自
// costPremiums 切片、搜索结果与汇率加载态。
const PremiumList = memo(function PremiumList({
  clients,
  costPremiums,
  detailByUuid,
  rateLoading,
  acquiredAtMax,
  onPatchPaid,
  onPatchAcquiredAt,
}: {
  clients: AdminClient[];
  costPremiums: ThemeDraft["costPremiums"];
  detailByUuid: Map<string, PremiumDetail>;
  rateLoading: boolean;
  acquiredAtMax: string;
  onPatchPaid: (uuid: string, rawValue: string) => void;
  onPatchAcquiredAt: (uuid: string, rawValue: string) => void;
}) {
  const t = useTranslate();
  return (
    <div className="surface-inset max-h-80 overflow-y-auto">
      {clients.map((client) => {
        const entry = costPremiums[client.uuid];
        const detail = detailByUuid.get(client.uuid);
        const referenceLabel = rateLoading
          ? t("计算中")
          : detail
            ? detail.counted
              ? formatCnyMoney(detail.remainingCny)
              : detail.note || "--"
            : "--";
        const canCompute = detail != null && (detail.counted || detail.note === "免费");
        return (
          <div
            key={client.uuid}
            className="flex flex-col gap-2 border-b border-(--hairline) px-3 py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Flag region={client.region ?? ""} size={13} />
                <span
                  className="truncate text-[13px] text-(--text-primary)"
                  title={client.name}
                >
                  {client.name}
                </span>
              </div>
              <span
                className="shrink-0 text-[11px] text-(--text-tertiary)"
                title={t("该节点当前剩余价值（按账单周期折算，不含溢价）")}
              >
                {referenceLabel}
              </span>
              {entry && (
                <span
                  className="shrink-0 text-[11px] font-medium"
                  style={{
                    color:
                      entry.amount > 0
                        ? "var(--status-error)"
                        : entry.amount < 0
                          ? "var(--status-success)"
                          : "var(--text-tertiary)",
                  }}
                  title={
                    entry.paidCny != null
                      ? t("溢价 = 收购价 − 收购日剩余价值；该折算基准已经固化")
                      : t("旧格式：直接记录的溢价，填写收购价后自动升级")
                  }
                >
                  {t("溢价")}{formatSignedCny(entry.amount)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2 max-sm:w-full">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={entry?.paidCny ?? ""}
                onChange={(event) => {
                  // 键入 `-`/`e` 等非法中间态时 value 为空串,不能误当"留空即清除"删掉记录。
                  if (event.target.validity.badInput) return;
                  onPatchPaid(client.uuid, event.target.value);
                }}
                placeholder={t("收购价")}
                disabled={!canCompute}
                aria-label={t("{0} 的收购价", [client.name])}
                title={
                  canCompute
                    ? t("实际收购价（人民币），留空即清除记录")
                    : t("该节点已忽略或汇率缺失，无法折算剩余价值")
                }
                className="surface-inset w-24 px-2 py-1 text-right text-[13px] outline-none disabled:opacity-45 max-sm:flex-1 min-w-0"
              />
              <input
                type="date"
                max={acquiredAtMax}
                value={entry?.acquiredAt ?? ""}
                onChange={(event) => onPatchAcquiredAt(client.uuid, event.target.value)}
                // 与收购价同门槛:汇率/基准未就绪时 patchPremiumAcquiredAt 无法回算,
                // 放开输入只会被静默丢弃(受控值弹回旧日期)。
                disabled={!entry || !canCompute}
                aria-label={t("{0} 的收购日期", [client.name])}
                title={
                  canCompute
                    ? t("收购日期：修改后会按当前价格、周期、到期日和汇率回算该日剩余价值，重新计算并固化溢价")
                    : t("该节点已忽略或汇率缺失，无法折算剩余价值")
                }
                className="surface-inset w-35 px-2 py-1 text-[12px] outline-none disabled:opacity-45 max-sm:flex-1 min-w-0"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

export function ThemeManage() {
  const t = useTranslate();
  const now = useHourlyClock();
  const {
    data: config,
    isLoading: configLoading,
    error: configError,
    refetch: refetchConfig,
  } = usePublicConfig();
  // 全部托管设置收敛为单个草稿对象。之前是 30 个平行 useState,每新增一项设置要同步维护
  // 声明/seedDrafts/payload/依赖数组四处清单;现在键清单只在 pickManagedThemeSettings 一处。
  const [draft, setDraft] = useState<ThemeDraft>(() =>
    draftFromSettings(DEFAULT_THEME_SETTINGS),
  );
  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null);
  const [taskSearch, setTaskSearch] = useState("");
  const [nodeSearch, setNodeSearch] = useState("");
  const [premiumSearch, setPremiumSearch] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: ThemeTabId = tabParam === "ping" ? "card" : isThemeTabId(tabParam) ? tabParam : DEFAULT_THEME_TAB;
  const bodyRef = useRef<HTMLDivElement>(null);
  const sectionsRef = useRef<HTMLDivElement>(null);

  const openTab = useCallback(
    (next: ThemeTabId) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set("tab", next);
          return params;
        },
        { replace: true },
      );
      if (window.innerWidth >= 900) {
        sectionsRef.current?.scrollTo({ top: 0 });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = () => {
      if (window.innerWidth < 900) {
        element.style.removeProperty("--theme-body-height");
        return;
      }
      const rect = element.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      const main = element.closest("main");
      let padBottom = 0;
      for (
        let node: HTMLElement | null = element.parentElement;
        node && main && (node === main || main.contains(node));
        node = node.parentElement
      ) {
        const style = window.getComputedStyle(node);
        padBottom +=
          parseFloat(style.paddingBottom || "0") + parseFloat(style.borderBottomWidth || "0");
        if (node === main) break;
      }
      const footerHeight =
        document.querySelector(".site-footer")?.getBoundingClientRect().height ?? 0;
      const available = window.innerHeight - top - footerHeight - padBottom - BODY_BOTTOM_GAP;
      element.style.setProperty("--theme-body-height", `${Math.max(MIN_BODY_HEIGHT, available)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    const topbar = document.querySelector(".theme-topbar") || document.querySelector(".theme-masthead");
    const footer = document.querySelector(".site-footer");
    if (topbar) observer.observe(topbar);
    if (footer) observer.observe(footer);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);

  // 右上角悬浮气泡 Toast（fixed 脱离文档流，0 挤动页面布局，3 秒自动淡出）
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }, []);
  const savingDraftRef = useRef<ThemeDraft | null>(null);
  const editVersionRef = useRef(0);

  // 单字段更新收口,所有表单控件都走它。值未变时原样返回 prev,保留旧的独立 useState
  // 在同值 set 时不触发重渲染的行为。
  const patch = useCallback(
    <K extends keyof ThemeDraft>(key: K, value: ThemeDraft[K]) => {
      editVersionRef.current += 1;
      setDraft((prev) => (Object.is(prev[key], value) ? prev : { ...prev, [key]: value }));
    },
    [],
  );
  // 绑定关系的三个入口(勾选/全选/清空)都是基于前值的函数式更新,单独收口。
  const patchBindings = useCallback(
    (updater: (prev: HomepagePingTaskBindings) => HomepagePingTaskBindings) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        homepagePingBindings: updater(prev.homepagePingBindings),
      }));
    },
    [],
  );
  const patchPingLatencyThreshold = useCallback(
    (key: keyof PingLatencyThresholds, val: number) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        pingLatencyThresholds: {
          ...prev.pingLatencyThresholds,
          [key]: val,
        },
      }));
    },
    [],
  );

  const patchPingLatencyColor = useCallback(
    (key: keyof PingLatencyColors, hex: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        pingLatencyColors: {
          ...prev.pingLatencyColors,
          [key]: hex,
        },
      }));
    },
    [],
  );

  const resetPingLatency = useCallback(() => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      pingLatencyThresholds: DEFAULT_PING_LATENCY_THRESHOLDS,
      pingLatencyColors: DEFAULT_PING_LATENCY_COLORS,
    }));
  }, []);

  const patchPingLossThreshold = useCallback(
    (key: keyof PingLossThresholds, val: number) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        pingLossThresholds: {
          ...prev.pingLossThresholds,
          [key]: val,
        },
      }));
    },
    [],
  );

  const patchPingLossColor = useCallback(
    (key: keyof PingLossColors, hex: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        pingLossColors: {
          ...prev.pingLossColors,
          [key]: hex,
        },
      }));
    },
    [],
  );

  const resetPingLoss = useCallback(() => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      pingLossThresholds: DEFAULT_PING_LOSS_THRESHOLDS,
      pingLossColors: DEFAULT_PING_LOSS_COLORS,
    }));
  }, []);

  const patchTrafficSpectrumColor = useCallback(
    (key: keyof TrafficSpectrumColors, hex: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => ({
        ...prev,
        trafficSpectrumColors: {
          ...prev.trafficSpectrumColors,
          [key]: hex,
        },
      }));
    },
    [],
  );

  const applyStatusBarPreset = useCallback((preset: StatusBarPreset) => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      trafficSpectrumColors: { ...preset.colors },
      pingLatencyColors: { ...preset.latencyColors },
      pingLossColors: { ...preset.lossColors },
    }));
  }, []);

  const resetTrafficSpectrum = useCallback(() => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      trafficSpectrumColors: DEFAULT_TRAFFIC_SPECTRUM_COLORS,
    }));
  }, []);

  const previewTrafficSegmentColors = useMemo(
    () => buildTrafficQuotaSegmentColors(draft.trafficSpectrumColors),
    [draft.trafficSpectrumColors],
  );

  const toggleTaskExpanded = useCallback((taskId: number) => {
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
    setNodeSearch("");
  }, []);

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: ({ signal }) => getAdminPingTasks({ signal }),
    staleTime: 30_000,
    retry: false,
  });
  const {
    data: adminClients,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: ({ signal }) => getAdminClients({ signal }),
    staleTime: 30_000,
    retry: false,
  });

  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  // 按内容判断服务端设置是否真的变化，避免同内容 refetch 重置草稿。
  const sourceSignature = useMemo(
    () => JSON.stringify(pickManagedThemeSettings(sourceThemeSettings)),
    [sourceThemeSettings],
  );
  const lastSeededSignatureRef = useRef<string | null>(null);

  // 把服务端设置灌入草稿的唯一出口,reseed effect 和重置按钮都走它,避免两边逻辑漂移。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    setDraft(draftFromSettings(next));
  }, []);

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const sortedClients = useMemo(() => sortClients(adminClients ?? []), [adminClients]);
  const clientsById = useMemo(
    () => new Map(sortedClients.map((client) => [client.uuid, client])),
    [sortedClients],
  );

  // 后端实际存在的分组,按首页 Tab 的渲染顺序排列(已配置的在前,未排序的在后)。
  // 用户直接拖动这个列表来调整顺序。
  const availableGroups = useMemo(
    () => dedupeGroupLabels(sortedClients.map((client) => client.group)),
    [sortedClients],
  );
  const orderedDraftGroups = useMemo(
    () => sortHomeGroupOptions(availableGroups, draft.homeGroupOrder),
    [availableGroups, draft.homeGroupOrder],
  );
  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    patch("homeGroupOrder", next);
  };

  const filteredTasks = useMemo(() => {
    const keyword = taskSearch.trim().toLowerCase();
    if (!keyword) return sortedTasks;
    return sortedTasks.filter((task) => {
      return (
        task.name.toLowerCase().includes(keyword) ||
        String(task.id).includes(keyword) ||
        task.type.toLowerCase().includes(keyword) ||
        task.target.toLowerCase().includes(keyword)
      );
    });
  }, [sortedTasks, taskSearch]);

  const multiPingSlotLimit = Math.min(
    HOMEPAGE_MULTI_PING_MAX_COUNT,
    Math.max(sortedTasks.length, HOMEPAGE_MULTI_PING_MIN_COUNT),
  );

  const commitMultiPingTaskIds = useCallback(
    (updater: (current: number[]) => number[]) => {
      editVersionRef.current += 1;
      setDraft((prev) => {
        const nextIds = normalizeHomepageMultiPingTaskIds(updater(prev.homepageMultiPingTaskIds));
        return JSON.stringify(nextIds) === JSON.stringify(prev.homepageMultiPingTaskIds)
          ? prev
          : { ...prev, homepageMultiPingTaskIds: nextIds };
      });
    },
    [],
  );

  const patchMultiPingTask = useCallback(
    (slot: number, rawValue: string) => {
      if (rawValue === "") return;
      const parsedId = Number(rawValue);
      if (!Number.isSafeInteger(parsedId) || parsedId <= 0) return;
      commitMultiPingTaskIds((current) => assignHomepageMultiPingTask(current, slot, parsedId));
    },
    [commitMultiPingTaskIds],
  );

  const removeMultiPingTask = useCallback(
    (slot: number) => {
      commitMultiPingTaskIds((current) => {
        const next = [...current];
        next.splice(slot, 1);
        return next;
      });
    },
    [commitMultiPingTaskIds],
  );

  const addMultiPingTask = useCallback(() => {
    commitMultiPingTaskIds((current) => {
      if (current.length >= HOMEPAGE_MULTI_PING_MAX_COUNT) return current;
      const availableTask = sortedTasks.find((task) => !current.includes(task.id));
      if (!availableTask) return current;
      return [...current, availableTask.id];
    });
  }, [commitMultiPingTaskIds, sortedTasks]);

  const location = useLocation();
  const toHome = useMemo(() => {
    const params = new URLSearchParams(location.search);
    params.delete("view");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }, [location.search]);

  const visibleClients = useMemo(
    () => filterClients(sortedClients, nodeSearch),
    [nodeSearch, sortedClients],
  );
  const filteredPremiumClients = useMemo(
    () => filterClients(sortedClients, premiumSearch),
    [premiumSearch, sortedClients],
  );

  // 溢价表格里"当前剩余价值"仅供参考,用已保存的汇率源/忽略名单算(不用草稿里还没保存的
  // 编辑),口径与资产统计页完全一致(同一个 calculateCostSummary),但不叠加溢价本身。
  // 刻意用一次性 getNodes 查询而不是 useAllNodeMeta():后者会启动全局节点 store 的实时
  // 状态轮询(wsStore),设置页只需要静态 meta,不该为一列参考值挂一个常驻轮询。
  const { data: allMeta = [] } = useQuery({
    queryKey: ["theme-manage", "node-meta"],
    queryFn: ({ signal }) => getNodes({ signal }),
    staleTime: 60_000,
    retry: 1,
  });
  const premiumRateQuery = useQuery({
    queryKey: ["cost-rates", sourceThemeSettings.costRateApiUrl],
    queryFn: ({ signal }) => getExchangeRates(sourceThemeSettings.costRateApiUrl, { signal }),
    staleTime: 60 * 60 * 1000,
    enabled: allMeta.length > 0,
    retry: 1,
  });
  const premiumDetailByUuid = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculateCostSummary>["details"][number]>();
    if (!premiumRateQuery.data) return map;
    const summary = calculateCostSummary(
      allMeta,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data.rates,
      undefined,
      now,
    );
    for (const detail of summary.details) map.set(detail.uuid, detail);
    return map;
  }, [allMeta, now, sourceThemeSettings.costIgnoredNodes, premiumRateQuery.data]);

  // 使用当前价格、周期、到期日和汇率回算指定收购日的剩余价值；结果只在用户编辑
  // 收购价/日期时用于固化溢价，不会因后续续费或汇率变化自动改写。
  const premiumBasisAt = useCallback(
    (uuid: string, acquiredAt?: string): number | null => {
      if (!premiumRateQuery.data) return null;
      if (!acquiredAt || acquiredAt === localDateInputMax()) {
        const detail = premiumDetailByUuid.get(uuid);
        if (!detail) return null;
        if (detail.note === "免费") return 0;
        return detail.counted ? detail.remainingCny : null;
      }
      return calculateCostPremiumBasisAt(
        allMeta,
        sourceThemeSettings.costIgnoredNodes,
        premiumRateQuery.data.rates,
        uuid,
        acquiredAt,
        now,
      );
    },
    [
      allMeta,
      now,
      premiumDetailByUuid,
      sourceThemeSettings.costIgnoredNodes,
      premiumRateQuery.data,
    ],
  );

  const premiumConfiguredCount = useMemo(
    () => Object.keys(draft.costPremiums).length,
    [draft.costPremiums],
  );

  // 收购价清空即删条目；溢价按收购日的回算剩余价值算出并固化，不随后续续费/汇率漂移。
  const patchPremiumPaid = useCallback(
    (uuid: string, rawValue: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => {
        const next = { ...prev.costPremiums };
        if (rawValue.trim() === "") {
          if (!(uuid in next)) return prev;
          delete next[uuid];
          return { ...prev, costPremiums: next };
        }
        const paid = Number(rawValue);
        if (!Number.isFinite(paid) || paid < 0) return prev;
        const current = prev.costPremiums[uuid];
        if (current && Object.is(current.paidCny, paid)) return prev;
        const acquiredAt = current?.acquiredAt ?? localDateInputMax();
        const storedBasis =
          current?.paidCny != null ? current.paidCny - current.amount : Number.NaN;
        const basis = Number.isFinite(storedBasis)
          ? storedBasis
          : premiumBasisAt(uuid, acquiredAt);
        if (basis == null) return prev;
        next[uuid] = buildPremiumEntry(
          calculateCostPremiumAmount(paid, basis, current),
          paid,
          acquiredAt,
        );
        return { ...prev, costPremiums: next };
      });
    },
    [premiumBasisAt],
  );

  // 主动修改收购日期时重新回算该日剩余价值并固化新溢价；保存后仍保持固定。
  const patchPremiumAcquiredAt = useCallback(
    (uuid: string, rawValue: string) => {
      editVersionRef.current += 1;
      setDraft((prev) => {
        const current = prev.costPremiums[uuid];
        if (!current) return prev;
        const acquiredAt = rawValue.trim() || undefined;
        if (current.acquiredAt === acquiredAt) return prev;
        let amount = current.amount;
        if (acquiredAt && current.paidCny != null) {
          const basis = premiumBasisAt(uuid, acquiredAt);
          if (basis == null) return prev;
          amount = calculateCostPremiumAmount(current.paidCny, basis);
        }
        const next = { ...prev.costPremiums };
        next[uuid] = buildPremiumEntry(amount, current.paidCny, acquiredAt);
        return { ...prev, costPremiums: next };
      });
    },
    [premiumBasisAt],
  );

  const draftHiddenNodes = useMemo(
    () => normalizeNodeIdentityList(draft.hiddenNodesText),
    [draft.hiddenNodesText],
  );
  const draftCostRateApiUrlInvalid =
    draft.costRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draft.costRateApiUrl.trim());
  const latencyBounds = Object.values(draft.pingLatencyThresholds);
  const draftStatusInvalid = !latencyBounds.every((value, index) => Number.isFinite(value) && value >= 1 && Number.isInteger(value) && (index === 0 || value > latencyBounds[index - 1]))
    || !Number.isFinite(draft.pingLossThresholds.low) || !Number.isFinite(draft.pingLossThresholds.medium)
    || draft.pingLossThresholds.low <= 0 || draft.pingLossThresholds.medium <= draft.pingLossThresholds.low || draft.pingLossThresholds.medium > 100;
  const draftNodePingInvalid = Object.values(draft.homepageNodePingSettings).some(
    (setting) => setting.mode === "custom" && setting.taskIds.length === 0,
  );

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。草稿字段与设置同名,这里只做
  // 「编辑态 → 存储态」的换形与归一化;文本域(hiddenNodesText/costIgnoredText)和 ratingLabels
  // 解构出来换回存储字段,其余原样透传。
function draftToThemeSettings(targetDraft: ThemeDraft): ThemeSettings {
  const {
    ratingLabels,
    hiddenNodesText,
    costIgnoredText,
    ...rest
  } = targetDraft;
  return {
    ...rest,
    homepagePingBindings: pruneBindings(rest.homepagePingBindings),
    pingLatencyThresholds: normalizePingLatencyThresholds(rest.pingLatencyThresholds),
    pingLatencyColors: normalizePingLatencyColors(rest.pingLatencyColors),
    pingLossThresholds: normalizePingLossThresholds(rest.pingLossThresholds),
    pingLossColors: normalizePingLossColors(rest.pingLossColors),
    trafficSpectrumColors: normalizeTrafficSpectrumColors(rest.trafficSpectrumColors),

    homeGroupOrder: normalizeHomeGroupOrder(rest.homeGroupOrder),
    trafficRatingLabels: ratingLabels.traffic,
    bandwidthRatingLabels: ratingLabels.bandwidth,
    assetRatingLabels: ratingLabels.asset,
    hiddenNodes: normalizeNodeIdentityList(hiddenNodesText),
    costIgnoredNodes: normalizeCostIgnoredNodes(costIgnoredText),
    costPremiums: normalizeCostPremiums(rest.costPremiums),
    costRateApiUrl: normalizeCostRateApiUrl(rest.costRateApiUrl),
  };
}

  const draftThemeSettings = useMemo<ThemeSettings>(
    () => draftToThemeSettings(draft),
    [draft],
  );

  // 只比较本页实际管理的设置。enableAdminButton/showPingChart 这类隐藏设置会通过
  // baseSettings 在保存时保留,但不该让表单永远显示为 dirty。
  const draftSignature = useMemo(
    () => managedSettingsSignature(draftThemeSettings as ThemeSettings & Record<string, unknown>),
    [draftThemeSettings],
  );
  // draftSignature 用的是归一化后的 cost-rate URL,非法输入会被收敛回默认值,于是非法输入
  // 不会被判为 dirty,用户既无法保存也无法重置出来。所以单独跟踪原始文本,让编辑始终把表单
  // 标为 dirty(重置可用),而保存按钮再额外按合法性把关(见下文)。
  const costRateApiUrlDirty =
    draft.costRateApiUrl.trim() !== sourceThemeSettings.costRateApiUrl;
  const isDirty =
    draftSignature !== sourceSignature ||
    costRateApiUrlDirty;

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  // 服务端设置真正变化时灌入草稿。首次灌入之后,只要表单有未保存编辑(含保存中)就跳过,
  // 避免 refetch / 其他端保存的回流静默覆盖用户草稿。
  useEffect(() => {
    if (!config) return;
    if (lastSeededSignatureRef.current === sourceSignature) return;
    if (lastSeededSignatureRef.current !== null && isDirty) return;
    lastSeededSignatureRef.current = sourceSignature;
    seedDrafts(sourceThemeSettings);
  }, [config, isDirty, sourceSignature, sourceThemeSettings, seedDrafts]);


  // 每个 client 归属哪个 task 的反查,只在绑定草稿变化时重建。与「全选可用」reducer
  // 共用 invertBindings() 避免推导漂移,并把可选节点过滤保持在 O(tasks × clients),
  // 而不是每个 client 都重扫一遍 bindings。
  const assignedTaskByClientUuid = useMemo(
    () => invertBindings(draft.homepagePingBindings),
    [draft.homepagePingBindings],
  );

  const handleSave = async (overrideDraft?: Partial<ThemeDraft>) => {
    if (
      !config?.theme ||
      savingDraftRef.current ||
      draftCostRateApiUrlInvalid ||
      draftNodePingInvalid || draftStatusInvalid
    ) {
      return;
    }
    const currentDraft = overrideDraft ? { ...draft, ...overrideDraft } : draft;
    if (overrideDraft) {
      setDraft(currentDraft);
    }
    const currentDraftThemeSettings = draftToThemeSettings(currentDraft);
    const submittedEditVersion = editVersionRef.current;
    savingDraftRef.current = currentDraft;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const nextSettings: ThemeSettings & Record<string, unknown> = {
        ...(config.theme_settings ?? {}),
        ...currentDraftThemeSettings,
      };
      const savePromise = saveThemeSettings(config.theme, nextSettings);
      const minDelayPromise = new Promise((resolve) => setTimeout(resolve, 260));
      await Promise.all([savePromise, minDelayPromise]);
      lastSeededSignatureRef.current = managedSettingsSignature(nextSettings);
      await queryClient.invalidateQueries({ queryKey: ["public"] });
      if (editVersionRef.current === submittedEditVersion) setMessage(null);
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        showToast(t("保存失败：管理员未登录或凭据已失效"));
        setAccessRevoked(true);
        throw saveError;
      }
      showToast(saveError instanceof Error ? saveError.message : t("保存失败"));
      setError(saveError instanceof Error ? saveError.message : t("保存失败"));
      throw saveError;
    } finally {
      savingDraftRef.current = null;
      setSaving(false);
    }
  };

  const autoSaveInvalid = draftCostRateApiUrlInvalid || draftNodePingInvalid || draftStatusInvalid;
  const autoSave = useAutoSave({
    value: draft,
    signature: draftSignature,
    enabled: Boolean(config?.theme && !accessRevoked && isDirty && editVersionRef.current > 0),
    invalid: autoSaveInvalid,
    save: handleSave,
  });
  const autoSaveLabel = autoSaveInvalid ? t("请完成当前设置") : autoSave.phase === "error" ? t("同步失败，点击重试")
    : autoSave.phase === "saving" ? t("正在同步") : autoSave.phase === "waiting" ? t("等待同步")
      : autoSave.phase === "saved" ? t("已同步") : t("自动保存");

  const handleReset = () => {
    seedDrafts(sourceThemeSettings);
    setMessage(null);
    setError(null);
    setResetting(true);
    showToast(t("主题设置已重置"));
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setResetting(false);
    }, 450);
  };

  if (configLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div role="alert" className="space-y-2">
          <div className="text-[15px] font-semibold text-(--text-primary)">
            {t("无法读取主题配置")}</div>
          <p className="max-w-lg text-[13px] text-(--text-secondary)">
            {configError instanceof Error ? configError.message : t("请稍后重试。")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => void refetchConfig()}
            className="control-button px-4 py-2 text-[13px] font-medium"
          >
            {t("重试")}</button>
          <Link to={toHome} className="control-button px-4 py-2 text-[13px] font-medium">
            {t("返回首页")}</Link>
        </div>
      </div>
    );
  }

  if (accessRevoked) {
    return <Navigate to="/" replace />;
  }

  const adminAccessDenied =
    (tasksError instanceof ApiRequestError &&
      (tasksError.status === 401 || tasksError.status === 403)) ||
    (clientsError instanceof ApiRequestError &&
      (clientsError.status === 401 || clientsError.status === 403));

  if (adminAccessDenied) {
    return <Navigate to="/" replace />;
  }

  const adminError =
    (tasksError instanceof Error ? tasksError.message : null) ||
    (clientsError instanceof Error ? clientsError.message : null);
  const noTasksYet = !tasksLoading && !clientsLoading && sortedTasks.length === 0;
  const noFilteredTaskMatch = !tasksLoading && !clientsLoading && !noTasksYet && filteredTasks.length === 0;
  const setRatingLabelDraft = (kind: OverviewRatingKind, value: string) => {
    editVersionRef.current += 1;
    setDraft((prev) => ({
      ...prev,
      ratingLabels: { ...prev.ratingLabels, [kind]: value },
    }));
  };
  const acquiredAtMax = localDateInputMax();

  return (
    <div className="theme-manage flex flex-col gap-5 py-2">
      {/* 右上角悬浮气泡 Toast（fixed 绝对定位，绝不挤压页面任何布局，3秒自动淡出） */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-5 right-5 z-9999 flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-2xl border border-emerald-500/35 bg-(--bg-card)/95 backdrop-blur-md text-xs font-semibold text-emerald-600 dark:text-emerald-400 pointer-events-auto"
        >
          <span className="flex h-2 w-2 relative shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-1 text-(--text-muted) hover:text-(--text-primary) transition-colors text-xs leading-none"
            title={t("关闭通知")}
          >
            ✕
          </button>
        </div>
      )}

      <header className="theme-topbar">
        <Link to={toHome} aria-label={t("返回首页")} className="instance-page-back theme-topbar-back">
          <ArrowLeft size={14} />
          <span>{t("返回首页")}</span>
        </Link>
        <h1 className="theme-topbar-title">{t("主题设置")}</h1>
        <div className="theme-manage-toolbar-actions">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || resetting}
            className="theme-manage-button is-compact min-w-17 justify-center"
          >
            <RefreshCw size={14} className={resetting ? "animate-spin" : ""} />
            <span>{t("重置")}</span>
          </button>
          <button
            type="button"
            onClick={autoSave.retry}
            disabled={
              saving ||
              draftCostRateApiUrlInvalid ||
              draftNodePingInvalid || draftStatusInvalid
            }
            className="theme-manage-button is-compact is-primary min-w-23 justify-center"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            <span>{autoSaveLabel}</span>
          </button>
        </div>
      </header>

      {(message || error || adminError) && (
        <div className="flex flex-col gap-3">
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-online)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-online)"
            >
              {message}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-offline)"
            >
              {error}
            </div>
          )}
          {adminError && (
            <div
              role="alert"
              className="rounded-xl border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-(--status-offline)"
            >
              {t("无法读取后台 Ping 任务或节点列表:")}{adminError}
            </div>
          )}
        </div>
      )}

            <div className="theme-manage-body" ref={bodyRef}>
        <nav className="theme-tab-rail" aria-label={t("设置分组")}>
          {THEME_TABS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => openTab(id)}
              data-active={activeTab === id ? "true" : "false"}
              aria-current={activeTab === id ? "page" : undefined}
              className="theme-tab"
            >
              <Icon size={14} className="theme-tab-icon" />
              <span className="theme-tab-label">{t(label)}</span>
              <span className="theme-tab-hint">{t(hint)}</span>
            </button>
          ))}
        </nav>

        <div className="theme-manage-sections" ref={sectionsRef}>
          {activeTab === "home" && (<>
<InstancePanel
                kicker={t("外观")}
                title={t("默认外观")}
                aside={<LayoutTemplate size={16} />}
              >
                <div className="instance-segmented is-prominent is-even">
                  {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      data-active={draft.defaultAppearance === value ? "true" : "false"}
                      aria-pressed={draft.defaultAppearance === value}
                      onClick={() => patch("defaultAppearance", value)}
                      className="inline-flex items-center justify-center gap-2"
                    >
                      <Icon size={14} />
                      <span>{t(label)}</span>
                    </button>
                  ))}
                </div>
              </InstancePanel>

<InstancePanel kicker={t("语言")} title={t("默认语言")}>
                <SettingSelect value={draft.defaultLanguage} aria-label={t("默认语言")}
                  onChange={(event) => patch("defaultLanguage", event.target.value as Language)}>
                  {LANGUAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
                </SettingSelect>
                <p className="setting-hint">{t("未选择语言的访客使用此设置；首页语言按钮可覆盖站点默认。")}</p>
              </InstancePanel>

<InstancePanel kicker={t("延迟")} title={t("首页延迟显示模式")}>
                <div className="instance-segmented is-prominent is-even" role="group" aria-label={t("首页延迟显示模式")}>
                  {([{ value: "bars", label: "方块" }, { value: "curve", label: "曲线" }] as const).map(({ value, label }) => (
                    <button key={value} type="button"
                      data-active={draft.homepageLatencyDisplay === value ? "true" : "false"}
                      aria-pressed={draft.homepageLatencyDisplay === value}
                      onClick={() => patch("homepageLatencyDisplay", value)}>{t(label)}</button>
                  ))}
                </div>
                <p className="setting-hint">{t("切换首页延迟的方块或曲线显示，沿用当前阈值与配色。悬停或点按曲线可查看时段延迟与丢包率。")}</p>
              </InstancePanel>

<InstancePanel
                kicker={t("顶部")}
                title={t("首页顶部组件")}
                aside={<ListFilter size={16} />}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <ToggleRow
                    field="showHomeOverview"
                    title={t("显示顶部总览栏")}
                    desc={t("在首页顶部显示实时带宽、平均负载、内存用量、硬盘用量、今日流量与资产看板。")}
                    checked={draft.showHomeOverview}
                    onPatch={patch}
                  />
                  <ToggleRow
                    field="showGroupTabs"
                    title={t("显示分组筛选栏")}
                    desc={t("在卡片列表上方展示分组 Tab 快速筛选。")}
                    checked={draft.showGroupTabs}
                    onPatch={patch}
                  />
                  <ToggleRow
                    field="showRegionBar"
                    title={t("显示地区筛选栏")}
                    desc={t("在卡片列表上方展示国旗地区快捷标签。")}
                    checked={draft.showRegionBar}
                    onPatch={patch}
                  />
                </div>
              </InstancePanel>

<InstancePanel
                kicker={t("入口")}
                title={t("卡片扩展入口与访客权限")}
                aside={<Compass size={16} />}
              >
                <div className="flex flex-col gap-4">
                  <div>
                    <span className="setting-subhead-title block mb-2">{t("卡片操作入口")}</span>
                    <div className="grid gap-3 md:grid-cols-3">
                      <ToggleRow
                        field="showTrafficPageButton"
                        title={t("显示今日流量页入口按钮")}
                        desc={t("在首页今日流量卡片右上角显示进入流量统计页的图表按钮。若希望未登录访客也能看到该按钮，请同步开启下方的「向访客显示流量入口按钮」。")}
                        checked={draft.showTrafficPageButton}
                        onPatch={patch}
                      />
                      <ToggleRow
                        field="showCostSummary"
                        title={t("显示资产统计页入口按钮")}
                        desc={t("在首页资产总值卡片右上角显示进入资产统计页的钱币图标按钮。注意：若未开启下方的「向访客公开价格与资产」，该按钮仅管理员登录后可见，访客端将自动联动隐藏以保护财务隐私。")}
                        checked={draft.showCostSummary}
                        onPatch={patch}
                      />
                      <ToggleRow
                        field="showCostSummaryFloatingButton"
                        title={t("显示资产看板悬浮按钮")}
                        desc={t("备用悬浮入口（显示在页面右下角）：为避免入口重复，仅在关闭了「资产总值」卡片右上角钱币按钮、或关闭了「显示顶部总览栏」时生效浮现。同样需管理员登录或开启「向访客公开价格与资产」后才会呈现。")}
                        checked={draft.showCostSummaryFloatingButton}
                        onPatch={patch}
                      />
                    </div>
                  </div>

                  <div className="border-t border-(--border-subtle) pt-3">
                    <span className="setting-subhead-title block mb-2">{t("访客公开与可见性权限")}</span>
                    <div className="grid gap-3 md:grid-cols-2">
                      <ToggleRow
                        field="showTrafficPageForGuests"
                        title={t("向访客显示流量入口按钮")}
                        desc={t("默认关闭。仅在上方开启了「显示今日流量页入口按钮」时对访客生效。关闭时未登录访客隐藏图表按钮，保持卡片无图标统一纯净；开启后访客亦可在卡片右上角点击进入流量统计页。")}
                        checked={draft.showTrafficPageForGuests}
                        onPatch={patch}
                      />
                      <ToggleRow
                        field="showPriceForGuests"
                        title={t("向访客公开价格与资产")}
                        desc={t("默认关闭。独立控制财务数据是否对访客脱敏：开启后访客可查看节点价格标签与资产总额（若上方开启了入口按钮则一并解锁访客跳转）；关闭时对访客隐藏价格标签，资产总值显示为保密。无论上方入口按钮是否开启，均可独立配置此项。")}
                        checked={draft.showPriceForGuests}
                        onPatch={patch}
                      />
                    </div>
                  </div>
                </div>
              </InstancePanel>

<InstancePanel
                id="set-cluster-overview-mode"
                kicker={t("集群")}
                title={t("集群状态展示模式")}
                aside={<Activity size={16} />}
              >
                <p className="text-xs text-(--text-muted) mb-3 leading-relaxed">
                  {t("设置首页右侧「集群状态」核心卡片的展示模式。")}</p>
                <div className="setting-mode-cards">
                  {[
                    {
                      value: "classic" as const,
                      label: t("经典布局"),
                      desc: t("上方展示节点在线率与状态条，下方展示实时上下行带宽双曲线图，适用于全面综合监控。"),
                      icon: Layers,
                    },
                    {
                      value: "nodes" as const,
                      label: t("方格矩阵"),
                      desc: t("整屏展示机架式方格矩阵，专注排查每台机器的负载与健康状态，适用于节点排查与大集群。"),
                      icon: LayoutGrid,
                    },
                  ].map(({ value, label, desc, icon: ModeIcon }) => {
                    const isActive = (draft.clusterOverviewMode ?? "classic") === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => patch("clusterOverviewMode", value)}
                        data-active={isActive ? "true" : "false"}
                        aria-pressed={isActive}
                        className="setting-mode-card"
                      >
                        <div className="setting-mode-card-head">
                          <div className="setting-mode-card-title">
                            <ModeIcon size={15} />
                            <span>{t(label)}</span>
                          </div>
                          <div className="setting-mode-card-radio" aria-hidden="true">
                            <div className="setting-mode-card-radio-dot" />
                          </div>
                        </div>
                        <div className="setting-mode-card-desc">{desc}</div>
                      </button>
                    );
                  })}
                </div>
              </InstancePanel>

{draft.clusterOverviewMode === "nodes" && (
                <InstancePanel
                  id="set-matrix-settings"
                  kicker={t("矩阵")}
                  title={t("矩阵定制")}
                  aside={<LayoutGrid size={16} />}
                >
                  {/* 1. 矩阵配色风格切换（经典标准 vs EVA 初号机） */}
                  <div>
                    <div className="flex items-center justify-between gap-3 mb-2.5">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-(--text-primary) flex items-center gap-1.5">
                          <span>{t("配色风格")}</span>
                          {(() => {
                            const currentOpt = COLOR_THEME_OPTIONS.find(
                              (opt) => opt.id === (draft.matrixColorTheme ?? "default"),
                            ) ?? COLOR_THEME_OPTIONS[0];
                            return (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${currentOpt.badgeClass}`}
                              >
                                {currentOpt.badge}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-[11px] text-(--text-muted) mt-0.5">
                          {t("定制方格矩阵与指标卡片的高光配色风格。")}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">
                      {COLOR_THEME_OPTIONS.map((opt) => {
                        const isSelected = (draft.matrixColorTheme ?? "default") === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => patch("matrixColorTheme", opt.id)}
                            data-active={isSelected ? "true" : "false"}
                            aria-pressed={isSelected}
                            className={`setting-color-theme-card ${opt.id === "eva" ? "is-eva" : ""}`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex items-center gap-1 shrink-0 p-1 rounded-md bg-(--bg-card) border border-(--hairline)">
                                {opt.colors.map((c, i) => (
                                  <span
                                    key={i}
                                    className="w-2.5 h-2.5 rounded-xs"
                                    style={{ backgroundColor: c }}
                                  />
                                ))}
                              </div>
                              <div className="min-w-0">
                                <span className="text-xs font-medium text-(--text-primary) block truncate">
                                  {t(opt.label)}
                                </span>
                                <span className="text-[10px] text-(--text-muted) block truncate">
                                  {t(opt.desc)}
                                </span>
                              </div>
                            </div>
                            <div className="setting-color-theme-radio" aria-hidden="true">
                              {isSelected && (
                                <div className="setting-color-theme-radio-dot" />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. 矩阵开场动画 */}
                  <div className="mt-4 pt-3.5 border-t border-(--hairline)">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-(--text-primary) flex items-center gap-1.5">
                          <span>{t("开屏动画")}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30">
                            BOOT INTRO
                          </span>
                        </div>
                        <p className="text-[11px] text-(--text-muted) mt-0.5">
                          {t("进入首页时播放光效开屏动画，随后载入数据。")}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.matrixBootAnimation ?? true}
                        onChange={(event) => patch("matrixBootAnimation", event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-(--accent-500)"
                      />
                    </label>

                    {/* 开场点阵图案自定义画布与动效形式（仅在开启开场动画时展开） */}
                    {(draft.matrixBootAnimation ?? true) && (
                      <div className="mt-3.5 space-y-4">
                        {/* 动效形式独立选择器 */}
                        <div className="rounded-xl border border-(--hairline) bg-[color-mix(in_srgb,var(--bg-card)_55%,transparent)] p-3 sm:p-3.5">
                          <div className="flex items-center justify-between gap-2 mb-2.5">
                            <div>
                              <div className="text-xs font-semibold text-(--text-primary) flex items-center gap-1.5">
                                <span>{t("动效样式")}</span>
                                {(() => {
                                  const currentEffect =
                                    BOOT_EFFECT_OPTIONS.find(
                                      (e) => e.id === (draft.matrixBootEffect ?? "laser-scan"),
                                    ) ?? BOOT_EFFECT_OPTIONS[0];
                                  return (
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${currentEffect.badgeClass}`}
                                    >
                                      {currentEffect.badge}
                                    </span>
                                  );
                                })()}
                              </div>
                              <p className="text-[11px] text-(--text-muted) mt-0.5">
                                {t("选择开屏画面的入场动效样式。")}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {BOOT_EFFECT_OPTIONS.map((opt) => {
                              const isSelected = (draft.matrixBootEffect ?? "laser-scan") === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => patch("matrixBootEffect", opt.id)}
                                  data-active={isSelected ? "true" : "false"}
                                  aria-pressed={isSelected}
                                  className="setting-color-theme-card"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-xs font-medium text-(--text-primary) truncate">
                                          {t(opt.label)}
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-(--text-muted) block truncate mt-0.5">
                                        {t(opt.desc)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="setting-color-theme-radio" aria-hidden="true">
                                    {isSelected && (
                                      <div className="setting-color-theme-radio-dot" />
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* 点阵画板 */}
                        <MatrixPatternEditor
                          value={draft.matrixCustomPattern}
                          userPresets={draft.matrixUserPresets}
                          colorTheme={draft.matrixColorTheme ?? "default"}
                          bootEffect={draft.matrixBootEffect ?? "laser-scan"}
                          onApply={(pattern) => { patch("matrixCustomPattern", pattern); showToast(t("点阵图案已更新，正在同步")); }}
                        onSaveUserPresets={(presets) => { patch("matrixUserPresets", presets); showToast(t("用户预设已更新，正在同步")); }}
                        />
                      </div>
                    )}
                  </div>

                  {/* 3. 模拟数据填充空闲机位插槽 */}
                  <div className="mt-4 pt-3.5 border-t border-(--hairline)">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-(--text-primary) flex items-center gap-1.5">
                          <span>{t("模拟数据填充空闲机位插槽")}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30">
                            MOCK FILL
                          </span>
                        </div>
                        <p className="text-[11px] text-(--text-muted) mt-0.5">
                          {t("开启后，机架方格矩阵中未接入服务器的闲置插槽将使用模拟数据填满，并在运行期间周期性随机变幻「空闲待机」、「活跃传输」与「高吞吐」状态及吞吐速率，令机架方格更显生机灵动。")}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={draft.matrixMockFill ?? false}
                        onChange={(event) => patch("matrixMockFill", event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-(--accent-500)"
                      />
                    </label>
                  </div>
                </InstancePanel>
              )}

<InstancePanel
                kicker={t("评级")}
                title={t("总览文字评级")}
                aside={<ListFilter size={16} />}
              >
                <div className="grid gap-3 md:grid-cols-3">
                  {OVERVIEW_RATING_LABEL_FIELDS.map((field) => {
                    const defaultLabel = getDefaultOverviewRatingLabelText(field.key);
                    const ratingEnabled = draft[field.toggleKey];
                    return (
                      <div
                        key={field.key}
                        className={`surface-inset flex min-w-0 flex-col gap-2.5 px-4 py-3 transition-colors ${
                          field.isBadge ? "border-l-2 border-l-(--accent-500)" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="setting-subhead-title">{t(field.title)}</span>
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                  field.isBadge
                                    ? "bg-(--accent-500)/15 text-(--accent-400) border border-(--accent-500)/30"
                                    : "bg-white/5 text-(--text-muted) border border-white/10"
                                }`}
                              >
                                {field.isBadge && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 animate-pulse" />}
                                {t(field.scopeBadge)}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-(--text-tertiary) leading-normal">
                              {t(field.description)}
                            </p>
                          </div>
                          <input
                            type="checkbox"
                            checked={draft[field.toggleKey]}
                            onChange={(event) => patch(field.toggleKey, event.target.checked)}
                            className="h-4 w-4 shrink-0 mt-0.5 accent-(--accent-500)"
                            title={t("开启/关闭{0}", [field.title])}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5 mt-auto pt-1">
                          <div className="flex items-center justify-between text-[11px] text-(--text-muted)">
                            <span>{t("自定义分级词")}</span>
                            {!ratingEnabled && <span className="opacity-70">{t("(已停用)")}</span>}
                          </div>
                          <input
                            value={draft.ratingLabels[field.key]}
                            disabled={!ratingEnabled}
                            onChange={(event) => setRatingLabelDraft(field.key, event.target.value)}
                            placeholder={defaultLabel}
                            aria-label={t("{0}评级名称", [field.title])}
                            className="surface-inset w-full px-3 py-1.5 text-[12px] outline-none disabled:opacity-60 font-mono"
                          />
                          <span className="setting-hint">
                            {t(field.tierHint)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </InstancePanel>
</>)}

          {activeTab === "card" && (<>
<InstancePanel
                kicker={t("视图")}
                title={t("默认卡片视图")}
                aside={<LayoutGrid size={16} />}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="surface-inset setting-segment-slot flex flex-col gap-3 px-4 py-4">
                    <div>
                      <div className="setting-subhead-title">
                        {t("桌面端默认")}</div>
                      <div className="mt-1 setting-hint">
                        {t("适用于宽度大于 720px 的浏览器窗口。")}</div>
                    </div>
                    <div className="instance-segmented is-prominent is-even">
                      {NODE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          data-active={draft.desktopNodeViewMode === value ? "true" : "false"}
                          aria-pressed={draft.desktopNodeViewMode === value}
                          onClick={() => patch("desktopNodeViewMode", value)}
                          className="inline-flex items-center justify-center gap-2"
                        >
                          <Icon size={14} />
                          <span>{t(label)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="surface-inset setting-segment-slot flex flex-col gap-3 px-4 py-4">
                    <div>
                      <div className="setting-subhead-title">
                        {t("移动端默认")}</div>
                      <div className="mt-1 setting-hint">
                        {t("适用于宽度小于等于 720px 的手机或窄屏窗口。")}</div>
                    </div>
                    <div className="instance-segmented is-prominent is-even">
                      {MOBILE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                        <button
                          key={value}
                          type="button"
                          data-active={draft.mobileNodeViewMode === value ? "true" : "false"}
                          aria-pressed={draft.mobileNodeViewMode === value}
                          onClick={() => patch("mobileNodeViewMode", value)}
                          className="inline-flex items-center justify-center gap-2"
                        >
                          <Icon size={14} />
                          <span>{t(label)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </InstancePanel>

<InstancePanel
              kicker={t("卡片")}
              title={t("卡片展示内容")}
              description={t("定制大卡片、小卡片和列表模式下呈现的具体指标。")}
              aside={<Rows3 size={16} />}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <ToggleRow
                  field="showCardGroup"
                  title={t("显示节点分组标签")}
                  desc={t("在卡片副标题处标明其所属分组。")}
                  checked={draft.showCardGroup}
                  onPatch={patch}
                />
                <ToggleRow
                  field="compactShowTrafficTotal"
                  title={t("小卡片显示累计流量")}
                  desc={t("在紧凑视图中展示累计出入站流量。")}
                  checked={draft.compactShowTrafficTotal}
                  onPatch={patch}
                />
                <ToggleRow
                  field="compactShowBilling"
                  title={t("小卡片显示计费周期")}
                  desc={t("在紧凑视图中保留周期标注。")}
                  checked={draft.compactShowBilling}
                  onPatch={patch}
                />
                <ToggleRow
                  field="compactShowUptime"
                  title={t("小卡片显示在线时长")}
                  desc={t("在紧凑视图中展示系统运行时间。")}
                  checked={draft.compactShowUptime}
                  onPatch={patch}
                />
                <ToggleRow
                  field="showConnections"
                  title={t("显示 TCP/UDP 连接数")}
                  desc={t("在卡片网络区域标注实时活跃连接统计。")}
                  checked={draft.showConnections}
                  onPatch={patch}
                />
                <ToggleRow
                  field="showTodayTrafficPopover"
                  title={t("显示当日流量与峰值按钮")}
                  desc={t("在节点卡片上显示扩展统计按钮，点击或悬停可查看当日出入站流量与峰值带宽。")}
                  checked={draft.showTodayTrafficPopover}
                  onPatch={patch}
                />
              </div>
            </InstancePanel>

<InstancePanel
                kicker={t("排序")}
                title={t("排序规则与默认选中")}
                aside={<Rows3 size={16} />}
              >
                <div className="flex flex-col gap-4">
                  <ToggleRow
                    field="enableHomeSort"
                    title={t("允许访客切换排序")}
                    desc={t("在首页提供排序下拉切换功能。")}
                    checked={draft.enableHomeSort}
                    onPatch={patch}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="surface-inset flex flex-col gap-2 px-4 py-3">
                      <span className="setting-subhead-title">{t("默认排序字段")}</span>
                      <SettingSelect
                        value={draft.homeSortField}
                        disabled={!draft.enableHomeSort}
                        onChange={(event) =>
                          patch(
                            "homeSortField",
                            event.target.value as (typeof HOME_SORT_FIELDS)[number],
                          )
                        }
                      >
                        {HOME_SORT_FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {t(HOME_SORT_FIELD_LABELS[field])}
                          </option>
                        ))}
                      </SettingSelect>
                    </div>

                    <div className="surface-inset flex flex-col gap-2 px-4 py-3">
                      <span className="setting-subhead-title">{t("默认排序方向")}</span>
                      <SettingSelect
                        value={draft.homeSortDirection}
                        disabled={!draft.enableHomeSort}
                        onChange={(event) =>
                          patch("homeSortDirection", event.target.value as "asc" | "desc")
                        }
                      >
                        <option value="asc">{t("升序 (ASC)")}</option>
                        <option value="desc">{t("降序 (DESC)")}</option>
                      </SettingSelect>
                    </div>
                  </div>

                  {orderedDraftGroups.length > 0 && (
                    <div className="surface-inset flex flex-col gap-3 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="setting-subhead-title">{t("分组展示顺序")}</span>
                        <span className="setting-hint">{t("使用上下箭头调整顺序")}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {orderedDraftGroups.map((group, index) => (
                          <div
                            key={group}
                            className="flex items-center justify-between rounded-lg border border-(--hairline) px-3 py-2 text-[13px]"
                          >
                            <span>{group}</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() => moveGroup(index, -1)}
                                className="theme-manage-button is-compact"
                                aria-label={t("上移 {0}", [group])}
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button
                                type="button"
                                disabled={index === orderedDraftGroups.length - 1}
                                onClick={() => moveGroup(index, 1)}
                                className="theme-manage-button is-compact"
                                aria-label={t("下移 {0}", [group])}
                              >
                                <ChevronDown size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </InstancePanel>

<InstancePanel kicker={t("逐服务器")} title={t("逐服务器线路设置")} aside={<Activity size={16} />}>
                <HomepageNodePingEditor nodes={sortedClients} tasks={sortedTasks}
                  settings={draft.homepageNodePingSettings} bindings={draft.homepagePingBindings}
                  nodesReady={!clientsLoading && !clientsError}
                  onChange={(next) => patch("homepageNodePingSettings", next)} />
                {clientsLoading && <p className="setting-hint">{t("正在读取服务器…")}</p>}
                {clientsError && <p className="setting-hint" role="alert">{t("服务器列表读取失败，请刷新重试；已保存设置仍保留。")}</p>}
                {tasksLoading && <p className="setting-hint">{t("正在读取检测任务…")}</p>}
                {tasksError && <p className="setting-hint" role="alert">{t("任务列表读取失败，请刷新重试。")}</p>}
                {draftNodePingInvalid && <p className="setting-hint text-(--status-error)" role="alert">{t("自定义模式请至少选择一条线路；需要自动展示时请选择“自动”。")}</p>}
              </InstancePanel>

<InstancePanel
                kicker={t("线路")}
                title={t("全局延迟展示设置")}
                aside={<Activity size={16} />}
              >
                <div className="flex flex-col gap-4">
                  <div className="surface-inset flex flex-col gap-3 px-4 py-4">
                    <span className="setting-subhead-title">{t("首页探测展示模式")}</span>
                    <div className="instance-segmented is-prominent is-even is-stack-mobile">
                      <button
                        type="button"
                        data-active={!draft.enableHomepageMultiPing ? "true" : "false"}
                        onClick={() => patch("enableHomepageMultiPing", false)}
                      >
                        {t("单线路模式 (指定主线路)")}</button>
                      <button
                        type="button"
                        data-active={draft.enableHomepageMultiPing ? "true" : "false"}
                        onClick={() => patch("enableHomepageMultiPing", true)}
                      >
                        {t("多线路模式 (并列展示三网/自定义线路)")}</button>
                    </div>
                  </div>

                  {draft.enableHomepageMultiPing ? (
                    <div className="surface-inset flex flex-col gap-3 px-4 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="setting-subhead-title">{t("多线路槽位展示列表")}</span>
                          <p className="setting-hint mt-1">
                            {t("跟随全局的卡片依序展示。清空并保存后，按各节点实际关联任务自动展示，忽略旧单线路绑定。")}</p>
                        </div>
                        <button type="button" className="theme-manage-button is-compact is-danger" disabled={draft.homepageMultiPingTaskIds.length === 0} onClick={() => commitMultiPingTaskIds(() => [])}>{t("清空槽位")}</button>
                        {draft.homepageMultiPingTaskIds.length < multiPingSlotLimit && (
                          <button
                            type="button"
                            onClick={addMultiPingTask}
                            className="theme-manage-button is-compact"
                          >
                            {t("+ 添加展示线路")}</button>
                        )}
                      </div>

                      {draft.homepageMultiPingTaskIds.length === 0 && <p className="setting-hint">{t("当前为空：自动展示每台服务器关联的检测任务。可以直接保存。")}</p>}
                      <div className="grid gap-3 md:grid-cols-2">
                        {draft.homepageMultiPingTaskIds.map((taskId, slot) => (
                          <div
                            key={slot}
                            className="flex items-center justify-between gap-2 rounded-[10px] border border-(--hairline) px-3 py-2 min-w-0"
                          >
                            <span className="text-[12px] font-medium text-(--text-secondary) shrink-0">
                              {t("槽位 #")}{slot + 1}
                            </span>
                            <SettingSelect
                              value={String(taskId)}
                              onChange={(event) => patchMultiPingTask(slot, event.target.value)}
                              wrapperClassName="flex-1 min-w-0"
                            >
                              {!sortedTasks.some((task) => task.id === taskId) && <option value={taskId}>{t("任务 #")}{taskId}{t("（已删除或不可用）")}</option>}
                              {sortedTasks.map((task) => (
                                <option key={task.id} value={task.id}>
                                  {task.name || t("线路 #{0}", [task.id])}
                                </option>
                              ))}
                            </SettingSelect>
                              <button
                                type="button"
                                onClick={() => removeMultiPingTask(slot)}
                                className="theme-manage-button is-compact is-danger shrink-0"
                              >
                                {t("删除")}</button>
                          </div>
                        ))}
                      </div>

                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                        <label className="surface-inset flex items-center gap-2 px-3 py-2">
                          <Search size={14} className="text-(--text-tertiary)" />
                          <input
                            value={taskSearch}
                            onChange={(event) => setTaskSearch(event.target.value)}
                            placeholder={t("搜索 Ping 任务名称 / ID / 类型 / 目标")}
                            aria-label={t("搜索 Ping 任务")}
                            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--text-tertiary)"
                          />
                        </label>
                        <div className="surface-inset flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-(--text-secondary)">
                          <span>{t("首页绑定总数")}</span>
                          <strong className="text-(--text-primary)">
                            {t("{0} 个任务", [sortedTasks.length])}
                          </strong>
                        </div>
                      </div>

                      <ToggleRow
                        field="fakePingForUnbound"
                        title={t("未绑定线路时模拟平滑延迟")}
                        desc={t("避免部分节点空缺无条形码时影响整体美观（仅视觉平滑占位）。")}
                        checked={draft.fakePingForUnbound}
                        onPatch={patch}
                      />

                      {(tasksLoading || clientsLoading) && (
                        <div className="flex min-h-[20vh] items-center justify-center">
                          <Spinner size={24} />
                        </div>
                      )}

                      {noTasksYet && (
                        <div className="theme-manage-empty-state">
                          <span>{t("当前还没有可用于首页展示的 Ping 任务。")}</span>
                          <a href="/admin/ping" className="theme-manage-inline-link">
                            {t("前往后台 Ping 管理创建任务")}</a>
                        </div>
                      )}

                      {noFilteredTaskMatch && (
                        <div className="surface-inset px-4 py-5 text-[13px] text-(--text-secondary)">
                          {t("没有匹配的 Ping 任务。")}</div>
                      )}

                      {!tasksLoading &&
                        !clientsLoading &&
                        !noTasksYet &&
                        filteredTasks.map((task) => {
                          const expanded = expandedTaskId === task.id;
                          return (
                            <TaskBindingSection
                              key={task.id}
                              task={task}
                              assigned={
                                draft.homepagePingBindings[String(task.id)] ?? EMPTY_ASSIGNED_CLIENTS
                              }
                              expanded={expanded}
                              clientsById={clientsById}
                              visibleClients={expanded ? visibleClients : EMPTY_ADMIN_CLIENTS}
                              assignedTaskByClientUuid={assignedTaskByClientUuid}
                              nodeSearch={expanded ? nodeSearch : ""}
                              onNodeSearch={setNodeSearch}
                              onToggleExpand={toggleTaskExpanded}
                              onPatchBindings={patchBindings}
                            />
                          );
                        })}
                    </div>
                  )}
                </div>
              </InstancePanel>

<InstancePanel
                kicker={t("光柱")}
                title={t("状态光柱")}
                description={t("定制流量、延迟与丢包光柱的过渡色与判断门槛。")}
                aside={<Sliders size={16} />}
              >
                {draftStatusInvalid && <p role="alert" className="setting-hint">{t("延迟阈值须为递增的正整数；丢包阈值须递增且介于 0% 与 100% 之间。")}</p>}
                <div className="flex flex-col gap-5">
                  {/* 顶置配套方案预设：一套方案联动覆盖流量、延迟、丢包三处光柱 */}
                  <div className="surface-inset flex flex-col gap-3.5 px-4 py-4">
                    <div>
                      <span className="setting-subhead-title">{t("配套预设方案")}</span>
                      <p className="setting-hint mt-1">
                        {t("一键联动设定流量、延迟与丢包光柱的成套视觉方案。")}</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {STATUS_BAR_PRESETS.map((preset) => {
                        const isSelected =
                          draft.trafficSpectrumColors.start === preset.colors.start &&
                          draft.trafficSpectrumColors.mid === preset.colors.mid &&
                          draft.trafficSpectrumColors.high === preset.colors.high &&
                          draft.trafficSpectrumColors.end === preset.colors.end &&
                          draft.pingLatencyColors.excellent === preset.latencyColors.excellent &&
                          draft.pingLatencyColors.good === preset.latencyColors.good &&
                          draft.pingLatencyColors.moderate === preset.latencyColors.moderate &&
                          draft.pingLatencyColors.elevated === preset.latencyColors.elevated &&
                          draft.pingLatencyColors.critical === preset.latencyColors.critical &&
                          draft.pingLossColors.zero === preset.lossColors.zero &&
                          draft.pingLossColors.low === preset.lossColors.low &&
                          draft.pingLossColors.medium === preset.lossColors.medium &&
                          draft.pingLossColors.high === preset.lossColors.high;
                        const gradient = `linear-gradient(to right, ${preset.colors.start}, ${preset.colors.mid}, ${preset.colors.high}, ${preset.colors.end})`;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => applyStatusBarPreset(preset)}
                            data-active={isSelected ? "true" : "false"}
                            aria-pressed={isSelected}
                            className="setting-spectrum-preset-card"
                          >
                            <div className="flex items-center justify-between gap-1.5 w-full">
                              <span
                                className={clsx(
                                  "text-xs font-semibold truncate",
                                  isSelected
                                    ? "text-(--accent-500)"
                                    : "text-(--text-primary)",
                                )}
                              >
                                {t(preset.name)}
                              </span>
                              <div className="setting-color-theme-radio" aria-hidden="true">
                                {isSelected && <div className="setting-color-theme-radio-dot" />}
                              </div>
                            </div>
                            <div
                              className="h-2 w-full rounded-full shadow-inner ring-1 ring-black/10 dark:ring-white/10"
                              style={{ background: gradient }}
                            />
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 1. 流量进度光柱色谱自定义 */}
                  <div className="surface-inset flex flex-col gap-3.5 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="setting-subhead-title">{t("流量光柱")}</span>
                        <p className="setting-hint mt-1">
                          {t("从用量充裕到即将耗尽，呈现平滑过渡色谱。")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={resetTrafficSpectrum}
                        className="theme-manage-button is-compact shrink-0 flex items-center gap-1.5"
                        title={t("恢复为默认的监控绿色谱")}
                      >
                        <RotateCcw size={13} />
                        {t("重置色彩")}</button>
                    </div>

                    {/* 就近实时预览：18 段发光光柱色谱全貌（置顶呈现） */}
                    <div className="flex flex-col gap-2.5 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-(--text-secondary) flex items-center gap-1.5">
                          <Sparkles size={13} className="text-(--accent-500)" />
                          {t("流量光柱实时效果 (18 段)")}</span>
                        <span className="text-[11px] text-(--text-tertiary)">
                          {t("所见即所得 · 0% 充裕至 100% 耗尽连续色谱")}</span>
                      </div>

                      <div className="flex flex-col gap-1 rounded-md bg-(--bg-primary) p-2.5 shadow-inner">
                        <div className="flex items-center justify-between text-[11px] text-(--text-tertiary) mb-1">
                          <span>{t("18 段发光光柱色谱全貌：")}</span>
                          <span className="font-mono">{t("从轻载平滑过渡至警戒红")}</span>
                        </div>
                        <div className="traffic-quota-track" aria-hidden>
                          {previewTrafficSegmentColors.map((color, i) => (
                            <span key={i} className="traffic-quota-segment" style={{ background: color }} />
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 4 锚点 HEX 输入网格 */}
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      {TRAFFIC_SPECTRUM_ANCHOR_CONFIG.map(({ key, label, stage, hint, defaultColor }) => {
                        const currentColor = draft.trafficSpectrumColors[key];
                        const isEnd = key === "end";
                        return (
                          <div
                            key={key}
                            className="flex flex-col justify-between gap-2.5 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-(--text-primary)">
                                {t(label)}
                              </span>
                              <span
                                className={clsx(
                                  "text-[10px] px-1.5 py-0.5 rounded border font-mono font-medium",
                                  isEnd
                                    ? "bg-rose-500/10 text-rose-500 border-rose-500/20"
                                    : "bg-(--bg-primary) text-(--text-tertiary) border-(--hairline)",
                                )}
                              >
                                {t(stage)}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="relative flex items-center justify-center shrink-0 cursor-pointer">
                                <span
                                  className="inline-block h-7 w-7 rounded-full border-2 border-white/40 shadow-sm"
                                  style={{ backgroundColor: currentColor }}
                                />
                                <input
                                  type="color"
                                  value={currentColor}
                                  onChange={(e) => patchTrafficSpectrumColor(key, e.target.value)}
                                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                                  title={t("选取{0}", [t(label)])}
                                />
                              </label>
                              <input
                                type="text"
                                maxLength={7}
                                value={currentColor}
                                onChange={(e) => patchTrafficSpectrumColor(key, e.target.value)}
                                className="surface-inset px-2.5 py-1 text-[12px] font-mono uppercase text-(--text-primary) w-full outline-none"
                                placeholder={defaultColor}
                              />
                            </div>

                            <p className="text-[11px] text-(--text-tertiary) leading-tight">
                              {t(hint)}
                            </p>

                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-(--hairline)">
                              <span className="text-[11px] text-(--text-secondary) shrink-0">
                                {isEnd ? t("末端特性") : t("阶段定位")}
                              </span>
                              <span className="text-[11px] font-mono text-(--text-tertiary)">
                                {isEnd ? t("严格警报红守护") : t("平滑色谱锚点")}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. 延迟评级标准与色彩设置 */}
                  <div className="surface-inset flex flex-col gap-3.5 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="setting-subhead-title">{t("延迟光柱")}</span>
                        <p className="setting-hint mt-1">
                          {t("设定各毫秒区间的判断门槛与对应光柱颜色。")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={resetPingLatency}
                        className="theme-manage-button is-compact shrink-0 flex items-center gap-1.5"
                        title={t("恢复为默认的 60/100/160/200ms 及预设色")}
                      >
                        <RotateCcw size={13} />
                        {t("重置延迟")}</button>
                    </div>

                    {/* 就近实时预览：延迟光柱 */}
                    <div className="flex flex-col gap-2 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[12px]">
                        <span className="font-medium text-(--text-secondary) flex items-center gap-1.5">
                          <Activity size={13} className="text-(--status-success)" />
                          {t("延迟光柱实时效果 (示例梯度 15ms ~ 320ms)")}</span>
                        <span className="tabular font-medium text-(--text-tertiary) text-[11px]">
                          {t("门槛：")}{draft.pingLatencyThresholds.excellent}ms / {draft.pingLatencyThresholds.good}ms / {draft.pingLatencyThresholds.moderate}ms / {draft.pingLatencyThresholds.elevated}ms
                        </span>
                      </div>
                      <div className="rounded-md bg-(--bg-primary) p-2 shadow-inner">
                        <LatencyBars
                          buckets={PREVIEW_LATENCY_BUCKETS}
                          latencyThresholds={draft.pingLatencyThresholds}
                          latencyColors={draft.pingLatencyColors}
                          height={18}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {LATENCY_TIER_CONFIG.map(({ key, label, hint, defaultColor }) => {
                        const currentColor = draft.pingLatencyColors[key];
                        const isThresholdEditable = key !== "critical";
                        const thresholdVal = isThresholdEditable
                          ? draft.pingLatencyThresholds[key]
                          : null;

                        return (
                          <div
                            key={key}
                            className="flex flex-col justify-between gap-2.5 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-(--text-primary)">
                                {t(label)}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <label
                                  className="metric-color-swatch"
                                  style={{ background: currentColor }}
                                  title={t("点击调整颜色")}
                                >
                                  <input
                                    type="color"
                                    value={currentColor}
                                    onChange={(e) => patchPingLatencyColor(key, e.target.value)}
                                  />
                                </label>
                                {currentColor.toLowerCase() !== defaultColor.toLowerCase() && (
                                  <button
                                    type="button"
                                    onClick={() => patchPingLatencyColor(key, defaultColor)}
                                    className="text-(--text-tertiary) hover:text-(--text-primary) transition-colors p-1"
                                    title={t("恢复该项默认色")}
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="text-[11px] text-(--text-tertiary) leading-tight">
                              {t(hint)}
                            </p>

                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-(--hairline)">
                              <span className="text-[11px] text-(--text-secondary) shrink-0">
                                {isThresholdEditable ? t("门槛上限") : t("高延迟区间")}
                              </span>
                              {isThresholdEditable ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min={1}
                                    max={9999}
                                    value={thresholdVal ?? 0}
                                    onChange={(e) => {
                                      const num = parseInt(e.target.value, 10);
                                      if (!Number.isNaN(num) && num > 0) {
                                        patchPingLatencyThreshold(key, num);
                                      }
                                    }}
                                    className="w-16 rounded-[5px] border border-(--hairline) bg-(--bg-primary) px-2 py-0.5 text-right font-mono text-[12px] font-medium outline-none focus:border-(--status-success)"
                                  />
                                  <span className="text-[11px] text-(--text-tertiary)">ms</span>
                                </div>
                              ) : (
                                <span className="font-mono text-[11px] text-(--text-tertiary)">
                                  &gt; {draft.pingLatencyThresholds.elevated}ms
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 3. 丢包评级标准与色彩设置 */}
                  <div className="surface-inset flex flex-col gap-3.5 px-4 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="setting-subhead-title">{t("丢包光柱")}</span>
                        <p className="setting-hint mt-1">
                          {t("设定不同丢包率区间的判断门槛与对应颜色。")}</p>
                      </div>
                      <button
                        type="button"
                        onClick={resetPingLoss}
                        className="theme-manage-button is-compact shrink-0 flex items-center gap-1.5"
                        title={t("恢复为默认的 3%/10% 门槛及预设色")}
                      >
                        <RotateCcw size={13} />
                        {t("重置丢包")}</button>
                    </div>

                    {/* 就近实时预览：丢包光柱 */}
                    <div className="flex flex-col gap-2 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[12px]">
                        <span className="font-medium text-(--text-secondary) flex items-center gap-1.5">
                          <Activity size={13} className="text-(--status-warning)" />
                          {t("丢包光柱实时效果 (示例梯度 0% ~ 25%)")}</span>
                        <span className="tabular font-medium text-(--text-tertiary) text-[11px]">
                          {t("门槛：0% /")}{draft.pingLossThresholds.low}% / {draft.pingLossThresholds.medium}%
                        </span>
                      </div>
                      <div className="rounded-md bg-(--bg-primary) p-2 shadow-inner">
                        <QualityBars
                          buckets={PREVIEW_LOSS_BUCKETS}
                          lossThresholds={draft.pingLossThresholds}
                          lossColors={draft.pingLossColors}
                          height={18}
                        />
                      </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      {LOSS_TIER_CONFIG.map(({ key, label, hint, defaultColor }) => {
                        const currentColor = draft.pingLossColors[key];
                        const isEditable = key === "low" || key === "medium";
                        const thresholdVal =
                          key === "low"
                            ? draft.pingLossThresholds.low
                            : key === "medium"
                              ? draft.pingLossThresholds.medium
                              : null;

                        return (
                          <div
                            key={key}
                            className="flex flex-col justify-between gap-2.5 rounded-[10px] border border-(--hairline) bg-(--bg-card) p-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[13px] font-semibold text-(--text-primary)">
                                {t(label)}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <label
                                  className="metric-color-swatch"
                                  style={{ background: currentColor }}
                                  title={t("点击调整颜色")}
                                >
                                  <input
                                    type="color"
                                    value={currentColor}
                                    onChange={(e) => patchPingLossColor(key, e.target.value)}
                                  />
                                </label>
                                {currentColor.toLowerCase() !== defaultColor.toLowerCase() && (
                                  <button
                                    type="button"
                                    onClick={() => patchPingLossColor(key, defaultColor)}
                                    className="text-(--text-tertiary) hover:text-(--text-primary) transition-colors p-1"
                                    title={t("恢复该项默认色")}
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="text-[11px] text-(--text-tertiary) leading-tight">
                              {t(hint)}
                            </p>

                            <div className="flex items-center justify-between gap-2 pt-1 border-t border-(--hairline)">
                              <span className="text-[11px] text-(--text-secondary) shrink-0">
                                {isEditable ? t("丢包上限") : t("生效条件")}
                              </span>
                              {isEditable ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    step="0.5"
                                    min={0.1}
                                    max={100}
                                    value={thresholdVal ?? 0}
                                    onChange={(e) => {
                                      const num = parseFloat(e.target.value);
                                      if (!Number.isNaN(num) && num > 0) {
                                        patchPingLossThreshold(key, num);
                                      }
                                    }}
                                    className="w-16 rounded-[5px] border border-(--hairline) bg-(--bg-primary) px-2 py-0.5 text-right font-mono text-[12px] font-medium outline-none focus:border-(--status-success)"
                                  />
                                  <span className="text-[11px] text-(--text-tertiary)">%</span>
                                </div>
                              ) : (
                                <span className="font-mono text-[11px] text-(--text-tertiary)">
                                  {key === "zero" ? t("= 0% (完全健康)") : `> ${draft.pingLossThresholds.medium}%`}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </InstancePanel>

<InstancePanel
                kicker={t("过滤")}
                title={t("隐藏节点")}
                aside={<Search size={16} />}
              >
                <div className="surface-inset flex flex-col gap-2 px-4 py-3">
                  <span className="setting-subhead-title">{t("隐藏节点列表 (每行一个 UUID 或名称)")}</span>
                  <textarea
                    rows={4}
                    value={draft.hiddenNodesText}
                    onChange={(event) => patch("hiddenNodesText", event.target.value)}
                    placeholder="node-uuid-1&#10;Tokyo Edge"
                    className="surface-inset p-3 text-[13px] font-mono outline-none min-h-28"
                  />
                  <span className="setting-hint">
                    {t("列在此处的节点将不会在首页及总览中展示。当前已生效")}{draftHiddenNodes.length} {t("台。")}</span>
                </div>
              </InstancePanel>
</>)}

          {activeTab === "cost" && (<>
<InstancePanel
                kicker={t("资产")}
                title={t("资产与财务设置")}
                aside={<CircleDollarSign size={16} />}
              >
                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="surface-inset flex flex-col gap-2 px-4 py-3">
                      <span className="setting-subhead-title">{t("实时汇率接口 API URL")}</span>
                      <input
                        value={draft.costRateApiUrl}
                        onChange={(event) => patch("costRateApiUrl", event.target.value)}
                        placeholder={DEFAULT_THEME_SETTINGS.costRateApiUrl}
                        aria-invalid={draftCostRateApiUrlInvalid}
                        className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
                      />
                      <span className="setting-hint">
                        {draftCostRateApiUrlInvalid
                          ? t("请输入 http(s) 链接，保存后将回退默认接口")
                          : t("留空使用官方默认免费公共汇率接口。")}
                      </span>
                    </label>

                    <div className="surface-inset flex flex-col gap-2 px-4 py-3">
                      <span className="setting-subhead-title">{t("忽略计算费用的节点")}</span>
                      <textarea
                        rows={3}
                        value={draft.costIgnoredText}
                        onChange={(event) => patch("costIgnoredText", event.target.value)}
                        placeholder={t("每行一个节点名称 / UUID，也可以用逗号分隔")}
                        className="surface-inset min-h-24 w-full resize-y p-2.5 text-[13px] outline-none font-mono"
                      />
                      <span className="setting-hint">{t("每行一个节点 UUID 或名称，计入资产时不摊销其成本。")}</span>
                    </div>
                  </div>
                </div>
              </InstancePanel>

<InstancePanel
                kicker={t("溢价")}
                title={t("二手买入溢价/折价固化")}
                description={t("记录收购时的实际支出，系统自动算出折价盈亏并在到期日前线性摊销。")}
                aside={<CircleDollarSign size={16} />}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="surface-inset flex flex-1 max-w-sm items-center gap-2 px-3 py-1.5">
                      <Search size={14} className="text-(--text-tertiary)" />
                      <input
                        value={premiumSearch}
                        onChange={(event) => setPremiumSearch(event.target.value)}
                        placeholder={t("搜索节点录入收购价…")}
                        aria-label={t("搜索节点")}
                        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--text-tertiary)"
                      />
                    </label>
                    <span className="setting-hint shrink-0">
                      {t("已记录")}{premiumConfiguredCount} {t("台溢价")}</span>
                  </div>

                  {clientsLoading && (
                    <div className="flex min-h-[15vh] items-center justify-center">
                      <Spinner size={24} />
                    </div>
                  )}

                  {!clientsLoading && sortedClients.length === 0 && (
                    <div className="theme-manage-empty-state">
                      <span>{t("还没有任何节点。")}</span>
                    </div>
                  )}

                  {!clientsLoading && sortedClients.length > 0 && filteredPremiumClients.length === 0 && (
                    <div className="surface-inset px-4 py-5 text-[13px] text-(--text-secondary)">
                      {t("没有匹配的节点。")}</div>
                  )}

                  {!clientsLoading && filteredPremiumClients.length > 0 && (
                    <PremiumList
                      clients={filteredPremiumClients}
                      costPremiums={draft.costPremiums}
                      detailByUuid={premiumDetailByUuid}
                      rateLoading={premiumRateQuery.isLoading}
                      acquiredAtMax={acquiredAtMax}
                      onPatchPaid={patchPremiumPaid}
                      onPatchAcquiredAt={patchPremiumAcquiredAt}
                    />
                  )}
                </div>
              </InstancePanel>
</>)}

        </div>
      </div>
</div>
  );
}
