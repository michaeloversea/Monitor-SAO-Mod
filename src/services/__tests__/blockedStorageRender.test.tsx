// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

it("renders the public homepage when browser storage is disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() { throw new DOMException("Storage disabled", "SecurityError"); },
  });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
    url === "/api/me" ? { authed: false, site_name: "Example monitor", public_page: true }
      : url === "/api/nodes" ? { nodes: [{ id: 1, name: "Example node", country: "JP", online: true, metrics: { cpu: 10 } }] }
        : url.includes("/metrics") ? { metrics: [], ping: [], probes: {} }
          : { showCostSummary: false, matrixBootAnimation: false },
  ), { headers: { "content-type": "application/json" } })));
  vi.stubGlobal("WebSocket", class { onclose: (() => void) | null = null; close() { this.onclose?.(); } });
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const { App } = await import("@/App");
  const { router } = await import("@/router");
  const { queryClient } = await import("@/services/queryClient");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(container.textContent).toContain("Example monitor");
    expect(container.textContent).toContain("Example node");
    expect(errors.mock.calls.some((args) => args.some((arg) => arg instanceof DOMException && arg.name === "SecurityError"))).toBe(false);
  } finally {
    await act(async () => root.unmount());
    router.dispose();
    queryClient.clear();
    container.remove();
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    warnings.mockRestore();
    errors.mockRestore();
    canvas.mockRestore();
    vi.unstubAllGlobals();
  }
});
