import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { periodTrafficNode } from "@/test/fixtures/traffic";
import { resolveTrafficUsage } from "@/utils/traffic";

function frame(cpu: number) {
  return { nodes: [{ id: 1, name: "Example node", online: true, metrics: { cpu } }] };
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  static throwOnCreate = false;
  readyState = 0;
  onmessage: ((event: { data: string | Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    if (FakeSocket.throwOnCreate) throw new Error("Socket unavailable");
    FakeSocket.instances.push(this);
  }
  close() { this.readyState = 3; this.onclose?.(); }
  failHandshake() { this.onerror?.(); }
  send(data: unknown) {
    this.readyState = FakeSocket.OPEN;
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("WebSocket fallback lifecycle", () => {
  let fakeWindow: { location: object; sessionStorage: object; __EARLY_DATA__?: { nodes: Promise<unknown> | null } };
  let fakeDocument: { hidden: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  let fetchMock: ReturnType<typeof vi.fn>;
  let release: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    FakeSocket.instances = [];
    FakeSocket.throwOnCreate = false;
    fakeWindow = {
      location: { search: "", protocol: "http:", host: "localhost" },
      sessionStorage: { getItem: () => null },
    };
    fakeDocument = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => frame(20) });
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("document", fakeDocument);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    release?.();
    release = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps period accounting through preload, rollover push, offline polling and a page reload", async () => {
    fakeWindow.__EARLY_DATA__ = { nodes: Promise.resolve({ nodes: [periodTrafficNode] }) };
    let store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    const usage = () => resolveTrafficUsage("sum", store.getNodeMetricsSnapshot("1")!, periodTrafficNode.traffic_limit);
    expect(usage().used).toBe(19917947772);

    const resetNode = { ...periodTrafficNode, month_used: 0, month_tx: 0, month_rx: 0,
      month_start: "2026-11-13", metrics: { month_used: 19917947772 } };
    FakeSocket.instances[0].send({ nodes: [resetNode] });
    await vi.advanceTimersByTimeAsync(0);
    expect(usage()).toMatchObject({ used: 0, remaining: periodTrafficNode.traffic_limit, fraction: 0 });
    expect(store.getNodeMetricsSnapshot("1")?.trafficUp).toBe(periodTrafficNode.total_tx);

    const offlineNode = { ...resetNode, online: false, metrics: null };
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ nodes: [offlineNode] }) });
    FakeSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("1")?.online).toBe(false);
    expect(usage().used).toBe(0);

    // Reload the module as a fresh page: no previous in-memory period snapshot.
    release(); release = undefined;
    vi.resetModules();
    store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(usage().used).toBe(0);
    expect(store.getNodeMetricsSnapshot("1")?.month_start).toBe("2026-11-13");

    // A total-only frame must clear period availability, never reuse totals or a stale cycle.
    FakeSocket.instances.at(-1)!.send({ nodes: [{ id: 1, online: true, metrics: { total_tx: 999999, total_rx: 888888 } }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(usage()).toMatchObject({ available: false, used: null });
  });

  it("consumes the preload once, polls fresh frames during failed handshakes, and retries", async () => {
    fakeWindow.__EARLY_DATA__ = { nodes: Promise.resolve(frame(10)) };
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fakeWindow.__EARLY_DATA__.nodes).toBeNull();

    // Browser reports a rejected HTTP 503 handshake as error + close.
    FakeSocket.instances[0].failHandshake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/nodes");
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(20);
    fetchMock.mockResolvedValue({ ok: true, json: async () => frame(25) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(25);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.instances[1].failHandshake();
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("stops polling only after a usable frame and resumes when the recovered socket closes", async () => {
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    FakeSocket.instances[0].failHandshake();
    await vi.advanceTimersByTimeAsync(3000);
    const recovered = FakeSocket.instances[1];
    recovered.send({ unexpected: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    recovered.send(frame(30));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(30);
    const calls = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    recovered.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(20);
  });

  it("retries constructor failures while keeping HTTP updates alive", async () => {
    FakeSocket.throwOnCreate = true;
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    FakeSocket.throwOnCreate = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(20);
  });

  it("does not let an in-flight poll overwrite a newer recovered push frame", async () => {
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    let resolvePoll!: (response: unknown) => void;
    fetchMock.mockImplementation(() => new Promise((resolve) => { resolvePoll = resolve; }));
    FakeSocket.instances[0].failHandshake();
    await vi.advanceTimersByTimeAsync(3000);
    FakeSocket.instances[1].send(frame(35));
    await vi.advanceTimersByTimeAsync(0);
    resolvePoll({ ok: true, json: async () => frame(22) });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(35);
  });

  it("fetches after a failed preload and fetches again when returning to the foreground", async () => {
    fakeWindow.__EARLY_DATA__ = { nodes: Promise.resolve(null) };
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const visibility = fakeDocument.addEventListener.mock.calls[0][1];
    fakeDocument.hidden = true;
    visibility();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fakeDocument.hidden = false;
    visibility();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("discards queued messages from replaced sockets and cancels timers on unsubscribe", async () => {
    const store = await import("@/services/wsStore");
    release = store.retainStore();
    const previous = FakeSocket.instances[0];
    previous.send(frame(99));
    previous.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.getNodeMetricsSnapshot("1")?.cpuPct).toBe(20);
    const calls = fetchMock.mock.calls.length;
    release();
    release = undefined;
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(FakeSocket.instances).toHaveLength(2);
  });
});
