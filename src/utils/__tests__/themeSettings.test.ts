import { describe, expect, it } from "vitest";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("normalizeThemeSettings", () => {
  it("keeps mini and falls unknown saved view modes back to compact", () => {
    const settings = normalizeThemeSettings({
      desktopNodeViewMode: "retired-view",
      mobileNodeViewMode: "retired-view",
    } as never);

    expect(settings.desktopNodeViewMode).toBe("compact");
    expect(settings.mobileNodeViewMode).toBe("compact");
    expect(normalizeThemeSettings({ desktopNodeViewMode: "mini" }).desktopNodeViewMode).toBe(
      "mini",
    );
    expect(normalizeThemeSettings({ mobileNodeViewMode: "mini" }).mobileNodeViewMode).toBe("mini");
    expect(normalizeThemeSettings({ mobileNodeViewMode: "list" }).mobileNodeViewMode).toBe(
      "compact",
    );
  });

  it("defaults overview ratings on unless explicitly disabled, while traffic and asset ratings default to false", () => {
    const defaults = normalizeThemeSettings({});
    expect(defaults.showOverviewRatings).toBe(true);
    expect(defaults.showBandwidthRating).toBe(true);
    expect(defaults.showTrafficRating).toBe(false);
    expect(defaults.showAssetRating).toBe(false);

    expect(normalizeThemeSettings({ showOverviewRatings: false }).showOverviewRatings).toBe(false);
    expect(normalizeThemeSettings({ showTrafficRating: true }).showTrafficRating).toBe(true);
    expect(normalizeThemeSettings({ showAssetRating: true }).showAssetRating).toBe(true);
    expect(normalizeThemeSettings({ showBandwidthRating: false }).showBandwidthRating).toBe(false);
  });

  it("normalizes homepage multi-ping tasks while preserving an enabled draft for repair", () => {
    expect(normalizeThemeSettings({}).enableHomepageMultiPing).toBe(false);
    expect(
      normalizeThemeSettings({
        enableHomepageMultiPing: true,
        homepageMultiPingTaskIds: [3, 1],
      }).enableHomepageMultiPing,
    ).toBe(true);

    const resolved = normalizeThemeSettings({
      enableHomepageMultiPing: true,
      homepageMultiPingTaskIds: [3, 1, 3, 2, 4],
    });
    expect(resolved.enableHomepageMultiPing).toBe(true);
    expect(resolved.homepageMultiPingTaskIds).toEqual([3, 1, 2, 4]);
  });

  it("defaults home sort to weight ascending and falls back to a field's natural direction", () => {
    const base = normalizeThemeSettings({});
    expect(base.enableHomeSort).toBe(true);
    expect(base.homeSortField).toBe("default");
    expect(base.homeSortDirection).toBe("asc");

    // 指定字段但缺省方向 → 回落该字段自然方向(网速为降序)。
    expect(normalizeThemeSettings({ homeSortField: "speed" } as never).homeSortDirection).toBe("desc");
    // 非法字段回落 default。
    expect(normalizeThemeSettings({ homeSortField: "nope" } as never).homeSortField).toBe("default");
  });

  it("keeps fake ping off unless explicitly enabled", () => {
    expect(normalizeThemeSettings({}).fakePingForUnbound).toBe(false);
    expect(normalizeThemeSettings({ fakePingForUnbound: true }).fakePingForUnbound).toBe(true);
    // 非布尔真值不算显式开启。
    expect(
      normalizeThemeSettings({ fakePingForUnbound: "yes" } as never).fakePingForUnbound,
    ).toBe(false);
  });

  it("defaults showPriceForGuests to false unless explicitly enabled", () => {
    expect(normalizeThemeSettings({}).showPriceForGuests).toBe(false);
    expect(normalizeThemeSettings({ showPriceForGuests: true }).showPriceForGuests).toBe(true);
    expect(normalizeThemeSettings({ showPriceForGuests: false }).showPriceForGuests).toBe(false);
    expect(normalizeThemeSettings({ showPriceForGuests: "yes" } as never).showPriceForGuests).toBe(false);
  });

  it("defaults showTrafficPageForGuests to false unless explicitly enabled", () => {
    expect(normalizeThemeSettings({}).showTrafficPageForGuests).toBe(false);
    expect(normalizeThemeSettings({ showTrafficPageForGuests: true }).showTrafficPageForGuests).toBe(true);
    expect(normalizeThemeSettings({ showTrafficPageForGuests: false }).showTrafficPageForGuests).toBe(false);
    expect(normalizeThemeSettings({ showTrafficPageForGuests: "yes" } as never).showTrafficPageForGuests).toBe(false);
  });

  it("parses hiddenNodes from a delimited string and dedupes", () => {
    expect(normalizeThemeSettings({}).hiddenNodes).toEqual([]);
    expect(
      normalizeThemeSettings({ hiddenNodes: "节点A, 节点A\nuuid-1；节点B" } as never).hiddenNodes,
    ).toEqual(["节点A", "uuid-1", "节点B"]);
  });

  it("normalizes adminNickname string, trims whitespace and limits length", () => {
    expect(normalizeThemeSettings({}).adminNickname).toBe("");
    expect(normalizeThemeSettings({ adminNickname: "  jerry  " }).adminNickname).toBe("jerry");
    expect(normalizeThemeSettings({ adminNickname: 123 } as never).adminNickname).toBe("");
  });

  it("defaults showUngroupedTab and overviewFollowGroup to false unless explicitly enabled", () => {
    const base = normalizeThemeSettings({});
    expect(base.showUngroupedTab).toBe(false);
    expect(base.overviewFollowGroup).toBe(false);

    const enabled = normalizeThemeSettings({
      showUngroupedTab: true,
      overviewFollowGroup: true,
    });
    expect(enabled.showUngroupedTab).toBe(true);
    expect(enabled.overviewFollowGroup).toBe(true);
  });

  it("normalizes clusterOverviewMode correctly across all valid options", () => {
    expect(normalizeThemeSettings({ clusterOverviewMode: "classic" }).clusterOverviewMode).toBe("classic");
    expect(normalizeThemeSettings({ clusterOverviewMode: "nodes" }).clusterOverviewMode).toBe("nodes");
    expect(normalizeThemeSettings({ clusterOverviewMode: "traffic" as never }).clusterOverviewMode).toBe("classic");
    expect(normalizeThemeSettings({ clusterOverviewMode: "carousel" as never }).clusterOverviewMode).toBe("nodes");
    expect(normalizeThemeSettings({ clusterOverviewMode: "invalid" as never }).clusterOverviewMode).toBe("classic");
  });

  it("normalizes matrixColorTheme correctly", () => {
    expect(normalizeThemeSettings({ matrixColorTheme: "default" }).matrixColorTheme).toBe("default");
    expect(normalizeThemeSettings({ matrixColorTheme: "eva" }).matrixColorTheme).toBe("eva");
    expect(normalizeThemeSettings({ matrixColorTheme: "invalid" as never }).matrixColorTheme).toBe("default");
  });

  it("normalizes matrixMockFill correctly", () => {
    expect(normalizeThemeSettings({ matrixMockFill: true }).matrixMockFill).toBe(true);
    expect(normalizeThemeSettings({ matrixMockFill: false }).matrixMockFill).toBe(false);
    expect(normalizeThemeSettings({ matrixMockFill: "yes" as never }).matrixMockFill).toBe(false);
    expect(normalizeThemeSettings({}).matrixMockFill).toBe(false);
  });

  it("normalizes matrixBootAnimation correctly", () => {
    expect(normalizeThemeSettings({ matrixBootAnimation: true }).matrixBootAnimation).toBe(true);
    expect(normalizeThemeSettings({ matrixBootAnimation: false }).matrixBootAnimation).toBe(false);
    expect(normalizeThemeSettings({}).matrixBootAnimation).toBe(true);
  });

  it("normalizes matrixCustomPattern correctly", () => {
    expect(normalizeThemeSettings({ matrixCustomPattern: [1, 2, 3] }).matrixCustomPattern).toEqual([1, 2, 3]);
    expect(normalizeThemeSettings({ matrixCustomPattern: [99, 0, 50] }).matrixCustomPattern).toEqual([0, 50, 99]);
    expect(normalizeThemeSettings({ matrixCustomPattern: [] }).matrixCustomPattern).toEqual([]);
    expect(normalizeThemeSettings({ matrixCustomPattern: [-1, 100, 200] }).matrixCustomPattern).toEqual([]);
    expect(normalizeThemeSettings({ matrixCustomPattern: "invalid" as never }).matrixCustomPattern).toBeNull();
    expect(normalizeThemeSettings({}).matrixCustomPattern).toBeNull();
  });

  it("normalizes matrixUserPresets correctly", () => {
    const raw = [
      { id: "1", name: "  设计A  ", indices: [5, 2, 2, 99, 105, -1], createdAt: 12345 },
      { id: "2", invalid: true },
    ];
    const normalized = normalizeThemeSettings({ matrixUserPresets: raw as never }).matrixUserPresets;
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toEqual({
      id: "1",
      name: "设计A",
      indices: [2, 5, 99],
      createdAt: 12345,
    });
  });
});

describe("v1.2.1 status settings compatibility", () => {
  it("accepts both palettes and all intro effects, falling back for unknown values", () => {
    for (const matrixColorTheme of ["cyberpunk", "divergence"] as const) expect(normalizeThemeSettings({ matrixColorTheme }).matrixColorTheme).toBe(matrixColorTheme);
    for (const matrixBootEffect of ["laser-scan", "digital-rain", "cyber-glitch", "divergence-flux"] as const) expect(normalizeThemeSettings({ matrixBootEffect }).matrixBootEffect).toBe(matrixBootEffect);
    expect(normalizeThemeSettings({ matrixBootEffect: "unknown" } as never).matrixBootEffect).toBe("laser-scan");
  });
  it("round-trips Hub text JSON fields without losing the existing language and per-node lines", () => {
    const settings = normalizeThemeSettings({
      defaultLanguage: "en", enableHomepageMultiPing: true, homepageMultiPingTaskIds: [],
      homepageNodePingSettings: { "example-id": { mode: "custom", taskIds: [8, 3] } },
      pingLatencyThresholds: JSON.stringify({ excellent: 20, good: 50, moderate: 90, elevated: 180 }),
      pingLatencyColors: JSON.stringify({ excellent: " #AbC " }),
      pingLossThresholds: JSON.stringify({ low: 1.5, medium: 7.5 }),
      pingLossColors: JSON.stringify({ zero: "#FFF" }),
      trafficSpectrumColors: JSON.stringify({ start: "#abc", end: "#F00" }),
    } as never);
    expect(settings.defaultLanguage).toBe("en"); expect(settings.homepageMultiPingTaskIds).toEqual([]);
    expect(settings.homepageNodePingSettings["example-id"]).toEqual({ mode: "custom", taskIds: [8, 3] });
    expect(settings.pingLatencyThresholds).toEqual({ excellent: 20, good: 50, moderate: 90, elevated: 180 });
    expect(settings.pingLatencyColors.excellent).toBe("#aabbcc"); expect(settings.pingLossColors.zero).toBe("#ffffff");
    expect(settings.pingLossThresholds).toEqual({ low: 1.5, medium: 7.5 });
    expect(settings.trafficSpectrumColors).toMatchObject({ start: "#aabbcc", end: "#ff0000" });
  });
  it("repairs invalid thresholds and colors without rendering non-finite values", () => {
    const settings = normalizeThemeSettings({
      pingLatencyThresholds: { excellent: 20.4, good: 20.5, moderate: NaN, elevated: Infinity },
      pingLossThresholds: { low: 99.99, medium: 1 },
      pingLossColors: { zero: "url(javascript:bad)" }, trafficSpectrumColors: "{broken",
    } as never);
    const bounds = Object.values(settings.pingLatencyThresholds);
    expect(bounds.every((n, i) => Number.isInteger(n) && n > 0 && (i === 0 || n > bounds[i - 1]))).toBe(true);
    expect(settings.pingLossThresholds).toEqual({ low: 99.9, medium: 100 });
    expect(settings.pingLossColors.zero).toBe(normalizeThemeSettings({}).pingLossColors.zero);
    expect(settings.trafficSpectrumColors).toEqual(normalizeThemeSettings({}).trafficSpectrumColors);
  });
});
