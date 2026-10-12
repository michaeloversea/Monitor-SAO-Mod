import { useAuth } from "@/hooks/useAuth";
import { useNodeStoreStatus } from "@/hooks/useNode";
import { usePreferences } from "@/hooks/usePreferences";
import { usePriceVisibility } from "@/hooks/usePriceVisibility";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import { useTranslate } from "@/i18n";
import type { Appearance, NodeViewMode } from "@/utils/themeSettings";
import { clsx } from "clsx";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Grid3x3,
  LayoutGrid,
  List,
  Monitor,
  Moon,
  Palette,
  Settings,
  SlidersHorizontal,
  Square,
  Sun,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LanguageMenu } from "./LanguageMenu";

const MetricColorPicker = lazy(() =>
  import("./MetricColorPicker").then((module) => ({ default: module.MetricColorPicker })),
);

// 悬浮球切换按钮展示"下一档"的图标/文案(点击后会切到的视图),而不是当前视图——
// 与 ThemeManage 里 NODE_VIEW_MODE_OPTIONS 的图标语义保持一致。
const VIEW_MODE_META: Record<NodeViewMode, { icon: typeof Square; label: string }> = {
  large: { icon: Square, label: "大视图" },
  compact: { icon: LayoutGrid, label: "小视图" },
  mini: { icon: Grid3x3, label: "迷你视图" },
  list: { icon: List, label: "列表视图" },
};

const NEXT_APPEARANCE: Record<Appearance, Appearance> = {
  system: "light",
  light: "dark",
  dark: "system",
};

const APPEARANCE_META: Record<
  Appearance,
  { icon: typeof Sun; label: string; nextLabel: string }
> = {
  light: { icon: Sun, label: "浅色", nextLabel: "深色" },
  dark: { icon: Moon, label: "深色", nextLabel: "跟随系统" },
  system: { icon: Monitor, label: "跟随系统", nextLabel: "浅色" },
};

export function FloatingControls({
  onExpandedChange,
}: {
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const t = useTranslate();
  const { appearance, setAppearance } = usePreferences();
  const { mode, nextMode, toggleMode } = useViewMode();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { isPriceVisible, togglePriceVisibility } = usePriceVisibility();
  const { failureStreak } = useNodeStoreStatus();
  const [collapsed, setCollapsed] = useState(true);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [colorsMounted, setColorsMounted] = useState(false);
  const settingsReady = themeSettings.isReady;
  const showAdmin = settingsReady && themeSettings.enableAdminButton;
  // 主题管理入口与配色取色器都仅对登录管理员开放（配色存后端、全局生效）。
  const loggedIn = Boolean(me?.logged_in);
  const showThemeManage = loggedIn;
  const showColorPicker = loggedIn;
  const showPriceToggle = loggedIn;
  const showSyncWarning = failureStreak >= 2;
  const hiddenTabIndex = collapsed ? -1 : undefined;
  const ToggleIcon = collapsed ? ChevronLeft : ChevronRight;
  const ViewIcon = VIEW_MODE_META[nextMode].icon;
  const currentAppearance = APPEARANCE_META[appearance] ?? APPEARANCE_META.system;
  const AppearanceIcon = currentAppearance.icon;

  const cycleAppearance = () => {
    setAppearance(NEXT_APPEARANCE[appearance] ?? "system");
  };

  // 只要不在最宽松的大卡默认态,就视为"已切换"，按钮保持高亮。
  const isReducedView = mode !== "large";
  useEffect(() => {
    onExpandedChange?.(false);
    return () => onExpandedChange?.(false);
  }, [onExpandedChange]);

  // 仅监听用户主动的滚轮/触摸滑动手势（wheel / touchmove），100% 免疫任何 DOM 尺寸变化或重排引发的 scroll 事件
  useEffect(() => {
    if (collapsed) return;

    const handleUserScroll = () => {
      setCollapsed(true);
      setColorsOpen(false);
      onExpandedChange?.(false);
    };

    window.addEventListener("wheel", handleUserScroll, { passive: true });
    window.addEventListener("touchmove", handleUserScroll, { passive: true });

    return () => {
      window.removeEventListener("wheel", handleUserScroll);
      window.removeEventListener("touchmove", handleUserScroll);
    };
  }, [collapsed, onExpandedChange]);

  const toggleControls = () => {
    // 收起快捷栏时同时结束子面板状态，避免下次展开时调色盘自动复现。
    const nextCollapsed = !collapsed;
    if (nextCollapsed) setColorsOpen(false);
    setCollapsed(nextCollapsed);
    onExpandedChange?.(!nextCollapsed);
  };

  return (
    <div
      className={clsx(
        "floating-controls",
        collapsed && "is-collapsed",
        showSyncWarning && "has-warning",
      )}
    >
      <div className="floating-controls-inner">
        <div className="floating-controls-row">
          <div className="floating-controls-actions" aria-hidden={collapsed}>
            {settingsReady && (
              <>
                <button
                  type="button"
                  onClick={cycleAppearance}
                  aria-label={t("外观: {0} (点击切换为{1})", [t(currentAppearance.label), t(currentAppearance.nextLabel)])}
                  title={t("外观: {0} (点击切换为{1})", [t(currentAppearance.label), t(currentAppearance.nextLabel)])}
                  tabIndex={hiddenTabIndex}
                  className={clsx(
                    "control-button grid h-9 w-9 place-items-center",
                    appearance !== "system" && "control-toggle is-active",
                  )}
                >
                  <AppearanceIcon size={16} />
                </button>
                <button
                  type="button"
                  onClick={toggleMode}
                  aria-label={t("切换卡片视图")}
                  aria-pressed={isReducedView}
                  title={t("临时切换到{0}", [t(VIEW_MODE_META[nextMode].label)])}
                  tabIndex={hiddenTabIndex}
                  className={clsx(
                    "control-button grid h-9 w-9 place-items-center",
                    isReducedView && "control-toggle is-active",
                  )}
                >
                  <ViewIcon size={16} />
                </button>
                {showPriceToggle && (
                  <button
                    type="button"
                    onClick={togglePriceVisibility}
                    aria-label={isPriceVisible ? t("隐藏价格与资产") : t("显示价格与资产")}
                    aria-pressed={!isPriceVisible}
                    title={isPriceVisible ? t("临时隐藏价格与资产") : t("临时显示价格与资产")}
                    tabIndex={hiddenTabIndex}
                    className={clsx(
                      "control-button grid h-9 w-9 place-items-center",
                      !isPriceVisible && "control-toggle is-active",
                    )}
                  >
                    {isPriceVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                )}
                {showColorPicker && (
                  <button
                    type="button"
                    onClick={() => {
                      setColorsMounted(true);
                      setColorsOpen((value) => !value);
                    }}
                    aria-label={t("卡片配色")}
                    aria-pressed={colorsOpen}
                    title={t("卡片配色")}
                    tabIndex={hiddenTabIndex}
                    className={clsx(
                      "control-button grid h-9 w-9 place-items-center",
                      colorsOpen && "control-toggle is-active",
                    )}
                  >
                    <Palette size={16} />
                  </button>
                )}
              </>
            )}
            {showThemeManage && (
              <Link
                to="/?view=theme-manage"
                aria-label={t("主题设置")}
                title={t("主题设置")}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <SlidersHorizontal size={16} />
              </Link>
            )}
            {showAdmin && (
              <a
                href="/admin/"
                aria-label={me?.logged_in ? t("管理") : t("后台登录")}
                title={me?.logged_in ? t("管理") : t("后台登录")}
                tabIndex={hiddenTabIndex}
                className="control-button grid h-9 w-9 place-items-center"
              >
                <Settings size={16} />
              </a>
            )}
          </div>
          <button
            type="button"
            className="control-button floating-controls-trigger grid h-9 w-9 place-items-center"
            aria-label={collapsed ? t("展开快捷按钮") : t("收起快捷按钮")}
            aria-expanded={!collapsed}
            onClick={toggleControls}
            title={collapsed ? t("展开快捷按钮") : t("收起快捷按钮")}
          >
            <ToggleIcon size={16} />
            {showSyncWarning && collapsed && (
              <span className="floating-controls-warning-dot" aria-hidden />
            )}
          </button>
          <LanguageMenu />
        </div>
        {showColorPicker && colorsMounted && (
          <Suspense fallback={null}>
            <MetricColorPicker hidden={collapsed || !colorsOpen} />
          </Suspense>
        )}
        {showSyncWarning && !collapsed && !colorsOpen && (
          <div className="floating-controls-sync-warning pointer-events-none flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--status-offline)_32%,transparent)] bg-[color-mix(in_srgb,var(--surface-a)_90%,transparent)] px-3 py-1 text-[11px] font-medium text-(--status-offline) shadow-[0_10px_25px_-18px_rgba(0,0,0,0.8)] backdrop-blur">
            <AlertTriangle size={12} />
            <span>{t("实时状态同步异常，当前展示的是最近缓存")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
