import { describe, expect, it } from "vitest";
import { normalizeHomepageNodePingSettings, resolveHomepagePingSelections } from "@/utils/pingTasks";
import { normalizeThemeSettings } from "@/utils/themeSettings";

describe("逐服务器线路优先级与兼容", () => {
  it("普通节点跟随三网，Po0 按稳定 ID 指定 PL、CT-53 顺序", () => {
    const result = resolveHomepagePingSelections(["node-ct", "po0-id"], { "1": ["po0-id"] }, [1, 2, 3], {
      globalAuto: false, nodeSettings: { "po0-id": { mode: "custom", taskIds: [5, 4] } },
    });
    expect(result.multiTaskIdsByClient.get("node-ct")).toEqual([1, 2, 3]);
    expect(result.multiTaskIdsByClient.get("po0-id")).toEqual([5, 4]);
  });
  it("显式自动不受旧绑定或全局槽位限制，跟随全局仍保留单线路", () => {
    const result = resolveHomepagePingSelections(["auto", "old"], { "7": ["auto", "old"] }, [], {
      globalAuto: false, nodeSettings: { auto: { mode: "auto" } },
    });
    expect(result.automaticClients).toEqual(["auto"]);
    expect(result.singleTaskIdsByClient.get("old")).toEqual([7]);
    expect(result.requestedTaskIdsByClient.has("auto")).toBe(false);
  });
  it("全局空槽位表示自动，并覆盖旧绑定；自定义仍优先", () => {
    const result = resolveHomepagePingSelections(["auto", "custom"], { "7": ["auto"] }, [], {
      globalAuto: true, nodeSettings: { custom: { mode: "custom", taskIds: [8, 9] } },
    });
    expect(result.automaticClients).toEqual(["auto"]);
    expect(result.multiTaskIdsByClient.get("custom")).toEqual([8, 9]);
  });
  it("支持旧对象、新 JSON 文本与坏数据；空列表不被补回", () => {
    const raw = { "stable-uuid": { mode: "custom", taskIds: ["5", 4, 5, -1] }, orphan: { mode: "auto" }, bad: { mode: "wat" } };
    expect(normalizeHomepageNodePingSettings(JSON.stringify(raw))).toEqual({ "stable-uuid": { mode: "custom", taskIds: [5, 4] }, orphan: { mode: "auto" } });
    expect(normalizeHomepageNodePingSettings("bad json")).toEqual({});
    const parsed = normalizeThemeSettings({ enableHomepageMultiPing: true, homepageMultiPingTaskIds: [] });
    expect(parsed.homepageMultiPingTaskIds).toEqual([]);
    expect(parsed.enableHomepageMultiPing).toBe(true);
    expect(normalizeThemeSettings({ homepagePingBindings: { "1": ["stable-uuid"] } }).homepagePingBindings).toEqual({ "1": ["stable-uuid"] });
  });
  it("空自定义不悄悄回退成全局或旧绑定", () => {
    const result = resolveHomepagePingSelections(["node"], { "7": ["node"] }, [1, 2, 3], {
      globalAuto: false, nodeSettings: { node: { mode: "custom", taskIds: [] } },
    });
    expect(result.multiTaskIdsByClient.get("node")).toEqual([]);
    expect(result.automaticClients).toEqual([]);
  });
});
