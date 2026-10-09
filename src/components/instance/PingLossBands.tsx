import { memo, useId, useLayoutEffect, useRef, type PointerEvent, type KeyboardEvent } from "react";
import { lossBandColor, lossBandBucketAtTime, type LossBandBucket } from "./lossBandData";

export interface PingPlotGeometry { left: number; width: number; start: number; end: number }
export interface PingLossBandRow { taskId: number; label: string; color: string; buckets: LossBandBucket[] }
export interface PingLossBandHover { row: PingLossBandRow; bucket: LossBandBucket; fraction: number; clientY: number }

/** 色带只更新独立 SVG；悬停复用已有图表的游标，不改变曲线或坐标轴。 */
export const PingLossBands = memo(function PingLossBands({ visible, rows, geometry, onHover, onLeave }: {
  visible: boolean;
  rows: PingLossBandRow[];
  geometry: PingPlotGeometry | null;
  onHover: (hover: PingLossBandHover) => void;
  onLeave: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const clipId = useId().replace(/:/g, "");
  const clearCell = (svg: SVGSVGElement) => { delete svg.dataset.activeCell; };
  useLayoutEffect(() => {
    rootRef.current?.querySelectorAll("svg").forEach(clearCell);
  }, [rows, visible]);
  const highlightCell = (svg: SVGSVGElement, row: PingLossBandRow, fraction: number) => {
    rootRef.current?.querySelectorAll<SVGSVGElement>("svg[data-active-cell]").forEach((other) => { if (other !== svg) clearCell(other); });
    const index = Math.min(row.buckets.length - 1, Math.max(0, Math.floor(fraction * row.buckets.length)));
    const marker = svg.querySelector(".instance-loss-cell-hover");
    if (!marker || !row.buckets[index]) return;
    marker.setAttribute("x", String(index));
    marker.setAttribute("fill", lossBandColor(row.buckets[index].loss));
    svg.dataset.hoverIndex = String(index);
    svg.dataset.activeCell = "true";
  };
  const pointAt = (row: PingLossBandRow, fraction: number, clientY: number) => {
    const bounded = Math.max(0, Math.min(1 - Number.EPSILON, fraction));
    const first = row.buckets[0];
    const last = row.buckets[row.buckets.length - 1];
    const bucket = first && last ? lossBandBucketAtTime(row.buckets, Math.min(last.end - 0.0001, first.start + (last.end - first.start) * bounded)) : null;
    if (bucket) onHover({ row, bucket, fraction: bounded, clientY });
  };
  const pointer = (event: PointerEvent<SVGSVGElement>, row: PingLossBandRow) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0) {
      const fraction = Math.max(0, Math.min(1 - Number.EPSILON, (event.clientX - bounds.left) / bounds.width));
      highlightCell(event.currentTarget, row, fraction);
      pointAt(row, fraction, bounds.bottom);
    }
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>, row: PingLossBandRow) => {
    if (event.key === "Escape") { clearCell(event.currentTarget); onLeave(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const svg = event.currentTarget;
    const current = Number(svg.dataset.hoverIndex ?? 0);
    const index = event.key === "Home" ? 0 : event.key === "End" ? row.buckets.length - 1
      : Math.max(0, Math.min(row.buckets.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)));
    const fraction = (index + 0.5) / row.buckets.length;
    highlightCell(svg, row, fraction);
    pointAt(row, fraction, svg.getBoundingClientRect().bottom);
  };
  return <div ref={rootRef} className="instance-ping-loss-bands" hidden={!visible || !geometry || !rows.length} aria-label="各线路丢包色带"
    onPointerLeave={() => { rootRef.current?.querySelectorAll("svg").forEach(clearCell); onLeave(); }}>
    <p className="setting-hint mb-2">丢包色带：绿 0% · 黄绿 &lt;5% · 黄 &lt;20% · 橙 &lt;50% · 红 &lt;100% · 深红 100% · 灰色未采样（历史聚合可能平均短时峰值）</p>
    {rows.map((row) => <div key={row.taskId} className="instance-ping-loss-band-row" style={{ marginLeft: geometry?.left, width: geometry?.width }}>
      <span className="instance-ping-loss-band-label" title={row.label}>{row.label}</span>
      <svg viewBox={`0 0 ${row.buckets.length} 6`} preserveAspectRatio="none" role="img" tabIndex={0}
        aria-label={`${row.label} 丢包色带，左右方向键查看，Escape 关闭提示`}
        onPointerMove={(event) => pointer(event, row)} onPointerDown={(event) => pointer(event, row)} onKeyDown={(event) => keyboard(event, row)}
        onFocus={(event) => {
          const fraction = (Number(event.currentTarget.dataset.hoverIndex ?? 0) + 0.5) / Math.max(1, row.buckets.length);
          highlightCell(event.currentTarget, row, fraction);
        }} onBlur={(event) => { clearCell(event.currentTarget); onLeave(); }}>
        <defs><clipPath id={`${clipId}-${row.taskId}`}><rect width={row.buckets.length} height={6}
          rx={row.buckets.length / Math.max(1, geometry?.width ?? 1) * 3} ry={3} /></clipPath></defs>
        <g clipPath={`url(#${clipId}-${row.taskId})`}>
          {row.buckets.map((bucket, index) => <rect aria-hidden="true" key={index} x={index} y={0} width={1.01} height={6} fill={lossBandColor(bucket.loss)} />)}
        </g>
        <rect aria-hidden="true" className="instance-loss-cell-hover" x={0} y={0} width={1.01} height={6} rx={0.25} />
      </svg>
    </div>)}
  </div>;
});
