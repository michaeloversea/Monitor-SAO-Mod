import type { PeriodTraffic } from "@/types/theme";

export interface TrafficDisplay {
  available: boolean;
  fraction: number;
  color: string;
  remainingLabel: string;
  detail: string;
  typeLabel: string;
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Monitor Traffic::month_used：up/down/max，其余（含未知模式）按 sum。 */
export function computeTrafficUsed(
  type: string | null | undefined,
  up: number,
  down: number,
): number {
  switch (type) {
    case "up": return up;
    case "down": return down;
    case "max": return Math.max(up, down);
    default: return up + down;
  }
}

export interface TrafficUsage {
  available: boolean;
  used: number | null;
  limit: number;
  unlimited: boolean;
  remaining: number | null;
  fraction: number;
}

// 参数只接收周期字段，累计 trafficUp/trafficDown 不参与额度计算。
export function resolveTrafficUsage(
  type: string | null | undefined,
  period: PeriodTraffic,
  limit: number,
): TrafficUsage {
  let used: number | null = null;
  if (validCounter(period.month_used)) {
    used = period.month_used;
  } else if (validCounter(period.month_tx) && validCounter(period.month_rx)) {
    const computed = computeTrafficUsed(type, period.month_tx, period.month_rx);
    if (validCounter(computed)) used = computed;
  }
  const unlimited = !(limit > 0);
  const remaining = used === null ? null : unlimited ? 0 : Math.max(0, limit - used);
  const fraction = used === null || unlimited ? 0 : Math.max(0, Math.min(1, used / limit));
  return { available: used !== null, used, limit, unlimited, remaining, fraction };
}

export function trafficTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case "up": return "仅上行";
    case "down": return "仅下行";
    case "max": return "上下取大";
    default: return "上行+下行";
  }
}
