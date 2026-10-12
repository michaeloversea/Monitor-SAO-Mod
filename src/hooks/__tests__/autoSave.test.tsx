// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "../useAutoSave";

let container: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useAutoSave>;
let mounted = false;
function Probe(props: { value: string; enabled?: boolean; invalid?: boolean; save: (value: string) => Promise<void> }) {
  latest = useAutoSave({ ...props, enabled: props.enabled ?? true, invalid: props.invalid ?? false, signature: props.value });
  return <span>{latest.phase}</span>;
}
async function render(value: string, save: (value: string) => Promise<void>, extras: { enabled?: boolean; invalid?: boolean } = {}) {
  await act(async () => root.render(<StrictMode><Probe value={value} save={save} {...extras} /></StrictMode>));
}
async function tick(ms = 800) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container); mounted = true;
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
});
describe("auto-save queue", () => {
  it("does not save hydration and coalesces rapid edits", async () => {
    const save = vi.fn(async () => {});
    await render("initial", save, { enabled: false }); await tick(); expect(save).not.toHaveBeenCalled();
    await render("A", save); await tick(400);
    await render("B", save); await tick(799); expect(save).not.toHaveBeenCalled();
    await tick(1); expect(save.mock.calls).toEqual([["B"]]); expect(latest.phase).toBe("saved");
  });
  it("serializes writes and saves the latest edit after a pending request", async () => {
    let resolve!: () => void;
    const save = vi.fn((value: string) => value === "A" ? new Promise<void>((done) => { resolve = done; }) : Promise.resolve());
    await render("initial", save, { enabled: false });
    await render("A", save); await tick(); expect(latest.phase).toBe("saving");
    await render("B", save); await render("C", save); await tick(1600); expect(save.mock.calls).toEqual([["A"]]);
    await act(async () => resolve()); await tick(); expect(save.mock.calls).toEqual([["A"], ["C"]]);
  });
  it("holds invalid drafts, then saves the repaired values", async () => {
    const save = vi.fn(async () => {});
    await render("initial", save, { enabled: false });
    await render("invalid", save, { invalid: true }); await tick(); expect(save).not.toHaveBeenCalled();
    await render("valid", save); await tick(); expect(save.mock.calls).toEqual([["valid"]]);
  });
  it("retains failed drafts without an endless retry loop and supports explicit retry", async () => {
    const save = vi.fn<(value: string) => Promise<void>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    await render("initial", save, { enabled: false }); await render("A", save); await tick();
    expect(latest.phase).toBe("error"); await tick(8000); expect(save).toHaveBeenCalledTimes(1);
    await act(async () => latest.retry()); expect(save.mock.calls).toEqual([["A"], ["A"]]); expect(latest.phase).toBe("saved");
  });
  it("flushes pending edits on exit and keeps the latest edit queued while saving", async () => {
    let resolve!: () => void;
    const save = vi.fn((value: string) => value === "A" ? new Promise<void>((done) => { resolve = done; }) : Promise.resolve());
    await render("initial", save, { enabled: false }); await render("A", save); await tick(); await render("B", save);
    await act(async () => root.unmount()); mounted = false; expect(save.mock.calls).toEqual([["A"]]);
    await act(async () => resolve()); expect(save.mock.calls).toEqual([["A"], ["B"]]);
  });
  it("submits a valid debounce draft immediately when leaving the page", async () => {
    const save = vi.fn(async () => {});
    await render("initial", save, { enabled: false }); await render("A", save);
    await act(async () => root.unmount()); mounted = false; expect(save.mock.calls).toEqual([["A"]]);
  });
});
