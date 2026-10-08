import type uPlot from "uplot";
import { describe, expect, it } from "vitest";
import { resolvePingYRange } from "../pingChartScale";
describe("线路显隐纵轴调整", () => {
  it("隐藏高延迟线路后纵轴收窄，重新显示时恢复", () => {
    const data: uPlot.AlignedData = [[1, 2], [30, 40], [900, 1000]];
    expect(resolvePingYRange(data, [1, 2], new Set([2]))).toEqual([25, 45]);
    expect(resolvePingYRange(data, [1, 2], new Set())[1]).toBeGreaterThan(1000);
  });
  it("全部隐藏或无有效样本时保持合法范围", () => {
    expect(resolvePingYRange([[1], [30]], [1], new Set([1]))).toEqual([0, 100]);
    expect(resolvePingYRange([[1], [null]], [1], new Set())).toEqual([0, 100]);
  });
});
