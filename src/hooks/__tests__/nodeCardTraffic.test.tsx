// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { convertMonitorNodeToInfo, convertMonitorNodeToMetrics, safeMonitorNodes } from "@/types/monitor";
import { periodTrafficNode } from "@/test/fixtures/traffic";
import type { NodeInfo, NodeMetrics } from "@/types/theme";

const snapshot = vi.hoisted(() => ({ meta: undefined as NodeInfo | undefined, metrics: undefined as NodeMetrics | undefined }));
vi.mock("@/hooks/useNode", () => ({ useNodeCardSnapshots: () => snapshot }));
vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => ({
  showCardGroup: false, fakePingForUnbound: false, homepagePingBindings: {},
  enableHomepageMultiPing: false, homepageMultiPingTaskIds: [], homepageNodePingSettings: {},
}) }));
vi.mock("@/hooks/usePriceVisibility", () => ({ usePriceVisibility: () => ({ isPriceVisible: false }) }));
vi.mock("@/hooks/useClock", () => ({ useHourlyClock: () => 0, useMinuteClock: () => 0 }));
vi.mock("@/hooks/useFakePing", () => ({ useFakePingFallback: () => ({ lastValue: null, loss: null }) }));
vi.mock("@/hooks/usePingOverview", () => ({
  useNodePingOverview: () => ({}), useNodePingOverviewLines: () => [], usePingBuckets: () => [], buildPingBuckets: () => [],
}));
vi.mock("@/i18n", () => ({ useTranslate: () => (text: string) => text }));

function CardTraffic() {
  const model = useNodeCardModel("1");
  return model.node ? <div data-fraction={model.traffic.fraction} data-color={model.traffic.color}>
    {model.traffic.detail} · {model.traffic.remainingLabel}
  </div> : null;
}
afterEach(() => vi.unstubAllGlobals());

it("renders current-period quota, zero, unavailable and over-quota states on snapshot updates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  const root = createRoot(container);
  async function show(raw: unknown) {
    const [node] = safeMonitorNodes([raw]);
    snapshot.meta = convertMonitorNodeToInfo(node);
    snapshot.metrics = convertMonitorNodeToMetrics(node);
    await act(async () => root.render(<CardTraffic />));
  }
  try {
    for (const online of [true, false]) {
      await show({ ...periodTrafficNode, online });
      expect(container.textContent).toBe("18.55 GB / 1000 GB · 981.45 GB");
      expect(Number(container.firstElementChild?.getAttribute("data-fraction"))).toBeCloseTo(0.01855, 5);
    }
    await show({ ...periodTrafficNode, month_used: 0 });
    expect(container.textContent).toBe("0 B / 1000 GB · 1000.00 GB");
    expect(container.firstElementChild?.getAttribute("data-fraction")).toBe("0");

    for (const [mode, expected] of [["sum", "30.00 GB"], ["up", "10.00 GB"], ["down", "20.00 GB"], ["max", "20.00 GB"]]) {
      await show({ ...periodTrafficNode, month_used: undefined, month_tx: 10 * 1024 ** 3, month_rx: 20 * 1024 ** 3, traffic_mode: mode });
      expect(container.textContent).toContain(`${expected} / 1000 GB`);
    }
    await show({ id: 1, online: true, traffic_limit: 200, total_tx: 500, total_rx: 600, metrics: {} });
    expect(container.textContent).toBe("本周期暂无数据 · 暂无数据");
    expect(container.firstElementChild?.getAttribute("data-color")).toBe("var(--text-tertiary)");

    await show({ ...periodTrafficNode, month_used: 1200 * 1024 ** 3 });
    expect(container.textContent).toBe("1.17 TB / 1000 GB · 0 B");
    expect(container.firstElementChild?.getAttribute("data-fraction")).toBe("1");
  } finally {
    await act(async () => root.unmount());
  }
});
