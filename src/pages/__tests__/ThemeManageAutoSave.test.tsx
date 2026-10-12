// @vitest-environment jsdom
import { setLanguage } from "@/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeThemeSettings, STATUS_BAR_PRESETS } from "@/utils/themeSettings";
import { ThemeManage } from "../ThemeManage";

const fixture = vi.hoisted(() => ({
  config: { theme: "sao", theme_settings: { defaultLanguage: "zh-TW", enableHomepageMultiPing: true, homepageMultiPingTaskIds: [], homepageNodePingSettings: { "example-node": { mode: "custom", taskIds: [5, 4] } }, futureSetting: "keep" } },
  save: vi.fn(async (_theme: string, _settings: unknown) => {}), invalidate: vi.fn(async () => {}),
}));
vi.mock("@/hooks/usePublicConfig", () => ({ usePublicConfig: () => ({ data: fixture.config, isLoading: false }) }));
vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => normalizeThemeSettings(fixture.config.theme_settings as never) }));
vi.mock("@/hooks/useClock", () => ({ useHourlyClock: () => 1_800_000_000_000 }));
vi.mock("@/services/queryClient", () => ({ queryClient: { invalidateQueries: fixture.invalidate } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === "clients" ? [{ uuid: "example-node", name: "Example Node" }] : [], isLoading: false, error: null }) }));
vi.mock("@/services/api", () => ({ ApiRequestError: class extends Error {}, saveThemeSettings: fixture.save, getAdminClients: vi.fn(), getAdminPingTasks: vi.fn(), getNodes: vi.fn() }));
vi.mock("@/components/node/LatencyBars", () => ({ LatencyBars: () => null }));
vi.mock("@/components/node/QualityBars", () => ({ QualityBars: () => null }));
let root: Root;
let container: HTMLDivElement;
async function tick(ms = 1100) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(e => e.textContent === text || e.querySelector('.theme-tab-label')?.textContent === text);
  expect(button, text).toBeDefined(); await act(async () => button!.click());
}
beforeEach(async () => {
  setLanguage("zh-CN");
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("innerWidth", 787);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  fixture.save.mockClear(); fixture.invalidate.mockClear();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter initialEntries={["/?view=theme-manage&tab=card"]}><ThemeManage /></MemoryRouter>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setLanguage(null); });
describe("ThemeManage auto-save integration", () => {
  it("does not save hydration; linked presets preserve old per-node lines, language, empty globals and unmanaged settings", async () => {
    await tick(); expect(fixture.save).not.toHaveBeenCalled();
    await click(STATUS_BAR_PRESETS[1].name); await click(STATUS_BAR_PRESETS[2].name); await tick();
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.save.mock.calls[0][1]).toMatchObject({
      defaultLanguage: "zh-TW", homepageMultiPingTaskIds: [], homepageNodePingSettings: { "example-node": { mode: "custom", taskIds: [5, 4] } }, futureSetting: "keep",
      trafficSpectrumColors: STATUS_BAR_PRESETS[2].colors, pingLatencyColors: STATUS_BAR_PRESETS[2].latencyColors, pingLossColors: STATUS_BAR_PRESETS[2].lossColors,
    });
    expect(fixture.invalidate).toHaveBeenCalledWith({ queryKey: ["public"] });
  });
  it("changing tabs does not discard pending edits", async () => {
    await click(STATUS_BAR_PRESETS[1].name); await click("首页"); await tick();
    expect(fixture.save).toHaveBeenCalledTimes(1);
    expect(fixture.save.mock.calls[0][1]).toMatchObject({ trafficSpectrumColors: STATUS_BAR_PRESETS[1].colors });
  });
});
