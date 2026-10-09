import type { PingRecord } from "@/types/komari";
import { resolvePingSampleCounts } from "@/utils/pingMetrics";

export interface LossBandBucket { start: number; end: number; total: number; lost: number; loss: number | null }

/** 使用原始返回桶，按时间覆盖分配权重。无采样保持 null，不能染成零丢包或全丢包。 */
export function buildLossBandBuckets(records: PingRecord[], start: number, end: number, interval: number, count: number): LossBandBucket[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(interval) || interval <= 0) return [];
  count = Math.min(1440, Math.max(1, Math.round(count) || 1));
  const width = (end - start) / count;
  const buckets: LossBandBucket[] = Array.from({ length: count }, (_, i) => ({ start: start + i * width, end: start + (i + 1) * width, total: 0, lost: 0, loss: null }));
  for (const record of records) {
    if (typeof record.count === "number" && (!Number.isFinite(record.count) || record.count <= 0)) continue;
    const rawTime = typeof record.time === "number" ? record.time : Date.parse(record.time);
    const time = typeof record.time === "number" && record.time < 1e12 ? rawTime * 1000 : rawTime;
    const seconds = time / 1000;
    if (!Number.isFinite(seconds)) continue;
    const total = typeof record.count === "number" && record.count > 0 ? record.count : 1;
    // 保留聚合桶的精确百分比；不把小丢包率先四舍五入为零。
    const loss = typeof record.loss === "number" && Number.isFinite(record.loss)
      ? Math.min(100, Math.max(0, record.loss)) : resolvePingSampleCounts(record).lost / total * 100;
    const first = Math.max(0, Math.floor((seconds - start) / width));
    const last = Math.min(count - 1, Math.ceil((seconds + interval - start) / width) - 1);
    for (let i = first; i <= last; i++) {
      const bucket = buckets[i];
      const overlap = Math.max(0, Math.min(bucket.end, seconds + interval) - Math.max(bucket.start, seconds));
      const weight = overlap / interval * total;
      bucket.total += weight;
      bucket.lost += weight * loss / 100;
    }
  }
  return buckets.map((bucket) => ({ ...bucket, loss: bucket.total > 0 ? bucket.lost / bucket.total * 100 : null }));
}

/** 查询正在显示的色块，左闭右开，不能跨过缺采样或混入别的线路。 */
export function lossBandBucketAtTime(buckets: LossBandBucket[], time: number): LossBandBucket | null {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  if (!first || !last || !Number.isFinite(time) || time < first.start || time >= last.end) return null;
  const index = Math.min(buckets.length - 1, Math.floor((time - first.start) / (last.end - first.start) * buckets.length));
  return buckets[index] ?? null;
}

export function formatLossBandValue(loss: number | null): string {
  return loss == null ? "未采样" : `${loss.toFixed(1)}% 丢包`;
}

export interface PingLossSample { start: number; end: number; loss: number | null }

/** 曲线提示读取原始采样时段，避免显示像素跨桶时混合出的丢包率。 */
export function indexPingLossSamples(records: PingRecord[], intervals: Map<number, number>): Map<number, PingLossSample[]> {
  const result = new Map<number, PingLossSample[]>();
  for (const record of records) {
    const raw = typeof record.time === "number" ? record.time : Date.parse(record.time);
    const start = typeof record.time === "number" && raw < 1e12 ? raw : raw / 1000;
    if (!Number.isFinite(start)) continue;
    const { total, lost } = resolvePingSampleCounts(record);
    const loss = typeof record.count === "number" && (!Number.isFinite(record.count) || record.count <= 0) ? null
      : typeof record.loss === "number" && Number.isFinite(record.loss) ? Math.max(0, Math.min(100, record.loss)) : lost / total * 100;
    const group = result.get(record.task_id) ?? [];
    group.push({ start, end: start + (intervals.get(record.task_id) ?? 60), loss });
    result.set(record.task_id, group);
  }
  for (const samples of result.values()) samples.sort((a, b) => a.start - b.start);
  return result;
}

export function pingLossAtTime(samples: PingLossSample[], time: number): number | null {
  if (!Number.isFinite(time)) return null;
  let left = 0; let right = samples.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (samples[middle].start <= time) left = middle + 1;
    else right = middle;
  }
  const sample = samples[left - 1];
  return sample && time < sample.end ? sample.loss : null;
}

export function lossBandColor(loss: number | null): string {
  if (loss == null || !Number.isFinite(loss)) return "#94a3b833";
  if (loss <= 0) return "#22c55e";
  if (loss < 5) return "#a3cc28";
  if (loss < 20) return "#facc15";
  if (loss < 50) return "#fb923c";
  if (loss < 100) return "#ef4444";
  return "#b91c1c";
}
