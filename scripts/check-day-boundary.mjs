#!/usr/bin/env node
/**
 * ADR-0030 Q3 — "the current implicit local midnight must stop being reachable".
 *
 * Two things are checked, and they are different:
 *
 * 1. **`localDateKey` cannot come back.** The name is gone from the codebase
 *    (renamed to `calendarDateKey` on 2026-08-25) precisely because it let a
 *    call site pick between "the calendar date" and "the user's day" by
 *    accident. Re-introducing it re-opens that, so it is a hard failure.
 *
 * 2. **`calendarDateKey` applied to a real wall-clock instant is a latent bug**
 *    — that is the rule `date.ts` states: the calendar date is the right answer
 *    only when the `Date` was synthesized from a key that is already settled
 *    (`parseYmd`, or `addDays` off one). Applied to `new Date()`, a log's
 *    `.date`, or a health sample's `.endDate`, the right answer is `dayKeyAt`.
 *
 * **Both of ADR-0030's open decisions are now answered and the count is ZERO.**
 * Q4 (widget/watch) shipped in `9c6d8efd`; Q5 (importers) in the change that
 * dropped this baseline. Every remaining `calendarDateKey` outside core is
 * exempted BY ARGUMENT in `CALENDAR_OK` below, each with the reason it is
 * genuinely not a user-day derivation.
 *
 * It stays a **ratchet**: the count is pinned at `BASELINE` and the check fails
 * if it moves in EITHER direction. Up means a new latent bug. Down means a
 * conversion landed and the baseline was not tightened, which is how a ratchet
 * quietly stops being one. At zero the first half is what does the work — any
 * new site must justify itself in `CALENDAR_OK` or convert.
 *
 * `--list` prints the outstanding sites.
 *
 * Usage: node scripts/check-day-boundary.mjs [--list]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Every `calendarDateKey(...)` outside `packages/core` is reported, and the
 * exemptions are listed here BY ARGUMENT rather than by file or line — a line
 * number goes stale on the next edit, and a whole-file exemption hides the next
 * call added to that file.
 *
 * An entry belongs here only when the `Date` is genuinely not a wall-clock
 * instant: synthesized from a settled key, or a pure wall-clock FORMATTING
 * operation that is not bucketing anything. Everything else is a step-3 site.
 */
const CALENDAR_OK = {
  // `start` is `parseYmd(from)` — a settled key stepped by whole days. The
  // window's anchor is chosen inside `activityWindowRange`, which is threaded.
  'apps/mobile/src/lib/activity-suggestion.ts': ['addDays(start, i)'],
  // ADR-0030 Q5, ANSWERED — these four are the importer sites, and they are
  // exempt for two different reasons.
  //
  //   `d`      — not a day bucket at all: the local-naive
  //              `YYYY-MM-DDTHH:mm:ss` string Health Connect's period slicer
  //              wants. Re-bucketing it would corrupt the request.
  //   `start`  — an OS-BUCKETED DAILY TOTAL (both platforms). The OS did this
  //              bucketing, at calendar midnight, and the bucket holds a full
  //              00:00-24:00 figure. Re-keying its start under a 03:00
  //              boundary would file a whole calendar day's steps as the
  //              previous user-day. Q5's rule: an imported daily total keeps
  //              its SOURCE's day. The raw-sample paths beside these, which
  //              carry an instant and no day, DID convert.
  //   `new Date(s.endDate)` / `new Date(end)`
  //            — SLEEP, on iOS and Android. A night belongs to the morning you
  //              woke, which is ADR-0033's rule and what #80's guard depends
  //              on. ADR-0030 deliberately does not reach into it.
  'apps/mobile/src/lib/health.ts': ['d', 'start', 'new Date(s.endDate)', 'new Date(end)'],
  // The widget's FALLBACK comparison for blobs written before `dayEndsMs`
  // existed (#77 Q4, shipped in `9c6d8efd`). `widgetView` prefers that field,
  // which the phone computes with the user's boundary; this argument is only
  // reached for a snapshot that predates it. Neither this file nor
  // `Glance.swift` re-derives a day.
  'apps/mobile/src/widgets/render.tsx': ['now'],
  // Analytics buffers flush per CALENDAR day on purpose. This is internal
  // bookkeeping — never shown to a user, never fed to the estimator — and
  // moving it would only change which UTC-ish bucket a batch flushes in.
  'apps/mobile/src/lib/analytics.ts': ['new Date()'],
};

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const listOnly = process.argv.includes('--list');
let failed = false;

// ── 1. The renamed primitive must not come back ──────────────────
// Prose may name it — `date.ts` explains the rename, and the ADR is cited all
// over. Only an actual identifier counts, so comment lines are skipped and a
// backtick-quoted mention is not a use.
const revived = git('grep', '-n', '-w', 'localDateKey', '--', '*.ts', '*.tsx')
  .split('\n')
  .filter(Boolean)
  .filter((line) => {
    const code = line.replace(/^[^:]+:\d+:/, '');
    if (/^\s*(\*|\/\/|\/\*)/.test(code)) return false;
    return !/`localDateKey`/.test(code);
  });
if (revived.length > 0) {
  failed = true;
  console.error('✗ `localDateKey` is back. It was renamed to `calendarDateKey` (ADR-0030 Q3)');
  console.error('  because the name let a call site avoid choosing between the calendar date');
  console.error('  and the user\'s day. Use `calendarDateKey` or `dayKeyAt`, not this.\n');
  for (const line of revived) console.error(`    ${line}`);
  console.error('');
}

// ── 2. The calendar date taken of a real wall-clock instant ─────
//
// Every call outside core counts unless CALENDAR_OK exempts it by argument.
// Flagging everything and exempting the few is deliberate: the first version of
// this check pattern-matched what an instant LOOKS like, and silently missed
// `calendarDateKey(date)` in `useTrain.ts` because a bare identifier matches no
// pattern. A gate whose failure mode is a false negative is not a gate.
let files;
try {
  files = git('grep', '-l', 'calendarDateKey', '--', '*.ts', '*.tsx').split('\n').filter(Boolean);
} catch {
  files = []; // no matches at all
}

/** The argument text of every `calendarDateKey(...)` on a line, paren-balanced. */
function callArgs(text) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf('calendarDateKey(', i)) !== -1) {
    let depth = 0;
    let j = i + 'calendarDateKey'.length;
    const from = j + 1;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) break;
    }
    out.push(text.slice(from, j).trim());
    i = j + 1;
  }
  return out;
}

const worklist = new Map();
for (const file of files) {
  if (file.startsWith('packages/core/src/')) continue; // core is threaded; covered by tests
  // Specs construct dates to assert against and are not shipping day logic.
  if (/\.(spec|test)\.tsx?$/.test(file)) continue;
  const exempt = CALENDAR_OK[file] ?? [];
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    const trimmed = text.trimStart();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    for (const arg of callArgs(text)) {
      if (exempt.includes(arg)) continue;
      if (!worklist.has(file)) worklist.set(file, []);
      worklist.get(file).push(`${i + 1}: ${trimmed}`);
    }
  });
}

const total = [...worklist.values()].reduce((n, hits) => n + hits.length, 0);

if (listOnly) {
  console.log(`ADR-0030 step-3 worklist — ${total} call(s) in ${worklist.size} file(s)\n`);
  for (const [file, hits] of [...worklist].sort()) {
    console.log(`  ${file}`);
    for (const h of hits) console.log(`      ${h}`);
  }
  process.exit(0);
}

// The ratchet, now at ZERO — ADR-0030 step 3 is complete. It still fails in
// BOTH directions: a new unexempted site is a latent bug, and there is nothing
// left to convert, so any drop would mean the check itself broke.
const BASELINE = 0;

if (total > BASELINE) {
  failed = true;
  console.error(`✗ ${total - BASELINE} new call(s) take the calendar date of a wall-clock instant.`);
  console.error('  That is the ADR-0030 bug — use `dayKeyAt(instant, boundary)`. If the Date is');
  console.error('  genuinely key-derived, exempt it by argument in CALENDAR_OK with a reason.\n');
  for (const [file, hits] of [...worklist].sort()) {
    console.error(`    ${file}`);
    for (const h of hits) console.error(`        ${h}`);
  }
  console.error('');
} else if (total < BASELINE) {
  failed = true;
  console.error(`✗ ${BASELINE - total} site(s) converted — lower BASELINE to ${total} in this file.`);
  console.error('  The ratchet only holds if it is tightened when the work is done.\n');
}

if (!failed) {
  console.log('✓ day boundary (ADR-0030): localDateKey gone; step 3 complete, 0 unexempted call(s)');
}
process.exit(failed ? 1 : 0);
