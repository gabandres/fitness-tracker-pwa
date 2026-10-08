#!/usr/bin/env node
/**
 * Which components and hooks the React Compiler SKIPS, and why.
 *
 * `app.json` turns the compiler on, but it bails out of a function silently —
 * an `eslint-disable` of a React hooks rule, a `try/finally`, a ref read during
 * render — and that function then re-renders with nothing memoized. No build,
 * test or lint step reports it. Measured 2026-10-08: 52 of ~305 skipped,
 * including EntrySheet, FoodSearch and the + button.
 *
 * Runs the installed `babel-plugin-react-compiler` with the options
 * `babel-preset-expo` passes in production (`target: '19'`,
 * `panicThreshold: 'NONE'`), with a logger.
 *
 *   node scripts/react-compiler-report.mjs            # every skip, grouped by file
 *   node scripts/react-compiler-report.mjs --count    # one line: compiled / skipped
 *   node scripts/react-compiler-report.mjs src/components/EntrySheet.tsx
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const root = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const countOnly = args.includes('--count');
const targets = args.filter((a) => !a.startsWith('--'));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(test|spec)\./.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const files = targets.length ? targets.map((t) => join(process.cwd(), t)) : walk(join(root, 'src'));
let compiled = 0;
const skips = [];
for (const file of files) {
  const events = [];
  try {
    babel.transformSync(readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
      plugins: [
        ['babel-plugin-react-compiler', {
          target: '19',
          panicThreshold: 'none',
          logger: { logEvent: (_f, e) => events.push(e) },
        }],
      ],
      sourceType: 'module',
    });
  } catch (e) {
    skips.push({ file, line: 0, fn: '(file)', reason: `transform failed: ${e.message.split('\n')[0]}` });
    continue;
  }
  for (const e of events) {
    if (e.kind === 'CompileSuccess') compiled++;
    else if (e.kind === 'CompileError' || e.kind === 'CompileSkip' || e.kind === 'PipelineError') {
      const d = e.detail ?? {};
      const loc = e.fnLoc ?? d.loc ?? d.options?.loc;
      const reason = (d.reason ?? d.options?.reason ?? e.reason ?? e.data ?? '').toString().split('\n')[0];
      const line = loc?.start?.line ?? 0;
      // One function can fail several checks; report it once, every reason.
      const prior = skips.find((s) => s.file === file && s.line === line);
      if (prior) {
        if (!prior.reason.includes(reason)) prior.reason += `; ${reason}`;
      } else skips.push({ file, line, fn: e.fnName ?? '', reason });
    }
  }
}

if (countOnly) {
  console.log(`compiled ${compiled}, skipped ${skips.length}`);
} else {
  let last = '';
  for (const s of skips.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    const rel = relative(root, s.file);
    if (rel !== last) console.log(`\n${rel}`);
    last = rel;
    console.log(`  :${s.line} ${s.fn ? s.fn + ' — ' : ''}${s.reason}`);
  }
  console.log(`\ncompiled ${compiled}, skipped ${skips.length}`);
}
