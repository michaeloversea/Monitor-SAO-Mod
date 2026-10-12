import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type AutoSavePhase = "idle" | "waiting" | "saving" | "saved" | "error";

/** 合并连续编辑、串行保存；失败后保留草稿，修改或手动重试才再次提交。 */
export function useAutoSave<T>({ value, signature, enabled, invalid, save, delay = 800 }: {
  value: T;
  signature: string;
  enabled: boolean;
  invalid: boolean;
  save: (value: T) => Promise<void>;
  delay?: number;
}) {
  const [phase, setPhase] = useState<AutoSavePhase>("idle");
  const [revision, setRevision] = useState(0);
  const latest = useRef({ value, signature, enabled, invalid, save });
  const mounted = useRef(false);
  const running = useRef(false);
  const successful = useRef<string | null>(null);
  const failed = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef<() => Promise<void>>(async () => {});
  useLayoutEffect(() => { latest.current = { value, signature, enabled, invalid, save }; });
  useLayoutEffect(() => {
    flush.current = async () => {
      const snapshot = latest.current;
      if (running.current || !snapshot.enabled || snapshot.invalid || snapshot.signature === successful.current || snapshot.signature === failed.current) return;
      running.current = true;
      if (mounted.current) setPhase("saving");
      try {
        await snapshot.save(snapshot.value);
        successful.current = snapshot.signature;
        failed.current = null;
        if (mounted.current) setPhase("saved");
      } catch {
        failed.current = snapshot.signature;
        if (mounted.current) setPhase("error");
      } finally {
        running.current = false;
        // 保存期间的后续编辑继续排队，旧请求不会被当成最新草稿已保存。
        if (latest.current.signature !== snapshot.signature) {
          if (mounted.current) setRevision((current) => current + 1);
          else void flush.current();
        }
      }
    };
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      // 离开页面时提交合法的待保存草稿；已有请求完成后继续处理最新编辑。
      void flush.current();
    };
  }, []);
  useEffect(() => {
    if (!enabled || invalid) {
      if (!running.current) setPhase("idle");
      return;
    }
    if (running.current || signature === successful.current || signature === failed.current) return;
    setPhase("waiting");
    timer.current = setTimeout(() => { timer.current = null; void flush.current(); }, delay);
    return () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  }, [signature, enabled, invalid, revision, delay]);
  const retry = () => { failed.current = null; if (timer.current) clearTimeout(timer.current); timer.current = null; void flush.current(); };
  return { phase, retry };
}
