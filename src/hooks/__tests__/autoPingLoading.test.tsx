// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { HomepagePingLine, PingOverviewItem } from "@/types/komari";
import { useNodeCardModel } from "../useNodeCardModel";
import { pingEmptyLabels } from "@/components/node/nodeCardShared";

const fixture = vi.hoisted(() => ({
  ping: { client: "example-node", isAssigned: false, loadState: "pending", lastValue: null, samples: [], max: 1, loss: null } as PingOverviewItem,
  lines: [] as HomepagePingLine[],
}));
vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => ({
  showCardGroup: false, fakePingForUnbound: false, homepagePingBindings: {},
  enableHomepageMultiPing: true, homepageMultiPingTaskIds: [], homepageNodePingSettings: {},
}) }));
vi.mock("@/hooks/useNode", () => ({ useNodeCardSnapshots: () => ({
  meta: { uuid: "example-node", name: "Example Node", tags: "", os: "linux", cpu_cores: 1 },
  metrics: { online: true, trafficUp: 0, trafficDown: 0, uptime: 0, load1: 0, netUp: 0, netDown: 0 },
}) }));
vi.mock("@/hooks/usePriceVisibility", () => ({ usePriceVisibility: () => ({ isPriceVisible: false }) }));
vi.mock("@/hooks/useClock", () => ({ useHourlyClock: () => 1_780_000_000_000, useMinuteClock: () => 1_780_000_000_000 }));
vi.mock("@/hooks/useFakePing", () => ({ useFakePingFallback: (_uuid: string, ping: PingOverviewItem) => ping }));
vi.mock("@/hooks/usePingOverview", async (original) => ({
  ...await original<typeof import("../usePingOverview")>(),
  useNodePingOverview: () => fixture.ping,
  useNodePingOverviewLines: () => fixture.lines,
  usePingBuckets: () => [],
}));

function CardState() {
  const model = useNodeCardModel("example-node", { includeMultiPing: true });
  if (!model.node) return null;
  return <div data-bars={String(model.shouldRenderPingBars)}>{model.homepagePingLines.length
    ? model.homepagePingLines.map((line) => line.taskName).join(",")
    : pingEmptyLabels(model.hasRealHomepagePingBinding, model.pingLoading, model.pingError, model.pingLoadingSilently).text}</div>;
}
afterEach(() => vi.unstubAllGlobals());

it("空全局槽位在自动任务加载前不闪现未配置，成功、无任务、失败分别显示正确状态", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CardState />));
  expect(container.textContent).toBe("—");
  expect(container.firstElementChild?.getAttribute("data-bars")).toBe("true");
  fixture.lines = [1, 2, 3].map((id) => ({ ...fixture.ping, taskId: id, taskName: `Example ${id}`, isAssigned: true, loadState: "ready" }));
  await act(async () => root.render(<CardState />));
  expect(container.textContent).toBe("Example 1,Example 2,Example 3");
  fixture.lines = [];
  fixture.ping = { ...fixture.ping, loadState: "ready" };
  await act(async () => root.render(<CardState />));
  expect(container.textContent).toBe("未配置"); // 仅查完确认无任务后显示
  fixture.ping = { ...fixture.ping, loadState: "error" };
  await act(async () => root.render(<CardState />));
  expect(container.textContent).toBe("加载失败");
  await act(async () => root.unmount()); container.remove();
});
