import { describe, expect, it } from "vitest";
import { buildLossBandBuckets, lossBandColor, lossBandBucketAtTime, formatLossBandValue, indexPingLossSamples, pingLossAtTime } from "../lossBandData";
const start = 1_780_000_000;
describe("丢包色带", () => {
  it("按时间轴覆盖聚合桶，空采样灰色、全丢包深红", () => {
    const rows = buildLossBandBuckets([
      { task_id: 1, client: "a", time: start * 1000, value: 50, count: 10, loss: 10 },
      { task_id: 1, client: "a", time: (start + 120) * 1000, value: -1 },
    ], start, start + 240, 60, 4);
    expect(rows.map((row) => row.loss)).toEqual([10, null, 100, null]);
    expect(lossBandColor(null)).toBe("#94a3b833");
    expect(lossBandColor(100)).toBe("#b91c1c");
  });
  it("按样本数加权，保留细微丢包，色带不依赖延迟平滑", () => {
    const rows = buildLossBandBuckets([
      { task_id: 1, client: "a", time: start * 1000, value: 3000, count: 10, loss: 0 },
      { task_id: 1, client: "a", time: (start + 60) * 1000, value: 1, count: 30, loss: 20 },
    ], start, start + 120, 60, 1);
    expect(rows[0].loss).toBe(15);
    expect(buildLossBandBuckets([{ task_id: 1, client: "a", time: start * 1000, value: 1, loss: 0.5 }], start, start + 60, 60, 1)[0].loss).toBe(0.5);
  });
  it("不接收非法区间或时间戳", () => {
    expect(buildLossBandBuckets([], start, start, 60, 1)).toEqual([]);
    expect(buildLossBandBuckets([{ task_id: 1, client: "a", time: "bad", value: -1 }], start, start + 60, 60, 1)[0].loss).toBeNull();
  });
  it("悬停只查询当前时段，精确保留小丢包率，空采样不显示零", () => {
    const buckets = buildLossBandBuckets([
      { task_id: 1, client: "node", time: start * 1000, value: 30, loss: 0.5 },
      { task_id: 1, client: "node", time: (start + 60) * 1000, value: -1, count: 0 },
    ], start, start + 120, 60, 2);
    expect(lossBandBucketAtTime(buckets, start + 30)?.loss).toBe(0.5);
    expect(lossBandBucketAtTime(buckets, start + 60)?.loss).toBeNull();
    expect(lossBandBucketAtTime(buckets, start + 120)).toBeNull();
    expect(lossBandBucketAtTime(buckets, start - 1)).toBeNull();
    expect(formatLossBandValue(0.5)).toBe("0.5% 丢包");
    expect(formatLossBandValue(null)).toBe("未采样");
    expect(formatLossBandValue(100)).toBe("100.0% 丢包");
  });
  it("曲线提示使用各任务的原始时段，边界取新桶，缺口不借用旧值", () => {
    const index = indexPingLossSamples([
      { task_id: 1, client: "node", time: start * 1000, value: 40, loss: 0 },
      { task_id: 1, client: "node", time: (start + 60) * 1000, value: 50, loss: 10 },
      { task_id: 2, client: "node", time: start, value: -1 },
    ], new Map([[1, 60], [2, 120]]));
    expect(pingLossAtTime(index.get(1)!, start + 59)).toBe(0);
    expect(pingLossAtTime(index.get(1)!, start + 60)).toBe(10);
    expect(pingLossAtTime(index.get(1)!, start + 120)).toBeNull();
    expect(pingLossAtTime(index.get(2)!, start + 60)).toBe(100);
    expect(pingLossAtTime([], start)).toBeNull();
  });
});
