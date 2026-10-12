// @vitest-environment jsdom
import type { PingRecordsResponse } from "@/types/theme";
import type { HomepageNodePingSettings } from "@/utils/pingTasks";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  nodes: ["node-a", "node-b"],
  settings: { "node-a": { mode: "custom", taskIds: [1, 2, 3] }, "node-b": { mode: "custom", taskIds: [4, 5] } } as HomepageNodePingSettings,
  load: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ data: { logged_in: true } }) }));
vi.mock("@/hooks/useNode", () => ({ useVisibleNodeUuids: () => fixture.nodes }));
vi.mock("@/hooks/useVisibleNodes", () => ({ useHiddenNodeUuids: () => new Set<string>() }));
vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => ({ isReady: true,
  homepagePingBindings: {}, enableHomepageMultiPing: true, homepageMultiPingTaskIds: [], homepageNodePingSettings: fixture.settings,
}) }));
vi.mock("@/services/api", () => ({
  getPingOverview: (...args: unknown[]) => fixture.load(...args),
  getPingOverviewStats: async () => [], prewarmPingOverviewDependencies: () => {},
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function response(taskId = 1, entityIds: string[] = ["node-a"]): PingRecordsResponse {
  return { records: entityIds.map((client) => ({ task_id: taskId, client, time: Date.now(), value: 40 + taskId, loss: 0 })),
    tasks: [{ id: taskId, name: `Example ${taskId}`, clients: entityIds, interval: 60, loss: 0, type: "icmp", target: "", weight: 1 }], intervalSeconds: 60 };
}

it("真实轮询挂载链在列表/另一节点配置变化和十分钟后重新加载时保留三条已显示线路", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers(); vi.setSystemTime(1_780_000_000_000);
  sessionStorage.clear();
  fixture.load.mockImplementation(async (_hours, taskId, options) => response(taskId, options.entityIds));
  vi.resetModules();
  let hooks = await import("../usePingOverview");
  const frames: string[] = [];
  function Probe() {
    hooks.useHomepagePingOverview("compact");
    const lines = hooks.useNodePingOverviewLines("node-a");
    const text = lines.map((line) => `${line.taskId}:${line.lastValue}`).join("|");
    frames.push(text);
    return <div>{text}</div>;
  }
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
  const previous = "1:41|2:42|3:43";
  expect(container.textContent).toBe(previous);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  fixture.load.mockImplementation(async (_hours, taskId, options) => { await gate; return response(taskId, options.entityIds); });
  frames.length = 0;
  fixture.nodes = ["node-a", "node-b", "node-c"];
  await act(async () => root!.render(<Probe />));
  expect(container.textContent).toBe(previous);
  fixture.settings = { ...fixture.settings, "node-b": { mode: "custom", taskIds: [5] } };
  await act(async () => root!.render(<Probe />));
  expect(container.textContent).toBe(previous);
  await act(async () => finish());
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.every((frame) => frame === previous)).toBe(true);

  await act(async () => root!.unmount());
  // 模拟页面完全重载，清掉模块内存但保留同标签页会话缓存。
  vi.resetModules(); hooks = await import("../usePingOverview");
  vi.setSystemTime(Date.now() + 10 * 60_000);
  let finishReload!: () => void;
  const reloadGate = new Promise<void>((resolve) => { finishReload = resolve; });
  fixture.load.mockImplementation(async (_hours, taskId, options) => { await reloadGate; return response(taskId, options.entityIds); });
  // 可见列表和缓存建立时不同，也应按节点规则复用，而不是全站键不匹配就丢弃。
  fixture.nodes = ["node-a", "node-b"];
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
  expect(container.textContent).toBe(previous);
  await act(async () => finishReload());
  expect(container.textContent).toBe(previous);

  await act(async () => root!.unmount());
  const cacheKey = "komari:lumina-plus:homepage-ping:v1";
  const legacyCache = JSON.parse(sessionStorage.getItem(cacheKey)!);
  delete legacyCache.selectionKeys;
  legacyCache.singleItems.push(["empty-example", { client: "empty-example", isAssigned: false, loadState: "ready" }]);
  sessionStorage.setItem(cacheKey, JSON.stringify(legacyCache));
  vi.resetModules(); hooks = await import("../usePingOverview");
  let finishLegacy!: () => void;
  const legacyGate = new Promise<void>((resolve) => { finishLegacy = resolve; });
  fixture.load.mockImplementation(async (_hours, taskId, options) => { await legacyGate; return response(taskId, options.entityIds); });
  root = createRoot(container);
  await act(async () => root!.render(<Probe />));
  expect(container.textContent).toBe(previous); // 旧缓存内无任务占位不应导致整份缓存丢弃。
  await act(async () => finishLegacy());
  let finishChanged!: () => void;
  const changedGate = new Promise<void>((resolve) => { finishChanged = resolve; });
  fixture.load.mockImplementation(async (_hours, taskId, options) => { await changedGate; return response(taskId, options.entityIds); });
  fixture.settings = { ...fixture.settings, "node-a": { mode: "custom", taskIds: [7] } };
  await act(async () => root!.render(<Probe />));
  expect(container.textContent).toBe("7:null"); // 真正改了此节点的线路，不应冒用之前的三条值。
  await act(async () => finishChanged());
  expect(container.textContent).toBe("7:47");
});
