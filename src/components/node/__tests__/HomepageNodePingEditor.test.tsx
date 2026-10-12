// @vitest-environment jsdom
import type { AdminClient, PingTask } from "@/types/theme";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HomepageNodePingEditor } from "../HomepageNodePingEditor";

it("自定义线路显示为独立标签，保留顺序、缺失任务说明和编辑能力", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = { uuid: "example-node", name: "Example Server" } as AdminClient;
  const tasks = [1, 2].map((id) => ({ id, name: `Example ${id}`, clients: [node.uuid] })) as PingTask[];
  const change = vi.fn();
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<HomepageNodePingEditor nodes={[node]} tasks={tasks}
    settings={{ [node.uuid]: { mode: "custom", taskIds: [2, 1, 999] } }} bindings={{}} onChange={change} nodesReady />));
  expect([...container.querySelectorAll(".node-ping-task-tag")].map((tag) => tag.textContent)).toEqual(["Example 2", "Example 1", "任务 #999（已删除或不可用）"]);
  expect(container.querySelector(".node-ping-task-tags")?.getAttribute("aria-label")).toBe("已选线路（按展示顺序）");
  expect(container.textContent).not.toContain(" → ");
  await act(async () => container.querySelector<HTMLButtonElement>(".node-ping-node-button")!.click());
  const down = container.querySelector<HTMLButtonElement>('[aria-label="Example Server Example 2 下移"]')!;
  await act(async () => down.click());
  expect(change).toHaveBeenLastCalledWith({ [node.uuid]: { mode: "custom", taskIds: [1, 2, 999] } });
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});

it("折叠节点不展示旧绑定说明，展开后仍可迁移且保留原任务", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = { uuid: "example-node", name: "Example Server" } as AdminClient;
  const change = vi.fn();
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<HomepageNodePingEditor nodes={[node]} tasks={[]}
    settings={{}} bindings={{ "7": [node.uuid] }} onChange={change} nodesReady />));
  expect(container.textContent).not.toContain("旧单线路绑定：");
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === "迁移旧绑定为自定义")).toBe(false);
  await act(async () => container.querySelector<HTMLButtonElement>(".node-ping-node-button")!.click());
  const migrate = [...container.querySelectorAll("button")].find((button) => button.textContent === "迁移旧绑定为自定义")!;
  await act(async () => migrate.click());
  expect(change).toHaveBeenLastCalledWith({ [node.uuid]: { mode: "custom", taskIds: [7] } });
  await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
});
