import { useTranslate } from "@/i18n";
import { getDisplayRegionCode } from "@/utils/geo";
import { useState } from "react";

// 更换旗帜资源时递增目录版本，避免浏览器/CDN 沿用同地址的旧 SVG。
const FLAG_ASSET_ROOT = "/assets/flags-rect-v1";

interface FlagProps {
  region?: string | null;
  size?: number;
}

export function Flag({ region, size = 14 }: FlagProps) {
  const t = useTranslate();
  const value = region?.trim() ?? "";
  const flagCode = getDisplayRegionCode(value);
  const [failure, setFailure] = useState({ code: flagCode, stage: 0 });
  const failStage = failure.code === flagCode ? failure.stage : 0;
  const width = size * 4 / 3;

  if (!value) {
    return (
      <span
        aria-hidden
        className="inline-block shrink-0"
        style={{
          width,
          height: size,
          borderRadius: 2,
          background: "var(--border-subtle)",
        }}
      />
    );
  }

  const alt = t("地区旗帜: {0}", [flagCode]);

  if (failStage >= 2) {
    return (
      <span
        role="img"
        aria-label={alt}
        className="inline-block shrink-0"
        title={alt}
        style={{
          width,
          height: size,
          borderRadius: 2,
          background: "var(--border-subtle)",
        }}
      />
    );
  }

  // 本地打包的完整矩形旗帜；未知地区或读取失败时使用同尺寸的 xx.svg。
  const src =
    failStage === 0
      ? `${FLAG_ASSET_ROOT}/${flagCode.toLowerCase()}.svg`
      : `${FLAG_ASSET_ROOT}/xx.svg`;

  return (
    <span
      className="inline-flex items-center justify-center shrink-0 overflow-hidden select-none"
      style={{
        width,
        height: size,
        borderRadius: 2,
        lineHeight: 0,
        boxShadow: "0 0 0 1px var(--hairline)",
      }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="w-full h-full pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          display: "block",
        }}
        onError={() => setFailure((prev) => ({ code: flagCode, stage: prev.code === flagCode ? prev.stage + 1 : 1 }))}
      />
    </span>
  );
}

