import { afterEach, describe, expect, it } from "vitest";
import { setLanguage } from "@/i18n";
import { formatCompactBillingCycle, formatCompactExpire } from "@/components/node/nodeCardShared";
import { formatBillingCycle, formatCompactRenewalPrice } from "@/utils/billing";

afterEach(() => setLanguage(null));
describe("compact card billing and expiry", () => {
  it("shortens only compact English billing, retaining the actual multi-month/year cycle", () => {
    setLanguage("en");
    for (const [cycle, suffix] of [["yearly", "y"], ["quarterly", "q"], ["monthly", "m"], ["semiannual", "6m"], ["biennial", "2y"], ["18m", "18m"], ["once", "once"]] as const) {
      expect(formatCompactRenewalPrice({ price: 123.45, currency: "USD", billing_cycle: cycle })).toBe(`$123.45/${suffix}`);
      expect(formatCompactBillingCycle(cycle)).toBe(suffix);
    }
    expect(formatBillingCycle("yearly")).toBe("year");
    expect(formatCompactBillingCycle("yearly", -1)).toBe("Free");
    expect(formatCompactExpire({ value: "310", unit: "days" })).toBe("310 d");
    expect(formatCompactExpire({ value: "—", unit: "" })).toBe("--");
    expect(formatCompactExpire({ value: "Expired", unit: "" })).toBe("Expired");
  });
  it.each(["zh-CN", "zh-TW"] as const)("keeps localized Chinese units and removes the redundant expiry prefix in %s", (locale) => {
    setLanguage(locale);
    expect(formatCompactExpire({ value: "310", unit: "天" })).toBe("310天");
    expect(formatCompactRenewalPrice({ price: 123.45, currency: "USD", billing_cycle: "yearly" })).toBe("$123.45/年");
    expect(formatCompactExpire({ value: "今日", unit: "" })).toBe("今日");
  });
});
