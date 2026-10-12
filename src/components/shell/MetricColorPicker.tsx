import {
  DEFAULT_METRIC_COLORS,
  METRIC_COLOR_GROUPS,
  METRIC_COLOR_META,
  useMetricColorsEditor,
  type MetricColorKey,
} from "@/hooks/useMetricColors";
import { usePreferences } from "@/hooks/usePreferences";
import { useTranslate } from "@/i18n";
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  RotateCcw,
  Zap,
} from "lucide-react";
import { useCallback } from "react";

const ICONS: Record<MetricColorKey, typeof Cpu> = {
  cpu: Cpu,
  memory: MemoryStick,
  disk: HardDrive,
  load: Gauge,
  swap: Database,
  speedIdle: Zap,
  speedLow: Zap,
  speedHigh: Zap,
  speedMax: Zap,
  trafficUp: ArrowUp,
  trafficDown: ArrowDown,
};

export function MetricColorPicker({ hidden = false }: { hidden?: boolean }) {
  const t = useTranslate();
  const {
    colors,
    setColor,
    resetColor,
    resetAll,
    saveError,
  } = useMetricColorsEditor();
  const { resolvedAppearance } = usePreferences();

  const themeDefaults = DEFAULT_METRIC_COLORS[resolvedAppearance === "dark" ? "dark" : "light"];

  const valueOf = useCallback(
    (key: MetricColorKey) => colors[key] ?? themeDefaults[key],
    [colors, themeDefaults],
  );
  const hasAny = Object.keys(colors).length > 0;

  return (
    <div
      className="metric-color-picker"
      role="group"
      aria-label={t("卡片配色")}
      hidden={hidden}
    >
      <div className="metric-color-picker-head">
        <span>{t("配色自定义")}</span>
        <button
          type="button"
          className="metric-color-reset-all"
          onClick={() => resetAll()}
          disabled={!hasAny}
        >
          {t("全部重置")}</button>
      </div>
      {saveError && <div className="metric-color-error">{t("保存失败（请确认已登录管理员）")}</div>}
      {METRIC_COLOR_GROUPS.map((group) => (
        <div className="metric-color-group" key={group.id}>
          <div className="metric-color-group-title">{t(group.label)}</div>
          <div className="metric-color-list">
            {METRIC_COLOR_META.filter((item) => item.group === group.id).map(({ key, label }) => {
              const Icon = ICONS[key];
              const overridden = colors[key] != null;
              return (
                <div className="metric-color-row" key={key}>
                  <Icon size={14} className="metric-color-icon" />
                  <span className="metric-color-name">{t(label)}</span>
                  <label className="metric-color-swatch" style={{ background: valueOf(key) }}>
                    <input
                      type="color"
                      value={valueOf(key)}
                      onChange={(event) => setColor(key, event.target.value)}
                      aria-label={t("{0} 颜色", [t(label)])}
                    />
                  </label>
                  <button
                    type="button"
                    className="metric-color-reset"
                    onClick={() => resetColor(key)}
                    disabled={!overridden}
                    aria-label={t("恢复 {0} 默认色", [t(label)])}
                    title={t("恢复默认")}
                  >
                    <RotateCcw size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
