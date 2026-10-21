// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLanguage } from "@/i18n";
import type { HomepagePingDisplayLine } from "@/types/theme";
import { DEFAULT_THEME_SETTINGS } from "@/utils/themeSettings";
import { MultiPingStatus } from "../MultiPingStatus";
import { curveInspectionIndex } from "../curveInspection";

vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => ({ ...DEFAULT_THEME_SETTINGS, homepageLatencyDisplay: "curve" }) }));
vi.mock("@/hooks/usePreferences", () => ({ usePreferences: () => ({ resolvedAppearance: "light" }) }));
vi.mock("@/hooks/useMetricColors", () => ({ useMetricColorsVersion: () => 0 }));

const start = 1_800_000_000_000;
function line(id: number, values: (number | null)[], losses: number[]): HomepagePingDisplayLine {
  return { taskId: id, taskName: `Route ${id}`, client: "node", isAssigned: true, loadState: "ready", lastValue: 999, loss: 99,
    max: 1000, samples: [], buckets: values.map((value, index) => ({ value, index, loss: losses[index], total: 10,
      lost: value == null ? 10 : 0, startAt: start + index * 60_000, endAt: start + (index + 1) * 60_000 })) };
}
const lines = [line(1, [10, 20, 30], [0, 0, 0]), line(2, [40, null, 60], [0, 100, 10]), line(3, [70, 80, 90], [1, 2, 3])];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); setLanguage("en");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); setLanguage(null); vi.unstubAllGlobals(); });
function pointer(name: string, clientX: number, touch = false) {
  const event = new MouseEvent(name, { bubbles: true, clientX });
  Object.defineProperty(event, "pointerType", { value: touch ? "touch" : "mouse" });
  return event;
}
function chart(index = 0) {
  const svg = container.querySelectorAll<SVGSVGElement>(".multi-ping-curve svg")[index];
  svg.getBoundingClientRect = () => ({ left: 0, width: 160 } as DOMRect);
  return svg;
}

it("hovers all routes at the same time with one tooltip and only affects this card", async () => {
  await act(async () => root.render(<><MultiPingStatus lines={lines} density="large" /><MultiPingStatus lines={lines} density="compact" /></>));
  await act(async () => chart().dispatchEvent(pointer("pointermove", 80)));
  const tooltip = container.querySelector('[role="status"]')!;
  expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  expect(tooltip.textContent).toContain("Route 1"); expect(tooltip.textContent).toContain("20 ms");
  expect(tooltip.textContent).toContain("Route 2"); expect(tooltip.textContent).toContain("Failed"); expect(tooltip.textContent).toContain("100.0%");
  expect(tooltip.textContent).toContain("Route 3"); expect(tooltip.textContent).toContain("80 ms"); expect(tooltip.textContent).toContain("2.0%");
  expect(tooltip.textContent).not.toContain("999");
  const cursors = container.querySelectorAll(".multi-ping-curve-cursor");
  expect(cursors).toHaveLength(3);
  expect([...cursors].map((cursor) => cursor.getAttribute("x1"))).toEqual(["80", "80", "80"]);
  await act(async () => chart().dispatchEvent(pointer("pointerout", 80)));
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("supports tap, keyboard, localization and outside dismissal for the whole card", async () => {
  await act(async () => root.render(<MultiPingStatus lines={lines} density="compact" />));
  const svg = chart(2);
  await act(async () => svg.dispatchEvent(pointer("pointerdown", 10, true)));
  await act(async () => svg.focus());
  await act(async () => svg.dispatchEvent(pointer("pointerout", 10, true)));
  expect(container.querySelectorAll(".multi-ping-curve-cursor")).toHaveLength(3);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("10 ms");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("40 ms");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("70 ms");
  await act(async () => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("80 ms");
  await act(async () => setLanguage("zh-TW"));
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("同一時段各線路延遲與丟包");
  await act(async () => svg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => svg.dispatchEvent(pointer("pointerdown", 10, true)));
  await act(async () => document.body.dispatchEvent(pointer("pointerdown", 10, true)));
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it("matches timestamps across different bucket widths without filling missing intervals", () => {
  const wide = [{ ...lines[0].buckets[0], endAt: start + 120_000 }];
  expect(curveInspectionIndex(wide, start + 90_000, 0.5)).toBe(0);
  expect(curveInspectionIndex(wide, start + 120_000, 0.5)).toBeNull();
  expect(curveInspectionIndex([], start, 0.5)).toBeNull();
});
