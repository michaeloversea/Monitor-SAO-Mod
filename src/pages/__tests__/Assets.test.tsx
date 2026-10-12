// @vitest-environment jsdom
import { setLanguage } from "@/i18n";
import type { NodeInfo } from "@/types/theme";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Assets } from "../Assets";

const fixture = vi.hoisted(() => ({ mobile: false }));
const nodes = [
  { uuid: "usd", name: "USD example", price: 30, currency: "USD", billing_cycle: 30 },
  { uuid: "eur", name: "EUR example", price: 28, currency: "EUR", billing_cycle: 30 },
  { uuid: "cny", name: "CNY example", price: 10, currency: "CNY", billing_cycle: 30 },
  { uuid: "free", name: "Free example", price: -1, currency: "USD" },
  { uuid: "missing", name: "Missing rate", price: 50, currency: "HKD", billing_cycle: 90 },
].map((node, weight) => ({ ...node, weight, expired_at: "", region: "JP" })) as unknown as NodeInfo[];
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ data: { logged_in: true } }) }));
vi.mock("@/hooks/useClock", () => ({ useHourlyClock: () => 1_800_000_000_000 }));
vi.mock("@/hooks/useVisibleNodes", () => ({ useVisibleNodes: () => nodes }));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => fixture.mobile }));
vi.mock("@/hooks/useThemeSettings", () => ({ useThemeSettings: () => ({ isReady: true, showCostSummary: true, costIgnoredNodes: [], costPremiums: { eur: { amount: 20, acquiredAt: "2026-01-01" } }, costRateApiUrl: "https://example.invalid/rates" }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: { rates: { USD: 1, EUR: 0.8, CNY: 7 }, time: 0 }, isFetching: false, refetch: vi.fn() }) }));

afterEach(() => { setLanguage(null); fixture.mobile = false; vi.unstubAllGlobals(); });

async function renderAssets() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><Assets /></MemoryRouter>));
  return { container, close: async () => { await act(async () => root.unmount()); } };
}

it("separates CNY and original prices with per-column tags; both sort by CNY rather than mixed nominal amounts", async () => {
  const { container, close } = await renderAssets();
  try {
    const headers = [...container.querySelectorAll("th button")];
    expect(headers.map((button) => button.textContent)).toEqual(["节点", "CNY 价格", "原始价格", "剩余价值", "溢价", "溢价月摊", "到期"]);
    const rows = () => [...container.querySelectorAll("tbody tr")];
    const order = () => rows().map((row) => row.querySelector(".assets-node-link")?.textContent);
    await act(async () => (headers[1] as HTMLButtonElement).click());
    const cnyOrder = order();
    expect(cnyOrder.slice(0, 3)).toEqual(["EUR example", "USD example", "CNY example"]);
    await act(async () => (headers[2] as HTMLButtonElement).click());
    expect(order()).toEqual(cnyOrder);
    expect(rows()[0].querySelector('td:nth-child(2) [data-tone="price"]')?.textContent).toContain("245.00");
    expect(rows()[0].querySelector('td:nth-child(3) [data-tone="original"]')?.textContent).toBe("EUR 28/月");
    await act(async () => (headers[2] as HTMLButtonElement).click());
    expect(order().slice(0, 3)).toEqual(["CNY example", "USD example", "EUR example"]);
    expect(container.textContent).toContain("汇率缺失");
    expect(container.textContent).toContain("HKD 50/季");
    expect(container.querySelector(".cost-summary-original-price-chip")).toBeNull();
    expect(new Set([...container.querySelectorAll(".asset-value-tag")].map((tag) => tag.getAttribute("data-tone")))).toEqual(new Set(["price", "original", "remaining", "premium", "monthly", "expiry"]));
  } finally { await close(); }
});

it("switches units immediately without changing financial amounts, sorting or server names", async () => {
  const { container, close } = await renderAssets();
  try {
    const values = () => [...container.querySelectorAll('[data-tone="price"]')].map((tag) => tag.textContent?.split("/")[0]);
    const before = values();
    await act(async () => setLanguage("en"));
    expect(container.querySelectorAll("th")[1].textContent).toBe("CNY price");
    expect(container.textContent).toContain("USD 30/month");
    expect(container.textContent).toContain("Exchange rate missing");
    expect(values().slice(0, 3)).toEqual(before.slice(0, 3));
    expect(container.querySelector(".assets-node-link")?.textContent).toBe("USD example");
    await act(async () => setLanguage("zh-TW"));
    expect(container.querySelectorAll("th")[2].textContent).toBe("原始價格");
    expect(container.textContent).toContain("匯率缺失");
  } finally { await close(); }
});

it("uses the same tag styles and preserves original currency when a mobile rate is unavailable", async () => {
  fixture.mobile = true;
  const { container, close } = await renderAssets();
  try {
    expect(container.querySelector(".assets-table")).toBeNull();
    expect(container.querySelectorAll('[data-tone="price"]').length).toBe(5);
    expect(container.querySelectorAll('[data-tone="original"]').length).toBe(4);
    expect(container.textContent).toContain("HKD 50/季");
    expect(container.querySelector(".cost-summary-original-price-chip")).toBeNull();
  } finally { await close(); }
});
