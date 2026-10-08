// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PingRecordsResponse } from "@/types/komari";
import { PingChart } from "../PingChart";

const fixture = vi.hoisted(() => ({
  data: { count: 2, intervalSeconds: 60, records: [
    { client: "node", task_id: 1, time: 1_780_000_000_000, value: 40, loss: 0 },
    { client: "node", task_id: 1, time: 1_780_000_060_000, value: 50, loss: 10 },
  ], tasks: [{ id: 1, name: "CT", clients: ["node"], interval: 60, loss: 0, type: "icmp", target: "", weight: 1 }] } as PingRecordsResponse,
  options: undefined as unknown,
  dataRef: undefined as unknown,
  optionUpdates: 0,
  dataUpdates: 0,
  creations: 0,
  destructions: 0,
  seriesUpdates: [] as [number, boolean][],
}));
vi.mock("@/hooks/useRecords", () => ({ usePingRecords: () => ({ data: fixture.data, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/usePreferences", () => ({ usePreferences: () => ({ resolvedAppearance: "light" }) }));
vi.mock("../chartShared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../chartShared")>();
  return { ...original, useResponsiveChartSize: () => ({ w: 1200, h: 400, ref: () => {} }) };
});
vi.mock("uplot-react", async () => {
  const { createElement, useEffect } = await import("react");
  return { default: function MockUplot({ options, data, onCreate, onDelete }: { onCreate?: (plot: unknown) => void; onDelete?: (plot: unknown) => void; options: { hooks: { ready: ((plot: unknown) => void)[] } }; data: unknown }) {
    // 模拟 wrapper 的实例生命周期与 options/data 更新，明确捕获重建或重绘触发条件。
    useEffect(() => {
      fixture.creations += 1;
      const plot = { bbox: { left: 56, width: 1130 }, over: { clientWidth: 1130 }, scales: { x: { min: 1_780_000_000, max: 1_780_000_120 }, y: { min: 0, max: 100 } },
        setScale: (_axis: string, range: { min: number; max: number }) => { plot.scales.y = range; },
        series: [{ show: true }, { show: true }], batch: (fn: () => void) => fn(),
        setSeries: (index: number, state: { show: boolean }) => { plot.series[index].show = state.show; fixture.seriesUpdates.push([index, state.show]); },
      };
      options.hooks.ready.forEach((hook) => hook(plot));
      onCreate?.(plot);
      return () => { fixture.destructions += 1; onDelete?.(plot); };
    }, [options, onCreate, onDelete]);
    useEffect(() => { fixture.options = options; fixture.optionUpdates += 1; }, [options]);
    useEffect(() => { fixture.dataRef = data; fixture.dataUpdates += 1; }, [data]);
    return createElement("div", { "data-testid": "delay-curve" });
  } };
});

afterEach(() => { vi.unstubAllGlobals(); });
describe("丢包色带独立显隐", () => {
  it("色带、单线、隐藏全部开关不更新曲线 options/data 或重建实例", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<PingChart uuid="node" hours={1} />));
    const band = container.querySelector<HTMLElement>(".instance-ping-loss-bands")!;
    const curve = container.querySelector('[data-testid="delay-curve"]');
    const optionsBefore = fixture.options;
    const dataBefore = fixture.dataRef;
    const counts = [fixture.creations, fixture.destructions, fixture.optionUpdates, fixture.dataUpdates];
    const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("丢包色带"))!;
    expect(band.hidden).toBe(false);
    await act(async () => toggle.click());
    expect(band.hidden).toBe(true);
    expect(container.querySelector('[data-testid="delay-curve"]')).toBe(curve);
    await act(async () => toggle.click());
    expect(band.hidden).toBe(false);
    const legend = [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("CT"))!;
    await act(async () => legend.click());
    expect(fixture.seriesUpdates.at(-1)).toEqual([1, false]);
    expect(container.querySelector('[data-testid="delay-curve"]')).toBe(curve);
    expect(band.hidden).toBe(true); // 全部隐藏时色带也折叠，曲线实例保留
    const showAll = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("显示全部"))!;
    await act(async () => showAll.click());
    expect(fixture.seriesUpdates.at(-1)).toEqual([1, true]);
    expect(band.hidden).toBe(false);
    expect(fixture.options).toBe(optionsBefore);
    expect(fixture.dataRef).toBe(dataBefore);
    expect([fixture.creations, fixture.destructions, fixture.optionUpdates, fixture.dataUpdates]).toEqual(counts);
    await act(async () => root.unmount()); container.remove();
  });
});
