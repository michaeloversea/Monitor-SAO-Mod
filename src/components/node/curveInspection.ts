import type { PingOverviewBucket } from "@/types/theme";
import { curveIndexAt } from "./latencyCurveGeometry";

/** Match the inspected time, never a nearby sample across a missing interval. */
export function curveInspectionIndex(buckets: PingOverviewBucket[], time: number | null, fraction: number) {
  if (time != null && buckets.some((bucket) => bucket.startAt != null && bucket.endAt != null)) {
    const index = buckets.findIndex((bucket) => bucket.startAt != null && bucket.endAt != null && bucket.startAt <= time && time < bucket.endAt);
    return index < 0 ? null : index;
  }
  return curveIndexAt(fraction, buckets.length);
}
