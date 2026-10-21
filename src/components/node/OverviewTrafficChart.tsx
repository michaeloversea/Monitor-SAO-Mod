import { useTranslate } from "@/i18n";
import { formatByteRate, formatByteRateLabel } from "@/utils/format";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { buildTrafficCurve } from "./trafficCurve";

interface SingleTrafficPoint {
  time: number;
  rate: number;
}

interface HoverInfo {
  index: number;
  time: number;
  rate: number;
  x: number;
}

const MAX_HISTORY_POINTS = 16;

function formatPointTime(timeMs: number): string {
  const d = new Date(timeMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// 动态整值标尺刻度对齐算法：确保 Y 轴在动态缩放时数值始终整洁优雅（如 400 MB/s、200 MB/s、0）
function getNiceRateCeiling(value: number): number {
  const KIB = 1024;
  const MIB = 1024 * 1024;
  const GIB = 1024 * 1024 * 1024;

  if (value <= 0) return 100 * KIB;
  if (value <= 50 * KIB) return 50 * KIB;
  if (value <= 100 * KIB) return 100 * KIB;
  if (value <= 200 * KIB) return 200 * KIB;
  if (value <= 500 * KIB) return 500 * KIB;
  if (value <= 1 * MIB) return 1 * MIB;
  if (value <= 2 * MIB) return 2 * MIB;
  if (value <= 5 * MIB) return 5 * MIB;
  if (value <= 10 * MIB) return 10 * MIB;
  if (value <= 20 * MIB) return 20 * MIB;
  if (value <= 50 * MIB) return 50 * MIB;
  if (value <= 100 * MIB) return 100 * MIB;
  if (value <= 200 * MIB) return 200 * MIB;
  if (value <= 300 * MIB) return 300 * MIB;
  if (value <= 400 * MIB) return 400 * MIB;
  if (value <= 500 * MIB) return 500 * MIB;
  if (value <= 800 * MIB) return 800 * MIB;
  if (value <= 1 * GIB) return 1 * GIB;
  if (value <= 2 * GIB) return 2 * GIB;
  if (value <= 5 * GIB) return 5 * GIB;
  return Math.ceil(value / GIB) * GIB;
}

function SingleTrafficCard({
  title,
  direction,
  rate,
  color,
  gradientTop,
  gradientBottom,
  haloRgba,
}: {
  title: string;
  direction: "up" | "down";
  rate: number;
  color: string;
  gradientTop: string;
  gradientBottom: string;
  haloRgba: string;
}) {
  const t = useTranslate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<SingleTrafficPoint[]>([]);
  const hoverIndexRef = useRef<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [tooltipWidth, setTooltipWidth] = useState(0);

  useLayoutEffect(() => {
    if (hoverInfo && tooltipRef.current) {
      // offsetWidth ignores the entrance animation's scale.
      setTooltipWidth(tooltipRef.current.offsetWidth);
    }
  }, [hoverInfo, t]);

  hoverIndexRef.current = hoverInfo?.index ?? null;

  // 记录滚动历史点
  useEffect(() => {
    const now = Date.now();
    const history = historyRef.current;
    history.push({ time: now, rate });
    if (history.length > MAX_HISTORY_POINTS) {
      history.shift();
    }
  }, [rate]);

  // Canvas 绘制曲线与波形函数
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (width === 0 || height === 0) {
      return;
    }

    // Keep narrow charts sharp on 1× displays and in enlarged previews too.
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    // 每次重置变换矩阵，保证 X 与 Y 等比缩放，彻底杜绝拉伸畸变与模糊
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const history = historyRef.current;
    const points =
      history.length > 1
        ? history
        : [
            { time: Date.now() - 2000, rate },
            { time: Date.now(), rate },
          ];

    // 动态计算当前区间的最高速率并对齐整值刻度
    let peakRate = 0;
    for (const p of points) {
      if (p.rate > peakRate) peakRate = p.rate;
    }
    const maxVal = getNiceRateCeiling(peakRate);

    const paddingLeft = 56;
    const paddingBottom = 18;
    const paddingTop = 6;
    const paddingRight = 14;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    // 绘制背景参考网格线
    ctx.strokeStyle = "rgba(140, 140, 140, 0.14)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    ctx.font = "10px Inter, system-ui, -apple-system, sans-serif";
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--text-muted").trim() || "#71717a";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const gridSteps = 2;
    for (let i = 0; i <= gridSteps; i++) {
      const y = paddingTop + (plotHeight / gridSteps) * i;
      const val = maxVal * (1 - i / gridSteps);

      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();

      ctx.fillText(formatByteRateLabel(val), paddingLeft - 5, y);
    }

    ctx.setLineDash([]);

    // 绘制 X 轴时间刻度（首尾两个时间点）
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const timeSteps = plotWidth < 200 ? 1 : 2;
    const startTime = points[0].time;
    const endTime = points[points.length - 1].time;
    const timeSpan = Math.max(1000, endTime - startTime);

    for (let i = 0; i <= timeSteps; i++) {
      const x = paddingLeft + (plotWidth / timeSteps) * i;
      const t = new Date(startTime + (timeSpan / timeSteps) * i);
      const timeStr = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
      if (i === 0) {
        ctx.textAlign = "left";
      } else if (i === timeSteps) {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "center";
      }
      ctx.fillText(timeStr, x, height - paddingBottom + 4);
    }

    if (points.length > 1) {
      const hoverIdx = hoverIndexRef.current;

      const projected = points.map((point, index) => ({
        x: paddingLeft + (index / (points.length - 1)) * plotWidth,
        y: paddingTop + plotHeight - (point.rate / maxVal) * plotHeight,
      }));
      const segments = buildTrafficCurve(projected);
      const traceCurve = () => {
        ctx.moveTo(projected[0].x, projected[0].y);
        segments.forEach(({ control1, control2, end }) => {
          ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
        });
      };

      // 填充与描边使用同一曲线，采样点和峰值保持原样。
      const gradient = ctx.createLinearGradient(0, paddingTop, 0, paddingTop + plotHeight);
      gradient.addColorStop(0, gradientTop);
      gradient.addColorStop(1, gradientBottom);

      ctx.beginPath();
      traceCurve();
      ctx.lineTo(paddingLeft + plotWidth, paddingTop + plotHeight);
      ctx.lineTo(paddingLeft, paddingTop + plotHeight);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();

      // 圆滑连线
      ctx.beginPath();
      traceCurve();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // 数据圆圈节点（内部线条色，外圈纯白）
      points.forEach((p, idx) => {
        const x = paddingLeft + (idx / (points.length - 1)) * plotWidth;
        const y = paddingTop + plotHeight - (p.rate / maxVal) * plotHeight;
        const isHovered = hoverIdx === idx;

        if (isHovered) {
          ctx.beginPath();
          ctx.arc(x, y, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = haloRgba;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(x, y, isHovered ? 3.3 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = isHovered ? 2 : 1.5;
        ctx.stroke();
      });
    }
  }, [color, gradientBottom, gradientTop, haloRgba, rate]);

  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  // 当依赖更新时立即重绘
  useEffect(() => {
    const animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  // 监听容器与视口尺寸变化，自适应重绘，杜绝任何桌面端与移动端切换时的拉伸形变
  useEffect(() => {
    const target = wrapRef.current || canvasRef.current;
    if (!target) return;

    let resizeRafId: number | null = null;
    const handleResize = () => {
      setHoverInfo(null);
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        resizeRafId = null;
        drawRef.current();
      });
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => {
        handleResize();
      });
      ro.observe(target);
    }

    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // 处理鼠标悬浮与触屏滑动
  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const paddingLeft = 56;
    const paddingRight = 14;
    const plotWidth = rect.width - paddingLeft - paddingRight;

    if (plotWidth <= 0) return;

    const history = historyRef.current;
    const points = history.length > 1 ? history : [];
    if (points.length <= 1) return;

    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (x - paddingLeft) / plotWidth));
    const idx = Math.round(ratio * (points.length - 1));
    const point = points[idx];
    if (!point) return;

    const pointX = paddingLeft + (idx / (points.length - 1)) * plotWidth;
    setHoverInfo({
      index: idx,
      time: point.time,
      rate: point.rate,
      x: pointX,
    });
  };

  const handlePointerLeave = () => {
    setHoverInfo(null);
  };

  return (
    <div className="mao-realtime-chart-card">
      <div className="mao-realtime-chart-head">
        <div className="mao-realtime-chart-title">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {direction === "up" ? (
              <>
                <path d="m18 15-6-6-6 6" />
                <path d="M12 9v12" />
              </>
            ) : (
              <>
                <path d="m6 9 6 6 6-6" />
                <path d="M12 3v12" />
              </>
            )}
          </svg>
          <span>{title}</span>
        </div>
        <span className="mao-realtime-chart-rates" style={{ color }}>
          {direction === "up" ? "↑" : "↓"} {formatByteRateLabel(rate)}
        </span>
      </div>
      <div
        ref={wrapRef}
        className="mao-realtime-chart-canvas-wrap"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="mao-realtime-chart-canvas" />
        {hoverInfo && (
          <div
            ref={tooltipRef}
            className="mao-chart-tooltip"
            style={{
              left: `clamp(4px, ${hoverInfo.x - tooltipWidth / 2}px, calc(100% - ${tooltipWidth + 4}px))`,
            }}
          >
            <div className="mao-chart-tooltip-header">
              <span className="mao-chart-tooltip-time">{formatPointTime(hoverInfo.time)}</span>
            </div>
            <div className="mao-chart-tooltip-row">
              <span className="mao-chart-tooltip-label">
                <i style={{ background: color }} />
                {direction === "up" ? t("上传") : t("下载")}
              </span>
              <span className="mao-chart-tooltip-val" style={{ color }}>
                {formatByteRateLabel(hoverInfo.rate)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function OverviewTrafficChart({
  netUp,
  netDown,
}: {
  netUp: number;
  netDown: number;
}) {
  const t = useTranslate();
  const totalRate = formatByteRate(netUp + netDown);

  return (
    <div className="mao-progress-section mao-network-section">
      <div className="mao-progress-section-header">
        <div className="flex flex-wrap items-baseline gap-1.5 min-w-0">
          <span className="mao-progress-big-num">
            {totalRate.value}
          </span>
          <span className="mao-progress-unit-label">
            {totalRate.unit} {t("实时总带宽")}</span>
        </div>
      </div>

      <div className="mao-realtime-charts-grid">
        <SingleTrafficCard
          title={t("上行")}
          direction="up"
          rate={netUp}
          color="#3b82f6"
          gradientTop="rgba(59, 130, 246, 0.22)"
          gradientBottom="rgba(59, 130, 246, 0.01)"
          haloRgba="rgba(59, 130, 246, 0.25)"
        />
        <SingleTrafficCard
          title={t("下行")}
          direction="down"
          rate={netDown}
          color="#2f9e65"
          gradientTop="rgba(47, 158, 101, 0.22)"
          gradientBottom="rgba(47, 158, 101, 0.01)"
          haloRgba="rgba(47, 158, 101, 0.25)"
        />
      </div>
    </div>
  );
}
