// @vitest-environment jsdom
import { setLanguage } from "@/i18n";
import type { PingOverviewBucket } from "@/types/theme";
import { normalizeThemeSettings } from "@/utils/themeSettings";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LatencyCurve } from "../LatencyCurve";
import { curveIndexAt, latencyCurveGeometry } from "../latencyCurveGeometry";

const buckets: PingOverviewBucket[] = [20, 0, null, 50, null, 40].map((value, index) => ({
  value, index, total: index === 4 ? 0 : 10, lost: value == null ? 10 : 1,
  loss: index === 4 ? null : value == null ? 100 : 10, startAt: null, endAt: null,
}));
afterEach(() => { setLanguage(null); vi.unstubAllGlobals(); });

it("retains blocks for old or invalid configs and accepts curves", () => {
  expect(normalizeThemeSettings({}).homepageLatencyDisplay).toBe("bars");
  expect(normalizeThemeSettings({ homepageLatencyDisplay: "unknown" } as never).homepageLatencyDisplay).toBe("bars");
  expect(normalizeThemeSettings({ homepageLatencyDisplay: "curve" }).homepageLatencyDisplay).toBe("curve");
});

it("preserves zero latency, timeout and no-sample gaps and isolated points", () => {
  const geometry = latencyCurveGeometry(buckets);
  expect(geometry.paths).toHaveLength(3);
  expect(geometry.points[1]).not.toBeNull();
  expect(geometry.points[2]).toBeNull();
  expect(geometry.points[4]).toBeNull();
  expect(geometry.paths.every(({ line }) => !/NaN|Infinity/.test(line))).toBe(true);
  expect(latencyCurveGeometry([]).paths).toEqual([]);
  expect(curveIndexAt(0, 6)).toBe(0);
  expect(curveIndexAt(1, 6)).toBe(5);
  expect(curveIndexAt(0.5, 0)).toBeNull();
});

it("supports keyboard inspection with localized latency/loss tooltips", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguage("en");
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LatencyCurve buckets={buckets} color="#123456" label="Route" />));
    const svg = container.querySelector("svg")!;
    await act(async () => svg.focus());
    expect(container.querySelector('[role="status"]')?.textContent).toContain("40 ms · Packet loss 10.0%");
    await act(async () => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("No samples");
    await act(async () => setLanguage("zh-TW"));
    expect(svg.getAttribute("aria-label")).toContain("延遲曲線");
    await act(async () => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("keeps a touched sample selected through focus and pointer leave, then dismisses outside", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LatencyCurve buckets={buckets} color="#123456" label="Route" />));
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, width: 160 } as DOMRect);
    const pointer = (name: string) => {
      const event = new MouseEvent(name, { bubbles: true, clientX: 10 });
      Object.defineProperty(event, "pointerType", { value: "touch" });
      return event;
    };
    await act(async () => svg.dispatchEvent(pointer("pointerdown")));
    await act(async () => svg.focus());
    expect(container.querySelector('[role="status"]')?.textContent).toContain("20 ms");
    await act(async () => svg.dispatchEvent(pointer("pointerout")));
    expect(container.querySelector('[role="status"]')?.textContent).toContain("20 ms");
    await act(async () => document.body.dispatchEvent(pointer("pointerdown")));
    expect(container.querySelector('[role="status"]')).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); }
});
