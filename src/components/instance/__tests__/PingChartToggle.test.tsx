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
  plot: undefined as unknown,
}));
vi.mock("@/hooks/useRecords", () => ({ usePingRecords: () => ({ data: fixture.data, isError: false, isFetching: false, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/hooks/usePreferences", () => ({ usePreferences: () => ({ resolvedAppearance: "light" }) }));
vi.mock("../chartShared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../chartShared")>();
  return { ...original, useResponsiveChartSize: () => ({ w: 1200, h: 400, ref: () => {} }) };
});
vi.mock("uplot-react", async () => {
  const { createElement, useEffect, useRef } = await import("react");
  return { default: function MockUplot({ options, data, onCreate, onDelete }: { onCreate?: (plot: unknown) => void; onDelete?: (plot: unknown) => void; options: { hooks: Record<string, ((plot: unknown) => void)[]> }; data: number[][] }) {
    const rootRef = useRef<HTMLDivElement>(null);
    // 模拟 wrapper 的实例生命周期与 options/data 更新，明确捕获重建或重绘触发条件。
    useEffect(() => {
      fixture.creations += 1;
      const element = rootRef.current!;
      Object.defineProperty(element, "clientWidth", { configurable: true, value: 1130 });
      Object.defineProperty(element, "clientHeight", { configurable: true, value: 344 });
      element.getBoundingClientRect = () => ({ left: 56, top: 210, width: 1130, height: 344, right: 1186, bottom: 554, x: 56, y: 210, toJSON: () => ({}) });
      const plot = { root: element, bbox: { left: 56, width: 1130 }, over: element, cursor: { left: -10, top: -10, idx: null as number | null }, scales: { x: { min: 1_780_000_000, max: 1_780_000_120 }, y: { min: 0, max: 100 } },
        valToPos: (time: number) => (time - plot.scales.x.min) / (plot.scales.x.max - plot.scales.x.min) * 1130,
        setCursor: (position: { left: number; top: number }) => {
          plot.cursor = { ...position, idx: position.left < 0 ? null : position.left < 565 ? 0 : 1 };
          options.hooks.setCursor?.forEach((hook) => hook(plot));
        },
        setScale: (_axis: string, range: { min: number; max: number }) => { plot.scales.y = range; },
        series: [{ show: true }, { show: true }], batch: (fn: () => void) => fn(),
        setSeries: (index: number, state: { show: boolean }) => { plot.series[index].show = state.show; fixture.seriesUpdates.push([index, state.show]); },
      };
      fixture.plot = plot;
      options.hooks.init?.forEach((hook) => hook(plot));
      options.hooks.ready.forEach((hook) => hook(plot));
      onCreate?.(plot);
      return () => { options.hooks.destroy?.forEach((hook) => hook(plot)); fixture.destructions += 1; onDelete?.(plot); };
    }, [options, onCreate, onDelete]);
    useEffect(() => { fixture.options = options; fixture.optionUpdates += 1; }, [options]);
    useEffect(() => { fixture.dataRef = data; fixture.dataUpdates += 1; }, [data]);
    return createElement("div", { "data-testid": "delay-curve", ref: rootRef });
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
  it("曲线提示追加该时段丢包率，色块提示与游标联动且不改曲线或缩放", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const container = document.createElement("div"); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<PingChart uuid="node" hours={1} />));
    const plot = fixture.plot as { setCursor: (position: { left: number; top: number }) => void; scales: { x: { min: number; max: number } } };
    const xBefore = { ...plot.scales.x };
    const counts = [fixture.creations, fixture.destructions, fixture.optionUpdates, fixture.dataUpdates];
    const optionsBefore = fixture.options;
    const dataBefore = fixture.dataRef;
    await act(async () => { plot.setCursor({ left: 850, top: 100 }); await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(container.querySelector(".instance-chart-tooltip")?.textContent).toContain("50.0 ms (10.0% 丢包)");
    expect(container.querySelector<HTMLElement>(".instance-ping-cursor-extension")!.hidden).toBe(false);
    const svg = container.querySelector<SVGSVGElement>(".instance-ping-loss-band-row svg")!;
    svg.getBoundingClientRect = () => ({ left: 56, top: 100, width: 1130, height: 6, right: 1186, bottom: 106, x: 56, y: 100, toJSON: () => ({}) });
    await act(async () => { svg.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 900, clientY: 103 })); });
    expect(svg.dataset.activeCell).toBe("true");
    expect(svg.querySelector(".instance-loss-cell-hover")?.getAttribute("fill")).toBe("#facc15");
    expect(container.querySelector(".instance-chart-tooltip")?.textContent).toContain("10.0% 丢包");
    expect(container.querySelector(".instance-chart-tooltip")?.textContent).not.toContain("50.0 ms");
    const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("丢包色带"))!;
    await act(async () => toggle.click());
    expect(svg.dataset.activeCell).toBeUndefined();
    expect(container.querySelector<HTMLElement>(".instance-ping-cursor-extension")!.hidden).toBe(true);
    expect(container.querySelector(".instance-chart-tooltip")?.textContent).not.toContain("丢包");
    expect(fixture.options).toBe(optionsBefore);
    expect(fixture.dataRef).toBe(dataBefore);
    expect(plot.scales.x).toEqual(xBefore);
    expect([fixture.creations, fixture.destructions, fixture.optionUpdates, fixture.dataUpdates]).toEqual(counts);
    await act(async () => root.unmount()); container.remove();
  });
});
