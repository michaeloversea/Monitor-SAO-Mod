// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { setLanguage } from "@/i18n";
import { OverviewTrafficChart } from "../OverviewTrafficChart";

afterEach(() => {
  setLanguage(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps an open tooltip and its size observer when live rates refresh", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const observe = vi.fn();
  const disconnect = vi.fn();
  const Observer = vi.fn(function (this: { observe: typeof observe; disconnect: typeof disconnect }, callback: ResizeObserverCallback) {
    this.observe = vi.fn(() => { observe(); callback([], this as unknown as ResizeObserver); });
    this.disconnect = disconnect;
  });
  vi.stubGlobal("ResizeObserver", Observer);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 40, y: 100, left: 40, top: 100, right: 290, bottom: 188, width: 250, height: 88,
    toJSON: () => ({}),
  });
  setLanguage("en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<OverviewTrafficChart netUp={1_000_000} netDown={2_000_000} />));
    await act(async () => root.render(<OverviewTrafficChart netUp={3_000_000} netDown={4_000_000} />));
    const chart = container.querySelector(".mao-realtime-chart-canvas-wrap")!;
    await act(async () => chart.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 170 })));
    expect(container.querySelector(".mao-chart-tooltip")?.textContent).toContain("Upload");
    const value = container.querySelector(".mao-chart-tooltip-val")?.textContent;
    await act(async () => root.render(<OverviewTrafficChart netUp={5_000_000} netDown={6_000_000} />));
    expect(container.querySelector(".mao-chart-tooltip-val")?.textContent).toBe(value);
    expect(Observer).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
    expect(disconnect).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("resize")));
    expect(container.querySelector(".mao-chart-tooltip")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
  expect(disconnect).toHaveBeenCalledTimes(2);
});
