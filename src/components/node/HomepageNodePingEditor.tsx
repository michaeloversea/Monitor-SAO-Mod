import { SettingSelect } from "@/components/ui/SettingSelect";
import { useState } from "react";
import type { AdminClient, PingTask } from "@/types/komari";
import { HOMEPAGE_MULTI_PING_MAX_COUNT, invertHomepagePingTaskBindings,
  type HomepageNodePingSettings, type HomepagePingTaskBindings } from "@/utils/pingTasks";

export function HomepageNodePingEditor({ nodes, tasks, settings, bindings, onChange, nodesReady }: {
  nodes: AdminClient[];
  tasks: PingTask[];
  settings: HomepageNodePingSettings;
  bindings: HomepagePingTaskBindings;
  onChange: (next: HomepageNodePingSettings) => void;
  nodesReady: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const oldBindings = invertHomepagePingTaskBindings(bindings);
  const nodeIds = new Set(nodes.map((node) => node.uuid));
  const orphanIds = nodesReady ? Object.keys(settings).filter((id) => !nodeIds.has(id)) : [];
  const shownNodes = nodes.filter((node) => `${node.name} ${node.uuid}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="flex flex-col gap-3">
    <p className="setting-hint">自定义 / 自动优先于全局。跟随全局保留旧显示：全局多线路有槽位时使用槽位；多线路空槽位时自动；单线路模式仍使用旧绑定。设置仅控制展示，任务执行与节点关联请在探针后台调整。</p>
    <p className="setting-hint">按稳定节点 ID/UUID 保存，节点改名不影响设置。自动模式忽略旧单线路绑定，并随该节点返回的任务变化更新。自定义保留选定顺序，已删除或不再关联的任务显示无样本。</p>
    <input className="theme-manage-input" placeholder="搜索服务器名称 / ID" aria-label="搜索逐服务器线路" value={search} onChange={(event) => setSearch(event.target.value)} />
    {orphanIds.length > 0 && <div className="surface-inset px-3 py-3 text-[12px]">
      有 {orphanIds.length} 个当前节点列表中不存在的设置（ID：{orphanIds.join("、")}），已保留以便恢复。
      <button className="theme-manage-button is-compact is-danger ml-2" type="button" onClick={() => onChange(Object.fromEntries(Object.entries(settings).filter(([id]) => nodeIds.has(id))))}>清理这些设置</button>
    </div>}
    {shownNodes.map((node) => {
      const setting = settings[node.uuid] ?? { mode: "inherit" as const };
      const ids = setting.mode === "custom" ? setting.taskIds : [];
      const associated = tasks.filter((task) => task.clients.includes(node.uuid));
      const candidates = [...associated, ...tasks.filter((task) => !task.clients.includes(node.uuid))];
      const updateIds = (taskIds: number[]) => onChange({ ...settings, [node.uuid]: { mode: "custom", taskIds } });
      const move = (index: number, offset: number) => {
        const next = [...ids];
        [next[index], next[index + offset]] = [next[index + offset], next[index]];
        updateIds(next);
      };
      return <div key={node.uuid} className="surface-inset px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="theme-manage-button is-compact node-ping-node-button" aria-expanded={expanded === node.uuid} onClick={() => setExpanded(expanded === node.uuid ? null : node.uuid)}>{node.name || node.uuid} · ID {node.uuid}</button>
          <SettingSelect wrapperClassName="node-ping-mode-select" className="theme-manage-input" aria-label={`${node.name} 展示方式`} value={setting.mode} onChange={(event) => {
            const mode = event.target.value;
            const next = { ...settings };
            if (mode === "inherit") delete next[node.uuid];
            else if (mode === "auto") next[node.uuid] = { mode: "auto" };
            else next[node.uuid] = { mode: "custom", taskIds: ids.length ? ids : associated.map((task) => task.id).slice(0, HOMEPAGE_MULTI_PING_MAX_COUNT) };
            onChange(next); setExpanded(node.uuid);
          }}>
            <option value="inherit">跟随全局</option><option value="auto">自动（该节点全部线路）</option><option value="custom">自定义（指定线路与顺序）</option>
          </SettingSelect>
        </div>
        {setting.mode === "inherit" && oldBindings.has(node.uuid) && <p className="setting-hint">
          旧单线路绑定：{tasks.find((task) => task.id === oldBindings.get(node.uuid))?.name ?? `任务 #${oldBindings.get(node.uuid)}`}。
          <button type="button" className="theme-manage-button is-compact ml-2" onClick={() => { updateIds([oldBindings.get(node.uuid)!]); setExpanded(node.uuid); }}>迁移旧绑定为自定义</button>
        </p>}
        {setting.mode === "auto" && <p className="setting-hint">自动展示该节点关联的任务；忽略全局槽位和旧单线路绑定，暂无任务时显示空状态。</p>}
        {setting.mode === "custom" && <p className="setting-hint">{ids.length ? ids.map((id) => tasks.find((task) => task.id === id)?.name ?? `任务 #${id}（已删除或不可用）`).join(" → ") : "请选择至少一条线路，或切换为自动。"}</p>}
        {setting.mode === "custom" && expanded === node.uuid && <>
          {ids.map((id, index) => {
            const task = tasks.find((task) => task.id === id);
            return <div key={id} className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="flex-1">{index + 1}. {task?.name ?? `任务 #${id}（已删除或不可用）`}{task && !task.clients.includes(node.uuid) ? "（未关联该节点）" : ""}</span>
              <button type="button" className="theme-manage-button is-compact" aria-label={`${node.name} ${task?.name ?? id} 上移`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="theme-manage-button is-compact" aria-label={`${node.name} ${task?.name ?? id} 下移`} disabled={index === ids.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="theme-manage-button is-compact is-danger" onClick={() => updateIds(ids.filter((value) => value !== id))}>删除</button>
            </div>;
          })}
          <SettingSelect className="theme-manage-input" aria-label={`${node.name} 添加线路`} value="" disabled={ids.length >= HOMEPAGE_MULTI_PING_MAX_COUNT} onChange={(event) => { if (event.target.value) updateIds([...ids, Number(event.target.value)]); }}>
            <option value="">添加线路（最多 {HOMEPAGE_MULTI_PING_MAX_COUNT} 条，已关联优先）</option>
            <optgroup label="已关联该节点">{candidates.filter((task) => task.clients.includes(node.uuid) && !ids.includes(task.id)).map((task) => <option key={task.id} value={task.id}>{task.name} · #{task.id}</option>)}</optgroup>
            <optgroup label="其他任务（需后台关联后才有数据）">{candidates.filter((task) => !task.clients.includes(node.uuid) && !ids.includes(task.id)).map((task) => <option key={task.id} value={task.id}>{task.name} · #{task.id}</option>)}</optgroup>
          </SettingSelect>
        </>}
      </div>;
    })}
    {nodesReady && !shownNodes.length && <p className="setting-hint">暂无匹配的服务器。</p>}
  </div>;
}
