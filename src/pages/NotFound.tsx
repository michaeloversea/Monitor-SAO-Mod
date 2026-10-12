import { useTranslate } from "@/i18n";
import { Link } from "react-router-dom";

export function NotFound() {
  const t = useTranslate();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-7xl font-semibold tracking-tight text-(--text-primary)">
        404
      </div>
      <p className="text-(--text-secondary)">{t("页面未找到")}</p>
      <Link
        to="/"
        className="control-button px-5 py-2 text-[13px] font-medium"
      >
        {t("返回首页")}</Link>
    </div>
  );
}
