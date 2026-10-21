export interface CurvePoint {
  x: number;
  y: number;
}

export interface CurveSegment {
  control1: CurvePoint;
  control2: CurvePoint;
  end: CurvePoint;
}

/** Monotone cubic interpolation: passes through samples without adding peaks. */
export function buildTrafficCurve(points: readonly CurvePoint[]): CurveSegment[] {
  if (points.length < 2) return [];

  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x),
  );
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[index - 1];
    const left = slopes[index - 1];
    const right = slopes[index];
    return left * right <= 0 ? 0 : 2 / (1 / left + 1 / right);
  });

  // Limit tangents to keep each segment inside its two sample values.
  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      return;
    }
    const alpha = tangents[index] / slope;
    const beta = tangents[index + 1] / slope;
    const magnitude = Math.hypot(alpha, beta);
    if (magnitude > 3) {
      tangents[index] = (3 * alpha / magnitude) * slope;
      tangents[index + 1] = (3 * beta / magnitude) * slope;
    }
  });

  return points.slice(1).map((end, index) => {
    const start = points[index];
    const thirdWidth = (end.x - start.x) / 3;
    return {
      control1: { x: start.x + thirdWidth, y: start.y + tangents[index] * thirdWidth },
      control2: { x: end.x - thirdWidth, y: end.y - tangents[index + 1] * thirdWidth },
      end,
    };
  });
}
