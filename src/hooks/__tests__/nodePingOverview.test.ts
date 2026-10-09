import { describe, expect, it, vi } from "vitest";
import { buildPingOverviewMap } from "@/hooks/usePingOverview";
import type { PingRecordsResponse, PingTask } from "@/types/komari";
const task = (id: number, name: string, clients: string[]): PingTask => ({ id, name, clients, interval: 60, loss: 0, type: "icmp", target: "", weight: id });
const tasks = [task(1, "CT", ["normal"]), task(2, "CU", ["normal"]), task(3, "CM", ["normal"]), task(5, "Example_Trace1", ["example-node"]), task(4, "Example_Trace2", ["example-node"]), task(8, "无样本", ["offline"])];
const data: PingRecordsResponse = { count: 5, tasks, intervalSeconds: 300, records: tasks.slice(0, 5).map((t) => ({ client: t.clients[0], task_id: t.id, time: 1_780_000_000_000, value: 60, loss: 0 })) };

describe("逐节点概览集成", () => {
  it("同时加载全局三网、Example Server 自定义两线和自动节点，保留每个节点顺序", async () => {
    const loader = vi.fn(async () => data);
    const result = await buildPingOverviewMap(1, ["normal", "example-node", "offline", "empty"], { "1": ["example-node", "offline"] }, [1, 2, 3], undefined, undefined, loader, undefined, undefined, {
      globalAuto: false, nodeSettings: { "example-node": { mode: "custom", taskIds: [5, 4] }, offline: { mode: "auto" }, empty: { mode: "auto" } },
    });
    expect(result.multiLines.get("normal")?.map((line) => line.taskName)).toEqual(["CT", "CU", "CM"]);
    expect(result.multiLines.get("example-node")?.map((line) => line.taskName)).toEqual(["Example_Trace1", "Example_Trace2"]);
    expect(result.multiLines.get("offline")?.[0]).toMatchObject({ taskId: 8, lastValue: null, loadState: "ready" });
    expect(result.multiLines.has("empty")).toBe(false);
  });
  it("全局清空可自动展示不同数量；旧 Example Server 单线不会截断", async () => {
    const result = await buildPingOverviewMap(1, ["normal", "example-node"], { "4": ["example-node"] }, [], undefined, undefined, async () => data, undefined, undefined, { globalAuto: true, nodeSettings: {} });
    expect(result.multiLines.get("normal")?.map((line) => line.taskId)).toEqual([1, 2, 3]);
    expect(result.multiLines.get("example-node")?.map((line) => line.taskId)).toEqual([5, 4]);
  });
  it("任务删除保留空占位，关联变化更新自动任务列表", async () => {
    const result = await buildPingOverviewMap(1, ["example-node"], {}, [], undefined, undefined, async () => ({ count: 0, tasks: [], records: [] }), undefined, undefined, { globalAuto: false, nodeSettings: { "example-node": { mode: "custom", taskIds: [999] } } });
    expect(result.multiLines.get("example-node")?.[0]).toMatchObject({ taskId: 999, lastValue: null, taskName: "任务 #999（已删除或未关联）" });
    const auto = await buildPingOverviewMap(1, ["example-node"], {}, [], undefined, undefined, async () => ({ count: 0, tasks: [task(9, "新关联", ["example-node"])], records: [] }), undefined, undefined, { globalAuto: false, nodeSettings: { "example-node": { mode: "auto" } } });
    expect(auto.multiLines.get("example-node")?.map((line) => line.taskId)).toEqual([9]);
  });
  it("取数失败保留错误占位，不回退其他任务", async () => {
    const result = await buildPingOverviewMap(1, ["example-node"], { "1": ["example-node"] }, [1, 2, 3], undefined, undefined, async () => { throw new Error("offline"); }, undefined, undefined, { globalAuto: false, nodeSettings: { "example-node": { mode: "custom", taskIds: [5, 4] } } });
    expect(result.multiLines.get("example-node")?.map((line) => [line.taskId, line.loadState])).toEqual([[5, "error"], [4, "error"]]);
  });
  it("自动模式明确区分无任务和请求失败，避免空快照一直处于 pending", async () => {
    const options = { globalAuto: true, nodeSettings: {} };
    const empty = await buildPingOverviewMap(1, ["example-node"], {}, [], undefined, undefined,
      async () => ({ count: 0, tasks: [], records: [] }), undefined, undefined, options);
    expect(empty.singleItems.get("example-node")).toMatchObject({ isAssigned: false, loadState: "ready" });
    expect(empty.multiLines.size).toBe(0);
    const failed = await buildPingOverviewMap(1, ["example-node"], {}, [], undefined, undefined,
      async () => { throw new Error("network"); }, undefined, undefined, options);
    expect(failed.singleItems.get("example-node")).toMatchObject({ isAssigned: false, loadState: "error" });
  });
  it("自动请求较慢时保留上次线路，其他节点返回不会清空它，完成后静默更新", async () => {
    const options = { globalAuto: true, nodeSettings: { "example-node": { mode: "custom" as const, taskIds: [5, 4] } } };
    const previous = await buildPingOverviewMap(1, ["normal", "example-node"], {}, [], undefined, undefined,
      async () => data, undefined, undefined, options);
    let finishAuto!: (response: PingRecordsResponse) => void;
    const delayed = new Promise<PingRecordsResponse>((resolve) => { finishAuto = resolve; });
    const progress: Awaited<ReturnType<typeof buildPingOverviewMap>>[] = [];
    const refresh = buildPingOverviewMap(1, ["normal", "example-node"], {}, [], undefined, previous,
      async (_hours, taskId) => taskId == null ? delayed : data, undefined, (snapshot) => progress.push(snapshot), options);
    await vi.waitFor(() => expect(progress.length).toBeGreaterThan(0));
    for (const snapshot of progress) {
      expect(snapshot.multiLines.get("normal")).toEqual(previous.multiLines.get("normal"));
      expect(snapshot.singleItems.get("normal")?.loadState).toBe("ready");
    }
    finishAuto({ ...data, records: data.records.map((record) => ({ ...record, value: 75 })) });
    const result = await refresh;
    expect(result.multiLines.get("normal")?.map((line) => line.lastValue)).toEqual([75, 75, 75]);
  });
});
