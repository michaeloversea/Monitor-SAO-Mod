import { afterEach, describe, expect, it, vi } from "vitest";
import { clearNodeMetricsHistoryCache, getLoadRecords } from "@/services/api";
import { LoadRecordSchema } from "@/types/komari";

const base = { ts: 1700000000, cpu: 10, mem_used: 100, disk_used: 200, net_rx: 3, net_tx: 4 };
function history(fields: Record<string, unknown>) {
  clearNodeMetricsHistoryCache();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ metrics: [{ ...base, ...fields }] }), {
    headers: { "content-type": "application/json" },
  })));
  return getLoadRecords("example-node", 1);
}
afterEach(() => vi.unstubAllGlobals());

describe("Hub 1.4.1 historical metrics", () => {
  it("maps all four new metrics into the chart model", async () => {
    const result = await history({ swap_used: 64, tcp: 25, udp: 6, procs: 80 });
    expect(result.records[0]).toMatchObject({ swap: 64, connections: 25, connections_udp: 6, process: 80 });
  });
  it("preserves real zero readings", async () => {
    const result = await history({ swap_used: 0, tcp: 0, udp: 0, procs: 0 });
    expect(result.records[0]).toMatchObject({ swap: 0, connections: 0, connections_udp: 0, process: 0 });
  });
  it.each([{}, { swap_used: null, tcp: null, udp: null, procs: null }, { swap_used: -1, tcp: "25", udp: {}, procs: -2 }])(
    "uses gaps rather than invented zeros for absent or invalid metrics: %j", async (fields) => {
      const result = await history(fields);
      expect(result.records[0]).toMatchObject({ cpu: 10, swap: null, connections: null, connections_udp: null, process: null });
    },
  );
  it("preserves nulls and missing values through record schema parsing", () => {
    expect(LoadRecordSchema.parse({ time: base.ts })).toMatchObject({ swap: null, connections: null, connections_udp: null, process: null });
    expect(LoadRecordSchema.parse({ time: base.ts, swap: 0, connections: 25, connections_udp: null, process: NaN })).toMatchObject({ swap: 0, connections: 25, connections_udp: null, process: null });
  });
});
