// TEMPORARY measurement probe (scratch branch `perf-probe`, never shipped).
// Logs through console.error because RCTLog drops info/warn in Release.
import type { ProfilerOnRenderCallback } from 'react';

type Ev = { at: number; what: string; ms?: number };

let t0 = 0;
let tab = '';
let events: Ev[] = [];
let gaps: { at: number; ms: number }[] = [];
let sampling = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hstats = (): Record<string, number> => ((globalThis as any).HermesInternal?.getInstrumentedStats?.() ?? {});
let stats0: Record<string, number> = {};

const now = () => performance.now();
const rel = () => Math.round(now() - t0);
const out = (s: string) => console.error(`[PERF] ${s}`);

export function probeTabPress(name: string): void {
  if (sampling) report();
  t0 = now();
  tab = name;
  events = [];
  gaps = [];
  sampling = true;
  stats0 = hstats();
  let last = now();
  const frame = () => {
    const n = now();
    const gap = n - last;
    if (gap > 20) gaps.push({ at: Math.round(last - t0), ms: Math.round(gap) });
    last = n;
    if (n - t0 < 2500 && sampling) requestAnimationFrame(frame);
    else report();
  };
  requestAnimationFrame(frame);
}

function report(): void {
  if (!sampling) return;
  sampling = false;
  const commits = events.filter((e) => e.what.startsWith('commit'));
  const totalRender = commits.reduce((s, e) => s + (e.ms ?? 0), 0);
  const blocked = gaps.reduce((s, g) => s + g.ms, 0);
  const lastGap = gaps.length ? gaps[gaps.length - 1] : null;
  out(
    `SUMMARY tab=${tab} commits=${commits.length} renderMs=${Math.round(totalRender)} ` +
      `jsStalls=${gaps.length} stallMs=${blocked} longest=${Math.max(0, ...gaps.map((g) => g.ms))} ` +
      `settledAt=${lastGap ? lastGap.at + lastGap.ms : 0}`,
  );
  const s1 = hstats();
  const d = Object.keys(s1).filter((k) => /gc|GC|alloc|Alloc|heap|Heap/.test(k) && typeof s1[k] === 'number')
    .map((k) => `${k}=${Math.round((s1[k] - (stats0[k] ?? 0)) * 100) / 100}`).join(' ');
  out(`HSTATS tab=${tab} ${d}`);
  out(`GAPS tab=${tab} ${gaps.map((g) => `${g.at}+${g.ms}`).join(' ')}`);
  out(`EVENTS tab=${tab} ${events.map((e) => `${e.at}:${e.what}${e.ms != null ? `=${e.ms}` : ''}`).join(' | ')}`);
}

export const probeOnRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
  if (!sampling) return;
  if (actualDuration < 1) return;
  events.push({ at: rel(), what: `commit:${id}:${phase}`, ms: Math.round(actualDuration * 10) / 10 });
};

export function probeDelivery(key: string, fromCache: boolean | undefined, ms: number): void {
  if (!sampling) return;
  events.push({ at: rel(), what: `snap:${key}:${fromCache ? 'cache' : 'server'}`, ms: Math.round(ms * 10) / 10 });
}

export function probeMark(what: string): void {
  if (!sampling) return;
  events.push({ at: rel(), what });
}

export function probeCallback(path: string, fromCache: boolean | undefined, size: number, ms: number): void {
  if (!sampling) return;
  events.push({ at: rel(), what: `cb:${path}:${fromCache ? 'cache' : 'server'}:n${size}`, ms: Math.round(ms * 10) / 10 });
}

// PROBE: what does HermesInternal expose in this build?
setTimeout(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (globalThis as any).HermesInternal;
  console.error(`[PERF] HERMES keys=${h ? Object.getOwnPropertyNames(h).join(',') : 'none'}`);
}, 1000);
