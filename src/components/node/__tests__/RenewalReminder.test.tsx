// @vitest-environment jsdom
import { setLanguage } from "@/i18n";
import type { RenewalReminderSource } from "@/utils/renewalReminder";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RenewalReminder } from "../RenewalReminder";

vi.mock("@/hooks/usePriceVisibility", () => ({ usePriceVisibility: () => ({ isPriceVisible: true }) }));

let container: HTMLDivElement;
let root: Root;
let mobile = true;
let mediaListeners: Set<() => void>;

beforeEach(() => {
  mobile = true;
  mediaListeners = new Set();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return mobile; },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  }));
  setLanguage("en");
  container = document.createElement("div");
  container.style.transform = "translateY(-1px)";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setLanguage(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openReminder() {
  const node = { uuid: "example", name: "Example Server", expires_in: 4, price: 12, currency: "USD", billing_cycle: "monthly", auto_renewal: false } as RenewalReminderSource;
  await act(async () => root.render(<MemoryRouter><RenewalReminder nodes={[node]} /></MemoryRouter>));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => vi.advanceTimersByTime(20));
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

it("keeps the mobile dialog outside transformed cards and moves it back on desktop resize", async () => {
  let panel = await openReminder();
  expect(panel.parentElement).toBe(document.body);
  expect(container.contains(panel)).toBe(false);
  expect(panel.textContent).toContain("Example Server");
  await act(async () => {
    mobile = false;
    mediaListeners.forEach((listener) => listener());
  });
  panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(container.contains(panel)).toBe(true);
  await act(async () => {
    mobile = true;
    mediaListeners.forEach((listener) => listener());
  });
  expect(document.querySelector('[role="dialog"]')?.parentElement).toBe(document.body);
});

it("keeps portal focus and inside clicks open, then closes on an outside click", async () => {
  const panel = await openReminder();
  await act(async () => {
    panel.querySelector<HTMLButtonElement>(".renewal-reminder-later")!.focus();
    panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    vi.advanceTimersByTime(300);
  });
  expect(document.querySelector('[role="dialog"]')).toBe(panel);
  await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(["button", "Escape"])("closes with %s without reopening after restoring trigger focus", async (method) => {
  const panel = await openReminder();
  await act(async () => {
    if (method === "button") panel.querySelector<HTMLButtonElement>(".renewal-reminder-close")!.click();
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    vi.advanceTimersByTime(400);
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});

it.each(["later", "dismiss"])("preserves the %s preference action from the mobile portal", async (action) => {
  const panel = await openReminder();
  await act(async () => {
    const button = panel.querySelector<HTMLButtonElement>(`.renewal-reminder-${action}`)!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.click();
    vi.advanceTimersByTime(400);
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const preferences = JSON.parse(localStorage.getItem("lumina-renewal-reminders-v1")!);
  if (action === "later") expect(Object.values(preferences.snoozedUntil)).toEqual([Date.now() + 86_400_000 - 400]);
  else expect(preferences.dismissedCycles).toHaveLength(1);
});
