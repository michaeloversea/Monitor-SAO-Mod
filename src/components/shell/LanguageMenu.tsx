import { LANGUAGE_OPTIONS, setLanguage, t, useLanguage } from "@/i18n";
import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function LanguageMenu() {
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    root.current?.querySelector<HTMLButtonElement>(`[data-language="${language}"]`)?.focus();
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open, language]);
  return <div className="language-control" ref={root}>
    <button ref={trigger} className="control-button grid h-9 w-9 place-items-center" type="button"
      title={t("语言设置")} aria-label={t("语言设置")} aria-expanded={open} aria-controls="theme-language-menu" onClick={() => setOpen((value) => !value)}>
      <Languages size={16} />
    </button>
    {open && <div id="theme-language-menu" className="language-menu" role="group" aria-label={t("语言设置")}>
      {LANGUAGE_OPTIONS.map((option) => <button key={option.value} type="button" data-language={option.value}
        aria-pressed={language === option.value} onClick={() => { setLanguage(option.value); setOpen(false); trigger.current?.focus(); }}>
        <span lang={option.value}>{option.label}</span>{language === option.value && <Check size={14} />}
      </button>)}
      <button className="language-menu-default" type="button" onClick={() => { setLanguage(null); setOpen(false); trigger.current?.focus(); }}>{t("使用站点默认")}</button>
    </div>}
  </div>;
}
