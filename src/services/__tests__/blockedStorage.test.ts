// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("blocked browser storage", () => {
  let descriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    vi.resetModules();
    descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("Site storage is disabled", "SecurityError"); },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps theme settings and subscriptions usable in memory", async () => {
    const store = await import("@/services/themeSettingsStore");
    expect(store.getLocalThemeSettings()).toEqual({});
    const changed = vi.fn();
    const unsubscribe = store.subscribeLocalThemeSettings(changed);
    store.saveLocalThemeSettings({ enableHomepageMultiPing: true });
    expect(store.getLocalThemeSettings()).toEqual({ enableHomepageMultiPing: true });
    store.replaceLocalThemeSettings({ homepageMultiPingTaskIds: [] });
    expect(store.getLocalThemeSettings()).toEqual({ homepageMultiPingTaskIds: [] });
    store.resetLocalThemeSettings();
    expect(store.getLocalThemeSettings()).toEqual({});
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("reads server settings and saves changes despite a throwing storage getter", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => new Response(JSON.stringify(
      url === "/api/me"
        ? { authed: true, site_name: "Example monitor", public_page: true }
        : { enableHomepageMultiPing: true, homepageMultiPingTaskIds: [], adminNickname: "Example" },
    ), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = await import("@/services/api");
    expect(api.extractUsernameFromStorage()).toBe("");
    const config = await api.getPublic();
    expect(config.sitename).toBe("Example monitor");
    expect(config.theme_settings.homepageMultiPingTaskIds).toEqual([]);
    await api.saveAdminUsername("Example admin");
    const store = await import("@/services/themeSettingsStore");
    expect(store.getLocalThemeSettings().adminNickname).toBe("Example admin");
    await api.saveThemeSettings({ enableHomepageMultiPing: true, homepageMultiPingTaskIds: [] });
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/themes/sao/config" && init?.method === "PUT")).toBe(true);
  });

  it("falls back for metadata and matrix presets when the property itself throws", async () => {
    const metadata = await import("@/hooks/useSiteMetadata");
    expect(metadata.readStoredSiteMetadata()).toEqual({ siteName: null, description: null });
    expect(() => metadata.persistSiteMetadata("Example", "Example description")).not.toThrow();
    const presets = await import("@/utils/matrixPatterns");
    expect(presets.loadUserMatrixPresets()).toEqual([]);
    expect(() => presets.saveUserMatrixPresets([])).not.toThrow();
  });

  it("also catches getItem and setItem failures when the storage object is accessible", async () => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: {
      getItem() { throw new DOMException("Blocked", "SecurityError"); },
      setItem() { throw new DOMException("Full", "QuotaExceededError"); },
      removeItem() { throw new DOMException("Blocked", "SecurityError"); },
    } });
    const store = await import("@/services/themeSettingsStore");
    expect(store.getLocalThemeSettings()).toEqual({});
    expect(() => store.saveLocalThemeSettings({ homepageMultiPingTaskIds: [] })).not.toThrow();
    expect(store.getLocalThemeSettings().homepageMultiPingTaskIds).toEqual([]);
    expect(() => store.resetLocalThemeSettings()).not.toThrow();
  });
});
