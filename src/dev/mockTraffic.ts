// Irregular transfer bursts shared across nodes, with per-node jitter. Unlike a
// sine wave, each short preview window includes pauses, shoulders and sharp peaks.
const TRANSFER_PATTERN = [
  0.1, 0.12, 0.08, 0.3, 1.25, 2.4, 0.62, 0.18,
  0.09, 0.14, 0.72, 1.6, 0.4, 0.16, 0.04, 0.08,
  0.35, 0.92, 2.0, 0.72, 0.25, 0.08, 0.15, 0.06,
];

export function mockTrafficRate(nodeIndex: number, direction: "up" | "down", time: number): number {
  const tick = Math.floor(time / 2000);
  const offset = direction === "up" ? 0 : 7;
  const phase = ((tick + offset) % TRANSFER_PATTERN.length + TRANSFER_PATTERN.length) % TRANSFER_PATTERN.length;
  let hash = Math.imul(tick ^ (nodeIndex + 1) * 7919 ^ offset * 104729, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  const jitter = 0.82 + ((hash >>> 0) / 0xffffffff) * 0.36;
  const bases = direction === "up" ? [60_000, 450_000, 3_500_000, 12_000_000]
    : [90_000, 750_000, 4_800_000, 18_000_000];
  return Math.round(bases[nodeIndex % bases.length] * TRANSFER_PATTERN[phase] * jitter);
}
