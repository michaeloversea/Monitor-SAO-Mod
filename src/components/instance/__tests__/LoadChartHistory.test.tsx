// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoadRecordSchema, type LoadRecord } from "@/types/komari";
import { LoadChart } from "../LoadChart";

const fixture = vi.hoisted(() => ({ records: [] as LoadRecord[] }));
vi.mock("@/hooks/useRecords", () => ({ useLoadRecords: () => ({
  data: { records: fixture.records }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn(),
}) }));
vi.mock("@/hooks/useNode", () => ({ useNodeMetrics: () => null, useNodeMeta: () => ({ mem_total: 1024, swap_total: 256, disk_total: 4096 }) }));
vi.mock("@/hooks/usePreferences", () => ({ usePreferences: () => ({ resolvedAppearance: "light" }) }));
vi.mock("../chartShared", async (importOriginal) => ({
  ...await importOriginal<typeof import("../chartShared")>(),
  useResponsiveChartSize: () => ({ w: 600, h: 300, ref: () => {} }),
}));
vi.mock("uplot-react", () => ({ default: ({ data }: { data: unknown }) => <div data-series={JSON.stringify(data)} /> }));

afterEach(() => vi.unstubAllGlobals());

describe("historical metric display", () => {
  it.each([false, true])("shows missing metrics as gaps and real readings as values (new Hub: %s)", async (newHub) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fixture.records = [LoadRecordSchema.parse({
      time: 1700000000000, cpu: 10, ram: 100, disk: 200,
      ...(newHub ? { swap: 64, connections: 25, connections_udp: 0, process: 80 } : {}),
    })];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<LoadChart uuid="example-node" hours={1} />));
      const cards = [...container.querySelectorAll<HTMLElement>(".instance-chart-card")];
      const connections = cards.find((card) => card.textContent?.startsWith("连接数"))!;
      const memory = cards.find((card) => card.textContent?.startsWith("内存"))!;
      const process = cards.find((card) => card.textContent?.startsWith("进程"))!;
      expect(connections.textContent).toContain(newHub ? "TCP 25 / UDP 0" : "TCP — / UDP —");
      expect(memory.textContent).toContain(newHub ? "Swap 64 B / 256 B" : "Swap —");
      expect(process.querySelector(".instance-series-stats .tabular")?.textContent).toBe(newHub ? "80" : "—");
      expect(JSON.parse(connections.querySelector("[data-series]")!.getAttribute("data-series")!)).toEqual([
        [1700000000], [newHub ? 25 : null], [newHub ? 0 : null],
      ]);
      expect(JSON.parse(memory.querySelector("[data-series]")!.getAttribute("data-series")!)[2]).toEqual([newHub ? 25 : null]);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
