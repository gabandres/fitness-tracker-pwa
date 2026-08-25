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
 * The second cannot be zero today — those sites have no boundary to adopt until
 * ADR-0030 step 3 puts one on the profile — so it is a **ratchet**: the count is
 * pinned at `BASELINE` and the check fails if it moves in EITHER direction. Up
 * means a new latent bug. Down means a conversion landed and the baseline was
 * not tightened, which is how a ratchet quietly stops being one.
 *
 * `--list` prints the outstanding sites: that is the step-3 worklist.
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
  // Not a day bucket: the local-naive `YYYY-MM-DDTHH:mm:ss` string Health
  // Connect's period slicer wants. Re-bucketing it would corrupt the request.
  'apps/mobile/src/lib/health.ts': ['d'],
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

// The ratchet. Deliberately NOT zero: these sites cannot adopt `dayKeyAt` until
// step 3 puts the boundary on the profile. It may only ever go DOWN, and the
// check fails in BOTH directions — so neither a new site nor a finished
// conversion can pass unnoticed.
const BASELINE = 75;

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
  console.log(`✓ day boundary (ADR-0030): localDateKey gone; ${total} call(s) awaiting step 3`);
}
process.exit(failed ? 1 : 0);
