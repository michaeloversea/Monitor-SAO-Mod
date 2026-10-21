import { useTranslate } from "@/i18n";
import type { PingOverviewBucket } from "@/types/theme";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { HealthBucketTooltip } from "./HealthBucketTooltip";
import { curveIndexAt, curvePointX, latencyCurveGeometry } from "./latencyCurveGeometry";
import { formatHealthBucketTooltip } from "./pingBucketText";

export interface LatencyCurveInspection {
  index: number | null;
  fraction: number | null;
  onIndexChange: (index: number | null) => void;
}

export function LatencyCurve({ buckets, color, label, inspection }: { buckets: PingOverviewBucket[]; color: string; label: string; inspection?: LatencyCurveInspection }) {
  const t = useTranslate();
  const gradientId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const [localIndex, setLocalIndex] = useState<number | null>(null);
  const hoveredIndex = inspection ? inspection.index : localIndex;
  const setHoveredIndex = inspection ? inspection.onIndexChange : setLocalIndex;
  useEffect(() => {
    if (inspection || localIndex == null) return;
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setLocalIndex(null);
    };
    document.addEventListener("pointerdown", dismiss, true);
    return () => document.removeEventListener("pointerdown", dismiss, true);
  }, [inspection, localIndex]);
  const { paths, points } = useMemo(() => latencyCurveGeometry(buckets), [buckets]);
  const bucket = hoveredIndex == null ? null : buckets[hoveredIndex];
  const point = hoveredIndex == null ? null : points[hoveredIndex];
  const cursorX = inspection ? inspection.fraction == null ? null : inspection.fraction * 160 : hoveredIndex == null ? null : curvePointX(hoveredIndex, buckets.length);
  const tooltip = bucket ? `${formatHealthBucketTooltip(bucket, "latency")} · ${t("丢包")} ${bucket.loss == null || bucket.total <= 0 ? t("无样本") : `${bucket.loss.toFixed(1)}%`}` : null;
  const locate = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setHoveredIndex(curveIndexAt((event.clientX - bounds.left) / Math.max(1, bounds.width), buckets.length));
  };
  return (
    <span ref={containerRef} className="multi-ping-curve" style={{ color }}>
      <svg viewBox="0 0 160 28" preserveAspectRatio="none" role="img" tabIndex={0}
        aria-label={t("{0} 延迟曲线，使用左右方向键查看样本", [label])}
        onPointerMove={locate} onPointerDown={(event) => { event.stopPropagation(); locate(event); }}
        onClick={(event) => event.stopPropagation()} onPointerLeave={(event) => { if (!inspection && event.pointerType !== "touch") setHoveredIndex(null); }}
        onFocus={() => { if (hoveredIndex == null) setHoveredIndex(buckets.length ? buckets.length - 1 : null); }} onBlur={() => { if (!inspection) setHoveredIndex(null); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); setHoveredIndex(null); }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation();
            setHoveredIndex(buckets.length ? Math.max(0, Math.min(buckets.length - 1, (hoveredIndex ?? buckets.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))) : null);
          }
        }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".18" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
        {paths.length ? paths.map(({ line, area }, index) => <g key={index}>
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </g>) : <path d="M0,24 H160" stroke="var(--border-subtle)" strokeDasharray="3 4" />}
        {cursorX != null && <line className="multi-ping-curve-cursor" x1={cursorX} x2={cursorX} y1="1" y2="27" stroke="currentColor" opacity=".5" vectorEffect="non-scaling-stroke" />}
        {point && <circle cx={cursorX ?? point.x} cy={point.y} r="2" fill="currentColor" />}
      </svg>
      {!inspection && <HealthBucketTooltip text={tooltip} index={hoveredIndex} count={buckets.length} />}
    </span>
  );
}
