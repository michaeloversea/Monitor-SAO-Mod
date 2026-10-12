// @vitest-environment jsdom
import { HomepageNodePingEditor } from "@/components/node/HomepageNodePingEditor";
import { LanguageMenu } from "@/components/shell/LanguageMenu";
import { getLanguage, setDefaultLanguage, setLanguage, t } from "@/i18n";
import type { AdminClient, PingTask } from "@/types/theme";
import { normalizeThemeSettings, THEME_CONFIG_KEYS } from "@/utils/themeSettings";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setDefaultLanguage("zh-CN");
  setLanguage(null);
});

it("uses the site default until a visitor chooses a language, then can follow the default again", () => {
  setDefaultLanguage("zh-TW"); setLanguage(null);
  expect(getLanguage()).toBe("zh-TW");
  expect(t("语言设置")).toBe("語言設置");
  setLanguage("en"); setDefaultLanguage("zh-CN");
  expect(getLanguage()).toBe("en");
  expect(document.documentElement.lang).toBe("en");
  expect(localStorage.getItem("monitor-sao:language")).toBe("en");
  setLanguage(null);
  expect(getLanguage()).toBe("zh-CN");
  expect(localStorage.getItem("monitor-sao:language")).toBeNull();
});

it("switches language in memory when storage is blocked", () => {
  vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new DOMException("Disabled", "SecurityError"); });
  vi.spyOn(localStorage, "removeItem").mockImplementation(() => { throw new DOMException("Disabled", "SecurityError"); });
  expect(() => { setDefaultLanguage("zh-TW"); setLanguage("en"); }).not.toThrow();
  expect(t("CNY 价格")).toBe("CNY price");
  setLanguage(null);
  expect(getLanguage()).toBe("zh-TW");
});

it("validates the shared default and preserves compatibility with old configs", () => {
  expect(normalizeThemeSettings({}).defaultLanguage).toBe("zh-CN");
  expect(normalizeThemeSettings({ defaultLanguage: "fr" } as never).defaultLanguage).toBe("zh-CN");
  for (const defaultLanguage of ["zh-CN", "zh-TW", "en"] as const) {
    expect(normalizeThemeSettings({ defaultLanguage }).defaultLanguage).toBe(defaultLanguage);
  }
  expect(THEME_CONFIG_KEYS).toContain("defaultLanguage");
});

it("keeps interpolated user text literal, including strings that match translation keys", () => {
  expect(t("{0} 信息", ["首页 <script>"], "en")).toContain("首页 <script>");
});

it("updates the menu across tabs and supports keyboard dismissal and returning to the default", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguage(null);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LanguageMenu />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(document.activeElement?.getAttribute("data-language")).toBe("zh-CN");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-language="en"]')!.click());
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Language settings");
    expect(container.querySelector(".language-menu")).toBeNull();
    await act(async () => {
      localStorage.setItem("monitor-sao:language", "zh-TW");
      window.dispatchEvent(new StorageEvent("storage", { key: "monitor-sao:language" }));
    });
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("語言設置");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelector(".language-menu")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("button"));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".language-menu-default")!.click());
    expect(getLanguage()).toBe("zh-CN");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("translates the settings UI while preserving node and task names", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setLanguage("en");
  const node = { uuid: "example", name: "首页" } as AdminClient;
  const task = { id: 1, name: "延迟", clients: [node.uuid] } as PingTask;
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<HomepageNodePingEditor nodes={[node]} tasks={[task]} settings={{ example: { mode: "custom", taskIds: [1] } }} bindings={{}} onChange={() => {}} nodesReady />));
    expect(container.querySelector(".node-ping-node-button")?.textContent).toContain("首页");
    expect(container.querySelector(".node-ping-task-tag")?.textContent).toBe("延迟");
    expect(container.textContent).not.toContain("自定义（指定线路与顺序）");
  } finally { await act(async () => root.unmount()); }
});
