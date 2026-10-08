export type HomepageNodePingSetting =
  | { mode: "inherit" | "auto" }
  | { mode: "custom"; taskIds: number[] };
export type HomepageNodePingSettings = Record<string, HomepageNodePingSetting>;
export interface HomepagePingSelectionOptions {
  nodeSettings: HomepageNodePingSettings;
  globalAuto: boolean;
}

export function parsePingConfig(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function normalizeHomepageNodePingSettings(value: unknown): HomepageNodePingSettings {
  const parsed = parsePingConfig(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const entries: [string, HomepageNodePingSetting][] = [];
  for (const [uuid, raw] of Object.entries(parsed)) {
    if (!uuid.trim() || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const setting = raw as Record<string, unknown>;
    if (setting.mode === "inherit" || setting.mode === "auto") {
      entries.push([uuid, { mode: setting.mode }]);
    } else if (setting.mode === "custom") {
      // 空自定义保留为空，不静默切换成全局或旧单线路。
      entries.push([uuid, { mode: "custom", taskIds: normalizeHomepageMultiPingTaskIds(setting.taskIds) }]);
    }
  }
  return Object.fromEntries(entries);
}

export type HomepagePingTaskBindings = Record<string, string[]>;

/** 多线路模式最多同时展示几条线路，默认上限为 8 条 */
export const HOMEPAGE_MULTI_PING_MAX_COUNT = 8;

/** 至少选几条才算配置好。1 条即可生效 */
export const HOMEPAGE_MULTI_PING_MIN_COUNT = 1;

/** 兼容旧版 3 线路常量 */
export const HOMEPAGE_MULTI_PING_TASK_COUNT = 3;

/** 多线路模式的任务选够了没有。首页消费方与设置页的校验共用这一条口径。 */
export function isHomepageMultiPingConfigured(taskIds: readonly number[]): boolean {
  return taskIds.length >= HOMEPAGE_MULTI_PING_MIN_COUNT;
}

/** 默认三条线路（1, 2, 3） */
export const DEFAULT_HOMEPAGE_MULTI_PING_TASK_IDS: readonly number[] = [1, 2, 3];

const invertedBindingsCache = new WeakMap<HomepagePingTaskBindings, Map<string, number>>();

function parseTaskId(taskId: string) {
  if (!/^\d+$/.test(taskId)) return null;
  const parsed = Number(taskId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeHomepageMultiPingTaskIds(value: unknown): number[] {
  value = parsePingConfig(value);
  if (!Array.isArray(value)) return [];

  const normalized: number[] = [];
  for (const raw of value) {
    const taskId =
      typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0
        ? raw
        : typeof raw === "string"
          ? parseTaskId(raw)
          : null;
    if (taskId == null || normalized.includes(taskId)) continue;
    normalized.push(taskId);
    if (normalized.length === HOMEPAGE_MULTI_PING_MAX_COUNT) break;
  }
  return normalized;
}

/**
 * 把多线路的第 `slot` 条换成 `taskId`。选的线路已经在别的槽位时两条互换，不会选出两条一样的线路。
 * 槽位越界时原样返回（拷贝）。
 */
export function assignHomepageMultiPingTask(
  taskIds: readonly number[],
  slot: number,
  taskId: number,
): number[] {
  const next = [...taskIds];
  if (!Number.isInteger(slot) || slot < 0 || slot >= next.length) return next;
  const shownAt = next.indexOf(taskId);
  if (shownAt >= 0 && shownAt !== slot) next[shownAt] = next[slot]!;
  next[slot] = taskId;
  return next;
}

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  value = parsePingConfig(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null || !Array.isArray(clients)) continue;

    const uniqueClients = Array.from(
      new Set(
        clients
          .map((client) => (typeof client === "string" ? client.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (uniqueClients.length === 0) {
      continue;
    }

    const normalizedTaskId = String(numericTaskId);
    normalized[normalizedTaskId] = Array.from(
      new Set([...(normalized[normalizedTaskId] ?? []), ...uniqueClients]),
    );
  }

  return normalized;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const cached = invertedBindingsCache.get(bindings);
  if (cached) return cached;

  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(normalizeHomepagePingTaskBindings(bindings)).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = parseTaskId(taskId);
    if (numericTaskId == null) continue;
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  invertedBindingsCache.set(bindings, selectedTaskByClient);
  return selectedTaskByClient;
}

export function hasHomepagePingTaskBinding(
  clientUuid: string,
  bindings: HomepagePingTaskBindings,
): boolean {
  return Boolean(clientUuid) && invertHomepagePingTaskBindings(bindings).has(clientUuid);
}

export function resolveHomepagePingTaskIdsByClient(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
): Map<string, number[]> {
  const selectedTaskIds = normalizeHomepageMultiPingTaskIds(multiTaskIds);
  const selectedTaskIdsByClient = new Map<string, number[]>();

  if (isHomepageMultiPingConfigured(selectedTaskIds)) {
    for (const uuid of clientUuids) {
      if (uuid) selectedTaskIdsByClient.set(uuid, selectedTaskIds);
    }
    return selectedTaskIdsByClient;
  }

  const singleTaskByClient = invertHomepagePingTaskBindings(bindings);
  for (const uuid of clientUuids) {
    const taskId = singleTaskByClient.get(uuid);
    if (taskId != null) selectedTaskIdsByClient.set(uuid, [taskId]);
  }
  return selectedTaskIdsByClient;
}

export function resolveHomepagePingSelections(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  multiTaskIds: number[] = [],
  options?: HomepagePingSelectionOptions,
) {
  const normalizedMultiTaskIds =
    normalizeHomepageMultiPingTaskIds(multiTaskIds);
  const useMultiPing = isHomepageMultiPingConfigured(normalizedMultiTaskIds);
  const singleTaskIdsByClient = useMultiPing
    ? new Map<string, number[]>()
    : resolveHomepagePingTaskIdsByClient(clientUuids, bindings);
  const multiTaskIdsByClient = useMultiPing
    ? resolveHomepagePingTaskIdsByClient(
        clientUuids,
        {},
        normalizedMultiTaskIds,
      )
    : new Map<string, number[]>();

  if (!options) {
    return { singleTaskIdsByClient, multiTaskIdsByClient,
      requestedTaskIdsByClient: useMultiPing ? multiTaskIdsByClient : singleTaskIdsByClient };
  }
  const singles = new Map<string, number[]>();
  const multiples = new Map<string, number[]>();
  const automaticClients: string[] = [];
  for (const uuid of clientUuids) {
    const setting = options.nodeSettings[uuid];
    if (setting?.mode === "auto" ||
        ((!setting || setting.mode === "inherit") && options.globalAuto)) {
      automaticClients.push(uuid);
    } else if (setting?.mode === "custom") {
      multiples.set(uuid, setting.taskIds);
    } else {
      const multi = multiTaskIdsByClient.get(uuid);
      const single = singleTaskIdsByClient.get(uuid);
      if (multi) multiples.set(uuid, multi);
      else if (single) singles.set(uuid, single);
      else automaticClients.push(uuid);
    }
  }
  return { singleTaskIdsByClient: singles, multiTaskIdsByClient: multiples,
    requestedTaskIdsByClient: new Map([...singles, ...multiples]), automaticClients };

}
