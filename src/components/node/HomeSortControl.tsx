import type { HomeSortControlState } from "@/hooks/useHomeSort";
import { useLanguage, useTranslate } from "@/i18n";
import {
  HOME_SORT_FIELDS,
  HOME_SORT_FIELD_LABELS,
  type HomeSortDirection,
  type HomeSortField,
} from "@/utils/homeSort";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

// 单个图标同时表达排序与方向。
function SortIcon({ direction, size = 14 }: { direction: HomeSortDirection; size?: number }) {
  useLanguage();
  return direction === "asc" ? (
    <ArrowUpNarrowWide size={size} aria-hidden />
  ) : (
    <ArrowDownWideNarrow size={size} aria-hidden />
  );
}

// 选择当前维度会翻转方向，选择其他维度会采用该维度的自然方向。
export function HomeSortControl({ state }: { state: HomeSortControlState }) {
  const t = useTranslate();
  const { field, direction, setField, toggleDirection } = state;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const select = (next: HomeSortField) => {
    if (next === field) toggleDirection();
    else setField(next);
  };

  return (
    <div className="home-sort" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="home-sort-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("排序方式，当前{0}{1}", [t(HOME_SORT_FIELD_LABELS[field]), t(direction === "asc" ? "升序" : "降序")])}
        title={t("排序：{0}（{1}）", [t(HOME_SORT_FIELD_LABELS[field]), t(direction === "asc" ? "升序" : "降序")])}
        onClick={() => setOpen((value) => !value)}
      >
        <SortIcon direction={direction} />
        <span>{t(HOME_SORT_FIELD_LABELS[field])}</span>
      </button>
      {open && (
        <div id={panelId} className="home-sort-panel" role="group" aria-label={t("排序方式")}>
          {HOME_SORT_FIELDS.map((option) => {
            const active = option === field;
            return (
              <button
                key={option}
                type="button"
                aria-current={active ? "true" : undefined}
                data-active={active ? "true" : "false"}
                className="home-sort-item"
                onClick={() => select(option)}
              >
                <span className="home-sort-item-label">{t(HOME_SORT_FIELD_LABELS[option])}</span>
                {active && <SortIcon direction={direction} size={15} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
