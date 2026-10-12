import { useCallback, useSyncExternalStore } from "react";
import { messages } from "./messages";

export type Language = "zh-CN" | "zh-TW" | "en";
export const LANGUAGE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
] as const;
const PREFERENCE_KEY = "monitor-sao:language";
const DEFAULT_KEY = "monitor-sao:default-language";
export function isLanguage(value: unknown): value is Language {
  return value === "zh-CN" || value === "zh-TW" || value === "en";
}
function read(key: string): Language | null {
  if (typeof window === "undefined") return null;
  try { const value = localStorage.getItem(key); return isLanguage(value) ? value : null; }
  catch { return null; }
}
function write(key: string, value: Language | null) {
  if (typeof window === "undefined") return;
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* 内存偏好仍生效 */ }
}
let explicit = read(PREFERENCE_KEY);
let defaultLanguage: Language = read(DEFAULT_KEY) ?? "zh-CN";
let language: Language = explicit ?? defaultLanguage;
if (typeof document !== "undefined") document.documentElement.lang = language;
const listeners = new Set<() => void>();
function update() {
  language = explicit ?? defaultLanguage;
  if (typeof document !== "undefined") document.documentElement.lang = language;
  for (const listener of listeners) listener();
}
export function getLanguage() { return language; }
export function setLanguage(value: Language | null) { explicit = value; write(PREFERENCE_KEY, value); update(); }
export function setDefaultLanguage(value: Language) {
  if (defaultLanguage === value) return;
  defaultLanguage = value; write(DEFAULT_KEY, value); update();
}
function onStorage(event: StorageEvent) {
  if (event.key !== PREFERENCE_KEY && event.key !== DEFAULT_KEY && event.key !== null) return;
  explicit = read(PREFERENCE_KEY); defaultLanguage = read(DEFAULT_KEY) ?? defaultLanguage; update();
}
function subscribe(listener: () => void) {
  if (!listeners.size && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size && typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
}
export function useLanguage() { return useSyncExternalStore(subscribe, getLanguage, getLanguage); }
export function useTranslate() {
  const locale = useLanguage();
  return useCallback((source: string, values: readonly unknown[] = []) => t(source, values, locale), [locale]);
}

/** 只翻译主题文案；参数中的节点名、任务名和用户输入保持原文。 */
export function t(source: string, values: readonly unknown[] = [], locale = language): string {
  const message = locale === "zh-CN" ? source : messages[source]?.[locale] ?? source;
  return message.replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] == null ? match : String(values[Number(index)]));
}
