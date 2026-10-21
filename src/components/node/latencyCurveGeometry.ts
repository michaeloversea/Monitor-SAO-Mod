import type { PingOverviewBucket } from "@/types/theme";

/** Midpoint quadratics stay inside the sample range and preserve missing slots. */
export function latencyCurveGeometry(buckets: PingOverviewBucket[], width = 160, height = 28) {
  const values = buckets.map((bucket) => bucket.total > 0 && bucket.value != null && Number.isFinite(bucket.value) && bucket.value >= 0 ? bucket.value : null);
  const valid = values.filter((value): value is number => value != null);
  const min = valid.length ? Math.min(...valid) : 0;
  const max = valid.length ? Math.max(...valid) : 0;
  const pad = Math.max(1, (max - min) * 0.12);
  const points = values.map((value, index) => value == null ? null : ({
    x: curvePointX(index, values.length, width),
    y: height - 3 - (value - min + pad) / (max - min + pad * 2) * (height - 6),
  }));
  const paths: { line: string; area: string }[] = [];
  let segment: { x: number; y: number }[] = [];
  const flush = () => {
    if (!segment.length) return;
    const first = segment[0];
    const last = segment[segment.length - 1];
    let line = `M${first.x},${first.y}`;
    if (segment.length === 1) line = `M${Math.max(0, first.x - 1.5)},${first.y} L${Math.min(width, first.x + 1.5)},${first.y}`;
    else {
      for (let i = 1; i < segment.length; i++) {
        const previous = segment[i - 1];
        const next = segment[i];
        line += ` Q${previous.x},${previous.y} ${(previous.x + next.x) / 2},${(previous.y + next.y) / 2}`;
      }
      line += ` T${last.x},${last.y}`;
    }
    paths.push({ line, area: `${line} L${last.x},${height} L${first.x},${height} Z` });
    segment = [];
  };
  for (const point of points) { if (point) segment.push(point); else flush(); }
  flush();
  return { paths, points };
}

// Use slot centres, matching HealthBucketTooltip and the existing block display.
export function curvePointX(index: number, count: number, width = 160) {
  return (index + 0.5) / Math.max(1, count) * width;
}

export function curveIndexAt(fraction: number, count: number): number | null {
  return count <= 0 || !Number.isFinite(fraction) ? null : Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
}
