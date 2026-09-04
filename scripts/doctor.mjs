#!/usr/bin/env node
/**
 * doctor — assert the facts this repo has actually drifted on.
 *
 *   npm run doctor                 # everything the current credentials allow
 *   npm run doctor -- --no-cloud   # only checks that need no credentials (CI)
 *   npm run doctor -- --strict     # a SKIP is a failure (pre-deploy gate)
 *   npm run doctor -- --json       # machine-readable
 *
 * This is not a linter and not a test suite; both of those already pass while
 * the things below are wrong. Every check here corresponds to a drift that has
 * really happened in this repository, and each one cost real time or shipped a
 * false claim:
 *
 *   1. Copy promised a feature whose flag was off. `go-to-market.md` sold
 *      "Snap a photo — AI estimates the macros" and a Pro tier while
 *      `photoScan` and `PRO_ENABLED` were both false — a 2.3.1 rejection risk
 *      and a one-star-review generator.
 *   2. Local `firestore.rules` diverged from the released ruleset, and the
 *      dev app talks to PROD Firestore, so an un-deployed rule silently
 *      rejects every client write of a new field.
 *   3. Cloud Scheduler's free tier is 3 jobs and Secret Manager's is 6 active
 *      versions. Both are already at or near the cap; exceeding either starts
 *      billing quietly.
 *   4. A locale drifted a key and the UI fell back to the raw key string.
 *   5. `STATUS.md` §3 listed work that was already closed.
 *   6. Plan docs outlived their work and grew "CORRECTION" blocks on top,
 *      which is how a status doc and a wish list became indistinguishable —
 *      three separate times, features already shipped were re-scoped as new.
 *
 * Exit code is 1 if any check FAILS. SKIP never fails the run: a machine
 * without gcloud/firebase/gh credentials must still be able to run this, and
 * CI runs the credential-free subset via --no-cloud.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'fitness-tracker-gb-1775407101';
/** The Firebase Android app and the Play package it maps to. Both are public
 *  identifiers (ADR-0002); the credential that reads Play is git-ignored. */
const ANDROID_APP_ID = '1:647810616435:android:a6f4c5f9e200b3332c2e06';
const ANDROID_PACKAGE = 'fit.ignia.app';

const argv = process.argv.slice(2);
const NO_CLOUD = argv.includes('--no-cloud');
const AS_JSON = argv.includes('--json');
/** Treat a SKIP as a failure. "Run doctor before deploying" is only a real
 *  gate if an absent credential can't quietly turn the deploy-critical checks
 *  into no-ops — with --strict, a machine that cannot verify says so loudly. */
const STRICT = argv.includes('--strict');

// ─── Tiny check harness ────────────────────────────────────────────────
const results = [];
const record = (group, name, status, detail) =>
  results.push({ group, name, status, detail });
const pass = (g, n, d = '') => record(g, n, 'PASS', d);
const fail = (g, n, d) => record(g, n, 'FAIL', d);
const skip = (g, n, d) => record(g, n, 'SKIP', d);

/** A check that throws should fail loudly as itself, not abort the run —
 *  a doctor that dies on its own bug tells you nothing about the repo. */
function guard(group, name, fn) {
  try {
    fn();
  } catch (e) {
    fail(group, name, `check threw: ${e.message}`);
  }
}

const read = (p) => readFileSync(resolve(root, p), 'utf8');
const has = (p) => existsSync(resolve(root, p));

/**
 * Run a command and say WHICH kind of not-working it was.
 *
 * Collapsing both into "null" hid real breakage: a tool that is absent and a
 * tool that ran and rejected the request both read as SKIP, so an expired
 * login or a revoked permission looked exactly like "you don't have gcloud
 * installed" and the run stayed green.
 *
 *   { missing: true }  — the binary is not on PATH. A genuine SKIP.
 *   { ok: false }      — it ran and failed. That is a FAIL, with its stderr.
 *   { ok: true, stdout }
 *
 * `shell: true` because firebase/gh/gcloud are .cmd shims on Windows; that
 * also means ENOENT rarely surfaces as r.error, since the shell itself starts
 * fine and then reports the missing command on stderr — hence matching the
 * shell's own wording as well as the errno.
 */
const MISSING_TOOL =
  /(is not recognized as an internal or external command|command not found|: not found|No such file or directory)/i;

function sh(cmd, args, { timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: true,
    timeout,
    cwd: root,
    windowsHide: true,
  });
  const stderr = (r.stderr ?? '').trim();
  if (r.error?.code === 'ENOENT') return { missing: true, cmd, stderr };
  if (r.status !== 0 && MISSING_TOOL.test(stderr)) return { missing: true, cmd, stderr };
  if (r.error) return { ok: false, cmd, stderr: stderr || r.error.message };
  if (r.status !== 0) return { ok: false, cmd, stderr };
  return { ok: true, stdout: r.stdout, cmd, stderr };
}

/** First line of a command's stderr, for a failure message that fits on one. */
const firstLine = (s) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean)[0] ?? 'no stderr';

/**
 * Resolve a command result to either usable stdout or a recorded SKIP/FAIL.
 * Returns null when the caller should stop — the result is already recorded.
 */
function useOutput(group, name, res, { skipHint }) {
  if (res.missing) {
    skip(group, name, skipHint ?? `${res.cmd} is not installed`);
    return null;
  }
  if (!res.ok) {
    fail(group, name, `\`${res.cmd}\` exited non-zero: ${firstLine(res.stderr)}`);
    return null;
  }
  return res.stdout;
}

/** CLI wrappers print banners and update notices around their JSON. */
function parseJsonLoose(text) {
  if (!text) return null;
  const i = text.search(/[[{]/);
  if (i === -1) return null;
  try {
    return JSON.parse(text.slice(i));
  } catch {
    return null;
  }
}

/**
 * Tracked files matching a git pathspec. The pattern is quoted because `sh`
 * runs through a shell: unquoted, bash expands the glob itself against the CWD
 * (so `public/*.html` never reaches git and nested files are missed), while
 * cmd.exe does not expand and git sees the pattern. That difference showed up
 * as CI scanning 1517 copy lines against 1669 locally.
 *
 * Note git pathspec `*` crosses `/` — `public/*.html` already matches
 * `public/es/download.html`, so a second `**` pattern would double-count.
 * Results are de-duplicated regardless.
 */
const gitFiles = (glob) => {
  const res = sh('git', ['ls-files', `"${glob}"`]);
  // git failing is never a SKIP — every file-scanning check would then report
  // "0 files, all good" and pass vacuously. Throw so guard() records a FAIL.
  if (res.missing) throw new Error('git is not installed');
  if (!res.ok) throw new Error(`git ls-files failed: ${firstLine(res.stderr)}`);
  return [...new Set(res.stdout.split('\n').map((s) => s.trim()).filter(Boolean))];
};

// ═══ 1. Copy never promises a feature whose flag is off ═════════════════
const G1 = '1. copy vs feature flags';

/** Reads a literal boolean out of a source file. Deliberately a regex and not
 *  an import: these files pull in Angular/Expo runtime, and doctor must run
 *  with nothing built. */
function readFlag(file, pattern) {
  if (!has(file)) return { value: null, why: `${file} not found` };
  const m = read(file).match(pattern);
  if (!m) return { value: null, why: `no match for ${pattern} in ${file}` };
  return { value: m[1] === 'true', why: '' };
}

function collectFlags() {
  const flags = {};
  // The web flags (`subscription.service.ts` PRO_ENABLED, `features.ts`
  // photoScan) went with the web logging app — ADR-0036. Mobile's are the
  // only client flags left.
  flags.mobilePro = readFlag(
    'apps/mobile/src/lib/subscription.ts',
    /export const PRO_ENABLED\s*=\s*(true|false)/,
  );

  // Mobile photoScan IS a literal again as of 2026-08-07 (ADR-0017). This
  // used to read eas.json, because the flag was
  // `process.env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN !== '0'` and the build profile
  // was the only place the shipped value existed. That read is now actively
  // WRONG: eas.json still carries an inert `EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0`
  // that nothing reads, so trusting it would report "off" for a feature that
  // is on for every user.
  //
  // The flag moved to a hardcoded constant precisely because eas.json is
  // hashed into the EAS Update fingerprint — an env-var flag cannot be changed
  // without a new binary, which makes it useless as a kill switch. If someone
  // ever moves it back, this check has to move back with it.
  flags.mobilePhotoScan = readFlag(
    'apps/mobile/src/lib/features.ts',
    /photoScan:\s*(true|false)/,
  );
  return flags;
}

/**
 * Where user-facing marketing / store / email copy lives.
 *
 * Scoping matters more than coverage here. The app's own i18n bundles
 * legitimately contain Pro, paywall and photo-scan strings: CLAUDE.md keeps
 * deferred features "gated OFF via flags, not deleted", so those keys exist on
 * purpose and are unreachable at runtime. Scanning them would fail by design
 * and the check would be switched off within a week. So only the marketing
 * key prefixes are read, and the gated surfaces (`subscribe`, `upsell`,
 * `photo`, `starter`) are deliberately excluded.
 */
const MARKETING_I18N_PREFIXES = [
  'landing', 'faq', 'vs', 'calcVariants', 'calculator', 'macrosPage', 'transformations',
];

function flattenJson(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    // Recurse into arrays too. Joining them was silently destroying copy:
    // `faq.items` is 12 {q, a} objects, and `[...].join(' ')` turned all of
    // it into "[object Object] [object Object] …" — so every answer on the
    // FAQ page was invisible to the scan, including one promising a Pro tier
    // at a price. An array of strings still flattens fine; it just gets one
    // entry per index instead of one joined line, which reports better anyway.
    if (v && typeof v === 'object') flattenJson(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

/** Fenced code blocks only, for prose docs. In `app-store-metadata.md` the
 *  ``` blocks are the literal paste-ready listing copy; the prose around them
 *  discusses what may NOT be claimed and would match every pattern. */
function fencedBlocks(text) {
  const out = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const start = text.slice(0, m.index).split('\n').length;
    m[1].split('\n').forEach((line, i) => out.push({ line, n: start + i + 1 }));
  }
  return out;
}

/**
 * HTML prose wraps mid-sentence, so a per-line scan splits "Free, no ads, no
 * paywall." across two lines and the negation lands on the wrong one — the
 * first run of this script reported `download.html` promising a paywall for
 * exactly that reason. Tags are stripped and the text re-joined so the unit of
 * analysis is a sentence, which is what the negation guard assumes. The line
 * number is the one the sentence STARTS on.
 */
function htmlSentences(file) {
  const raw = read(file);
  const out = [];
  // Drop <style>/<script> wholesale — CSS braces and JS produce nonsense
  // "sentences" and can contain words like "premium" in a font stack.
  const body = raw
    .replace(/<style[\s\S]*?<\/style>/gi, (m) => '\n'.repeat(m.split('\n').length - 1))
    .replace(/<script[\s\S]*?<\/script>/gi, (m) => '\n'.repeat(m.split('\n').length - 1));

  let buf = '';
  let startLine = 1;
  let line = 1;
  const flush = () => {
    const text = buf.replace(/\s+/g, ' ').trim();
    if (text) out.push({ file, n: startLine, line: text });
    buf = '';
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\n') line++;
    if (ch === '<') {
      // A tag boundary ends a sentence: adjacent elements are separate copy.
      const close = body.indexOf('>', i);
      flush();
      if (close === -1) break;
      for (let j = i; j < close; j++) if (body[j] === '\n') line++;
      i = close;
      startLine = line;
      continue;
    }
    if (!buf.trim()) startLine = line;
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?') flush();
  }
  flush();
  return out;
}

function copySources() {
  const src = [];
  for (const f of gitFiles('public/*.html')) {
    src.push(...htmlSentences(f));
  }
  // …and the SVGs, which carry copy that reaches more people than the pages
  // do. `og-image.svg` is the card rendered on every social share of the site,
  // and it read "Free to start. Pro $3/mo." while nothing was purchasable.
  // Only .html was ever scanned, so it was never looked at.
  for (const f of gitFiles('public/*.svg')) {
    read(f)
      .split('\n')
      .forEach((line, i) => src.push({ file: f, n: i + 1, line }));
  }
  if (has('functions/src/email-templates.ts')) {
    read('functions/src/email-templates.ts')
      .split('\n')
      .forEach((line, i) => src.push({ file: 'functions/src/email-templates.ts', n: i + 1, line }));
  }
  if (has('docs/app-store-metadata.md')) {
    for (const { line, n } of fencedBlocks(read('docs/app-store-metadata.md'))) {
      src.push({ file: 'docs/app-store-metadata.md', n, line });
    }
  }
  // The /vs comparison pages. Highest-intent copy the product has — the file's
  // own header notes comparison traffic converts several times better than
  // top-of-funnel — and it was the one marketing surface this check could not
  // see. It sat advertising "Pro at $3/mo or $24/yr" against a `PRO_ENABLED`
  // that is false on both platforms, and this check passed the whole time,
  // because a scan that misses the file is indistinguishable from a clean one.
  //
  // Only the `us:` fields. A comparison page's whole job is to describe what
  // the competitor charges, so `them: 'Premium is about $80/yr'` and the
  // honest summaries must stay sayable — scanning them would make the check
  // unusable here and it would be turned off, which is worse than not having
  // it. `us:` is where a claim about Ignia lives.
  if (has('src/app/components/vs-page/vs-data.ts')) {
    const vsFile = 'src/app/components/vs-page/vs-data.ts';
    read(vsFile)
      .split('\n')
      .forEach((line, i) => {
        for (const m of line.matchAll(/\bus:\s*'((?:[^'\\]|\\.)*)'/g)) {
          src.push({ file: vsFile, n: i + 1, line: m[1] });
        }
      });
  }
  for (const f of ['src/app/i18n/en.json', 'src/app/i18n/es-PR.json']) {
    if (!has(f)) continue;
    const flat = flattenJson(JSON.parse(read(f)));
    for (const [k, v] of Object.entries(flat)) {
      if (!MARKETING_I18N_PREFIXES.some((p) => k === p || k.startsWith(`${p}.`))) continue;
      src.push({ file: f, n: k, line: v });
    }
  }
  return src;
}

/**
 * Claim patterns, EN + ES. These match the feature being *offered*; a
 * disclaimer that names the same feature to deny it ("no subscription", "sin
 * anuncios, sin versión de pago") is correct copy and must not fail. That is
 * what NEGATION filters, scoped to the sentence the match sits in.
 *
 * Heuristic, and openly so: it trades a small false-negative rate for not
 * crying wolf on the disclaimer-heavy copy this product leads with. It is a
 * tripwire for the specific regression that happened, not a proof.
 */
const CLAIMS = {
  photoScan: [
    /\bphoto[- ]?scan/i,
    /\b(snap|take|scan)\s+(a\s+)?(photo|picture|pic)\b/i,
    /\bphoto\s*(→|->|to)\s*macros/i,
    /\bAI\s+(meal\s+)?photo/i,
    /\bescanea\w*\s+(una\s+)?foto/i,
    /\bfoto\s*(→|->|a)\s*macros/i,
  ],
  pro: [
    /\bpro\s+(tier|plan|version|subscription)/i,
    /\bpremium\b/i,
    /\bfree\s+trial\b/i,
    /\bpaywall\b/i,
    /\bupgrade\s+to\b/i,
    /\bsubscri(be|ption)\b/i,
    /\bsuscripci[oó]n\b/i,
    /\bprueba\s+gratis\b/i,
    /\bversi[oó]n\s+de\s+pago\b/i,
    // A recurring price is a paid tier no matter what it is called, and this
    // is the exact shape that got through: the /vs pages read "Pro at $3/mo
    // or $24/yr" for months and matched not one pattern above, because none
    // of them look for money. Every word-based rule here can be sidestepped
    // by just naming the price.
    // Spanish periods included, or half the copy walks straight past: es-PR
    // writes "$3/mes o $24/año", which an English-only period list misses in
    // exactly the locale nobody re-reads.
    /\$\s?\d+(?:\.\d{2})?\s*(?:\/|\s+per\s+)\s*(?:mo|month|yr|year|mes|a[ñn]o)\b/i,
  ],
};

const NEGATION =
  /\b(no|not|never|without|nothing|none|isn'?t|aren'?t|doesn'?t|don'?t|free of|zero)\b|\bsin\b|\bnunca\b|\bni\b|\bnada\b/i;

function scanCopy(sources, patterns) {
  const hits = [];
  for (const { file, n, line } of sources) {
    for (const re of patterns) {
      const m = line.match(re);
      if (!m) continue;
      // Sentence around the match, so "Free. No subscription." doesn't trip
      // on a neighbouring sentence's negation and vice versa.
      const idx = m.index ?? 0;
      const start = Math.max(0, line.lastIndexOf('.', idx) + 1);
      const endRel = line.indexOf('.', idx + m[0].length);
      const sentence = line.slice(start, endRel === -1 ? line.length : endRel + 1);
      if (NEGATION.test(sentence)) continue;
      hits.push(`${file}:${n} — "${m[0].trim()}" in: ${sentence.trim().slice(0, 110)}`);
      break;
    }
  }
  return hits;
}

function checkCopyVsFlags() {
  const flags = collectFlags();

  const unreadable = Object.entries(flags).filter(([, f]) => f.value === null);
  if (unreadable.length) {
    fail(G1, 'flags are readable', unreadable.map(([k, f]) => `${k}: ${f.why}`).join('; '));
  } else {
    pass(
      G1,
      'flags are readable',
      Object.entries(flags).map(([k, f]) => `${k}=${f.value}`).join(' '),
    );
  }

  const sources = copySources();
  if (!sources.length) {
    fail(G1, 'copy sources found', 'no marketing/store/email copy located — check the globs');
    return;
  }

  const proOff = flags.mobilePro.value === false;
  const photoOff = flags.mobilePhotoScan.value === false;

  for (const [key, on, label] of [
    ['pro', !proOff, 'Pro / paid tier'],
    ['photoScan', !photoOff, 'AI photo-scan'],
  ]) {
    if (on) {
      skip(G1, `copy may mention ${label}`, 'flag is ON for at least one platform');
      continue;
    }
    const hits = scanCopy(sources, CLAIMS[key]);
    if (hits.length) {
      fail(
        G1,
        `copy never promises ${label}`,
        `${hits.length} claim(s) while the flag is off on both platforms:\n      ` +
          hits.slice(0, 12).join('\n      ') +
          (hits.length > 12 ? `\n      …and ${hits.length - 12} more` : ''),
      );
    } else {
      pass(G1, `copy never promises ${label}`, `${sources.length} copy lines scanned`);
    }
  }
}

// ═══ 2. Deployed artifacts match the tree ═══════════════════════════════
const G2 = '2. deployed vs local';

/** Returns { token } | { missing } | { failed, stderr } so the caller can tell
 *  "no gcloud" from "gcloud is there and your login expired". */
function gcloudToken() {
  const res = sh('gcloud', ['auth', 'print-access-token'], { timeout: 60_000 });
  if (res.missing) return { missing: true };
  if (!res.ok) return { failed: true, stderr: res.stderr };
  return { token: res.stdout.trim() };
}

async function checkRulesMatchReleased() {
  const name = 'firestore.rules matches the released ruleset';
  if (!has('firestore.rules')) return fail(G2, name, 'firestore.rules not found');
  const tok = gcloudToken();
  if (tok.missing) return skip(G2, name, 'gcloud is not installed');
  if (tok.failed) {
    return fail(G2, name, `gcloud could not mint a token: ${firstLine(tok.stderr)} — ` +
      'run `gcloud auth application-default login`');
  }
  const token = tok.token;
  // `x-goog-user-project` is required, not optional: a user ADC token carries
  // no quota project, and firebaserules.googleapis.com answers 403
  // SERVICE_DISABLED without it — which reads exactly like "you lack
  // permission" and is not.
  const h = { Authorization: `Bearer ${token}`, 'x-goog-user-project': PROJECT };
  const relRes = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
    { headers: h },
  );
  if (!relRes.ok) {
    return skip(G2, name, `rules API returned ${relRes.status} — insufficient permission?`);
  }
  const rulesetName = (await relRes.json()).rulesetName;
  const rsRes = await fetch(`https://firebaserules.googleapis.com/v1/${rulesetName}`, {
    headers: h,
  });
  if (!rsRes.ok) return skip(G2, name, `ruleset fetch returned ${rsRes.status}`);
  const files = (await rsRes.json()).source?.files ?? [];
  const deployed = (files[0]?.content ?? '').replace(/\r\n/g, '\n').trimEnd();
  const local = read('firestore.rules').replace(/\r\n/g, '\n').trimEnd();
  if (deployed === local) {
    pass(G2, name, `identical to ${rulesetName.split('/').pop()}`);
  } else {
    const dl = deployed.split('\n');
    const ll = local.split('\n');
    const at = ll.findIndex((l, i) => l !== dl[i]);
    fail(
      G2,
      name,
      `local differs from the released ruleset (first difference at line ${at + 1}). ` +
        'Deploy before clients write any new field: firebase deploy --only firestore:rules',
    );
  }
}

/**
 * Has anything been deployed since `functions/src` last changed?
 *
 * `checkDeployedFunctions` below asks whether the right functions EXIST. This
 * asks whether a deploy has happened since the code changed, which is a
 * different question and the one that bit.
 *
 * On 2026-09-04 the live `deleteAccount` revision dated from 2026-08-26 while
 * `milestones` had been added to `USER_SUBCOLLECTIONS` on 2026-08-29. The
 * source was right, the fix was merged, the GDPR parity spec passed — and
 * production still orphaned every deleted account's milestone docs, because
 * nothing had run `firebase deploy --only functions` in between. Both erasure
 * (Art. 17) and export (Art. 20) read that constant, so one stale deploy broke
 * both obligations at once, and 24 source files were adrift by the time anyone
 * looked. There is no CI here (README §CI/CD), so "merged" and "deployed" are
 * two separate facts and only this connects them.
 *
 * **It compares the NEWEST deploy, not each function's own.** Per-function
 * timestamps look obvious and are wrong: deploying from a clean working tree
 * and committing a minute later leaves every function "older" than the commit,
 * which fails on a perfectly current deployment — it did, on the first run of
 * this check. What that costs is a partial deploy: if one function is pushed
 * after a change that affected several, this still passes. Catching that needs
 * a per-function map of transitively imported source files, which is more
 * machinery than the failure justifies. The oldest revision is printed either
 * way, so a lopsided spread is visible even when the check passes.
 */
function checkFunctionsFreshness() {
  const name = 'deployed functions are newer than functions/src';
  const commitRes = sh('git', ['log', '-1', '--format=%cI', '--', 'functions/src']);
  if (!commitRes.ok || !commitRes.stdout.trim()) {
    return skip(G2, name, 'could not read the last functions/src commit');
  }
  const lastCommit = new Date(commitRes.stdout.trim());
  const res = sh('gcloud', [
    'run', 'services', 'list',
    '--region', 'us-central1', '--project', PROJECT,
    '--format=value(metadata.name,status.conditions[0].lastTransitionTime)',
  ], { timeout: 120_000 });
  const out = useOutput(G2, name, res, { skipHint: 'gcloud is not installed' });
  if (out === null) return;
  const deploys = [];
  for (const line of out.split('\n')) {
    const [fn, ts] = line.trim().split(/\s+/);
    if (fn && ts) deploys.push({ fn, at: new Date(ts) });
  }
  if (!deploys.length) return skip(G2, name, 'no Cloud Run services returned');
  const newest = deploys.reduce((a, b) => (b.at > a.at ? b : a));
  const oldest = deploys.reduce((a, b) => (b.at < a.at ? b : a));
  const day = (d) => d.toISOString().slice(0, 10);
  if (newest.at >= lastCommit) {
    pass(
      G2,
      name,
      `${deploys.length} functions; newest deploy ${day(newest.at)} >= last functions/src commit ` +
        `${day(lastCommit)} (oldest revision: ${oldest.fn} ${day(oldest.at)})`,
    );
  } else {
    const days = Math.floor((lastCommit - newest.at) / 86_400_000);
    fail(
      G2,
      name,
      `functions/src changed ${day(lastCommit)} but nothing has been deployed since ` +
        `${day(newest.at)}${days ? ` (${days} day${days === 1 ? '' : 's'} behind)` : ''}. ` +
        'Merged is not deployed — run: firebase deploy --only functions',
    );
  }
}

/** Exported callables/triggers, parsed statically. functions/lib may not be
 *  built, and importing index.ts would need the whole firebase-functions
 *  runtime — so the source is read as text. */
function declaredFunctionNames() {
  const src = read('functions/src/index.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([\s\S]*?)\}\s*from/g)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.match(/\bas\s+([A-Za-z0-9_$]+)/);
      names.add(as ? as[1] : t.split(/\s+/)[0]);
    }
  }
  for (const m of src.matchAll(/export\s+(?:const|(?:async\s+)?function)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(m[1]);
  }
  names.delete('');
  return names;
}

function checkDeployedFunctions() {
  const name = 'deployed functions match functions/src exports';
  if (!has('functions/src/index.ts')) return fail(G2, name, 'functions/src/index.ts not found');
  const res = sh('firebase', ['functions:list', '--json', '--project', PROJECT], {
    timeout: 180_000,
  });
  const out = useOutput(G2, name, res, { skipHint: 'firebase CLI is not installed' });
  if (out === null) return;
  const parsed = parseJsonLoose(out);
  const list = Array.isArray(parsed) ? parsed : parsed?.result;
  if (!Array.isArray(list)) {
    return skip(G2, name, 'firebase returned no parseable function list (logged in?)');
  }
  // Firebase Extensions deploy their own functions into the same project;
  // they are not ours and must not read as drift.
  const deployed = new Set(
    list.map((f) => f.id ?? f.functionName ?? f.name).filter((id) => id && !id.startsWith('ext-')),
  );
  const declared = declaredFunctionNames();
  const missing = [...declared].filter((n) => !deployed.has(n));
  const extra = [...deployed].filter((n) => !declared.has(n));
  if (!missing.length && !extra.length) {
    pass(G2, name, `${deployed.size} function(s) in sync`);
  } else {
    fail(
      G2,
      name,
      [
        missing.length ? `exported but NOT deployed: ${missing.join(', ')}` : '',
        extra.length ? `deployed but not exported (stale — delete them): ${extra.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
}

/**
 * STATUS.md §1 vs App Store Connect.
 *
 * This is the claim that has been wrong the longest and cost the most: several
 * docs called the live app "v1.1.0" while ASC had 1.1.0 in
 * PREPARE_FOR_SUBMISSION with no binary attached, and 1.0 was what users
 * actually had. A version number in prose is not evidence; the store is.
 *
 * Versions are compared numerically, not as strings — ASC says "1.0" where
 * STATUS.md says "1.0.0, build 7", and those are the same release.
 */
function normalizeVersion(v) {
  const parts = String(v).split('.').map((n) => Number(n) || 0);
  while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
  return parts.join('.');
}

const ASC_STATES =
  /\b(READY_FOR_SALE|PREPARE_FOR_SUBMISSION|WAITING_FOR_REVIEW|IN_REVIEW|PENDING_DEVELOPER_RELEASE|REJECTED|DEVELOPER_REJECTED|METADATA_REJECTED|PENDING_APPLE_RELEASE|PROCESSING_FOR_APP_STORE|REPLACED_WITH_NEW_VERSION|REMOVED_FROM_SALE)\b/;

function statusSection(n) {
  const text = read('STATUS.md');
  const start = text.search(new RegExp(`^##\\s*${n}\\.`, 'm'));
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const end = rest.search(/^##\s/m);
  return end === -1 ? rest : rest.slice(0, end);
}

async function checkStatusVsAsc() {
  const name = 'STATUS.md §1 matches App Store Connect';
  if (!has('STATUS.md')) return fail(G2, name, 'STATUS.md not found');
  if (!has('scripts/asc-client.mjs')) return skip(G2, name, 'scripts/asc-client.mjs not found');
  const section = statusSection(1);
  if (section === null) return fail(G2, name, 'no "## 1." section in STATUS.md');

  let api;
  let APP_ID;
  try {
    ({ api, APP_ID } = await import('./asc-client.mjs'));
  } catch (e) {
    return skip(G2, name, `asc-client could not load: ${e.message}`);
  }

  let versions;
  try {
    const r = await api(
      'GET',
      `/v1/apps/${APP_ID}/appStoreVersions?limit=10` +
        '&fields[appStoreVersions]=versionString,appStoreState',
    );
    versions = r.data.map((v) => ({
      version: v.attributes.versionString,
      state: v.attributes.appStoreState,
    }));
  } catch (e) {
    // A missing .p8, an unset issuer id or a 401 are all "no credentials
    // here", which is a SKIP. Only a successful read can prove drift.
    return skip(G2, name, `ASC unreachable: ${String(e.message).split('\n')[0].slice(0, 120)}`);
  }
  if (!versions.length) return skip(G2, name, 'ASC returned no versions');

  const byVersion = new Map(versions.map((v) => [normalizeVersion(v.version), v.state]));
  const problems = [];

  // Every "<version> … <STATE>" pair asserted in §1 must match ASC.
  for (const line of section.split('\n')) {
    const st = line.match(ASC_STATES);
    if (!st) continue;
    const ver = line.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
    if (!ver) continue;
    const key = normalizeVersion(ver[1]);
    const actual = byVersion.get(key);
    if (!actual) problems.push(`§1 names version ${ver[1]}, which ASC does not have`);
    else if (actual !== st[1]) {
      problems.push(`§1 says ${ver[1]} is ${st[1]}, ASC says ${actual}`);
    }
  }

  // …and whatever ASC actually sells must be the version §1 calls live.
  const liveAsc = versions.find((v) => v.state === 'READY_FOR_SALE');
  if (liveAsc) {
    const cited = [...section.matchAll(/\b(\d+\.\d+(?:\.\d+)?)\b/g)].map((m) =>
      normalizeVersion(m[1]),
    );
    if (!cited.includes(normalizeVersion(liveAsc.version))) {
      problems.push(
        `ASC has ${liveAsc.version} READY_FOR_SALE, but §1 never mentions that version`,
      );
    }
  }

  if (problems.length) fail(G2, name, problems.join(' · '));
  else {
    pass(G2, name, versions.map((v) => `${v.version}=${v.state}`).join(' '));
  }
}

// ═══ 3. Free-tier ceilings ══════════════════════════════════════════════
const G3 = '3. free-tier ceilings';
const MAX_SCHEDULER_JOBS = 3;
const MAX_SECRET_VERSIONS = 6;
/**
 * Active versions this project has DECIDED to carry over the free tier.
 *
 * The free tier is 6 and the honest floor is 7, re-audited 2026-08-09 after
 * `USDA_FDC_API_KEY` was retired (nothing had read it since ADR-0018 bundled
 * the database; the binding was stale config on `searchFoods` and
 * `getFoodDetail`, and both booted fine without it). Every remaining secret
 * holds exactly one live version and each is bound to something real —
 * the Apple trio is required for Sign in with Apple account deletion, Gemini
 * backs photo-scan + coach, Resend sends mail, and Oura's OAuth needs its
 * client secret. The two `ext-firestore-stripe-payments-*` secrets were
 * RETIRED 2026-08-31 with the extension itself (owner's call: any future
 * subscriptions go through Apple/Google IAP, so the Stripe path will never
 * be re-enabled — see CHANGELOG). That put the count AT the free tier.
 *
 * So the check no longer fails on a state that has been reviewed and accepted
 * — a permanently-red check is one people learn to ignore, and this one was
 * red for weeks. It now fails on GROWTH past the accepted floor, which is the
 * actual risk the free tier poses here (forgotten versions, not traffic), and
 * the cost of the overage stays printed on every run so it never goes quiet.
 *
 * Lower this the day a secret is genuinely retired. Raising it should take an
 * argument, not a keystroke.
 *
 * Raised 7 -> 8 on 2026-08-24 for OURA_CLIENT_SECRET. The argument, since the
 * line above demands one: Oura's Cloud API is OAuth2-only (Personal Access
 * Tokens were deprecated in December 2025), so a client secret exists whether
 * or not we like it, and it CANNOT live in the mobile bundle — anyone can unzip
 * the app and read it. Secret Manager is the only place it can go. Cost is one
 * more version at ~$0.06/mo, printed on every run.
 *
 * This also contradicts ADR-0026, which chose the OS health store precisely to
 * avoid this secret. That was an owner decision taken on 2026-08-24 after the
 * health path had still never imported a real record; the ADR carries an
 * amendment saying so.
 *
 * Lowered 8 -> 6 on 2026-08-31: the dormant Stripe extension and its two
 * secrets were retired (owner's call — future subscriptions would be
 * Apple/Google IAP, never Stripe), so the count sits exactly at the free
 * tier and Secret Manager bills $0.00. Any growth past 6 is billable and
 * fails this check until argued for here.
 */
const ACCEPTED_SECRET_VERSIONS = 6;

function checkSchedulerJobs() {
  const name = `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`;
  const res = sh('gcloud', [
    'scheduler', 'jobs', 'list', '--project', PROJECT,
    '--location', 'us-central1', '--format=json',
  ]);
  const out = useOutput(G3, name, res, { skipHint: 'gcloud is not installed' });
  if (out === null) return;
  const jobs = parseJsonLoose(out);
  if (!Array.isArray(jobs)) return skip(G3, name, 'gcloud returned no parseable job list');
  const ids = jobs.map((j) => (j.name ?? '').split('/').pop());
  if (jobs.length <= MAX_SCHEDULER_JOBS) {
    pass(G3, name, `${jobs.length}/${MAX_SCHEDULER_JOBS} — ${ids.join(', ')}`);
  } else {
    fail(
      G3,
      name,
      `${jobs.length} jobs, free tier is ${MAX_SCHEDULER_JOBS}: ${ids.join(', ')}. ` +
        'Fold recurring work into functions/src/hourly-tasks.ts instead of adding onSchedule.',
    );
  }
}

/**
 * The cert Google Play actually ships is registered in Firebase.
 *
 * This exists because on 2026-08-05 Google Sign-In was broken for 100% of Play
 * installs for three days, twice, and no test in this repo could have caught
 * it — the defect lived entirely in cloud config. Android authorizes a caller
 * by *package name + signing certificate*. Play re-signs every AAB, so the cert
 * a user's device presents is one Google holds, not the upload key. Register
 * the wrong one and Play Services rejects the call with DEVELOPER_ERROR before
 * Firebase Auth is ever reached.
 *
 * The trap that cost the second attempt: the Play Console leads with the key it
 * will use for your NEXT upload, and says nothing about which key signed an
 * existing release. Registering the fingerprint the console shows first was a
 * no-op — the live build was signed by the *previous* key. So this check does
 * NOT read the console's headline key. It asks `generatedApks/{versionCode}`
 * which certificate Play actually generated the shipping APKs with, per live
 * track, and asserts that exact hash is on the Firebase app.
 *
 * Compares SHA-256 because that is what the androidpublisher API returns;
 * Firebase holds SHA-1 for OAuth and SHA-256 for Play Integrity, and both must
 * be present for a cert that ships.
 */
async function checkPlaySigningCerts() {
  const name = 'every cert Play ships is registered in Firebase';
  const keyPath = 'apps/mobile/credentials/play-service-account.json';
  if (!has(keyPath)) {
    return skip(G3, name, `${keyPath} not found (see CLAUDE.local.md)`);
  }

  // Firebase side first: it needs no Play credentials, so a failure here is
  // unambiguous rather than "one of two clouds said no".
  const shaRes = sh('npx', [
    'firebase', 'apps:android:sha:list', ANDROID_APP_ID, '--project', PROJECT, '--json',
  ]);
  const shaOut = useOutput(G3, name, shaRes, { skipHint: 'firebase CLI is not installed' });
  if (shaOut === null) return;
  const shaJson = parseJsonLoose(shaOut);
  const registered = new Set(
    (shaJson?.result ?? [])
      .map((c) => String(c.shaHash ?? '').toLowerCase().replace(/:/g, ''))
      .filter(Boolean),
  );
  if (!registered.size) {
    return skip(G3, name, 'firebase returned no parseable SHA list (`firebase login`?)');
  }

  let JWT;
  try {
    ({ JWT } = await import('google-auth-library'));
  } catch {
    return skip(G3, name, 'google-auth-library not installed');
  }

  const key = JSON.parse(read(keyPath));
  const client = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE}`;

  let tracks;
  try {
    const edit = await client.request({ url: `${base}/edits`, method: 'POST' });
    const editId = edit.data.id;
    try {
      const res = await client.request({ url: `${base}/edits/${editId}/tracks` });
      tracks = res.data.tracks ?? [];
    } finally {
      await client.request({ url: `${base}/edits/${editId}`, method: 'DELETE' }).catch(() => {});
    }
  } catch (e) {
    return skip(G3, name, `androidpublisher refused the request: ${e.message}`);
  }

  // Every versionCode currently rolled out on any track — production and the
  // testing tracks alike. A tester hitting DEVELOPER_ERROR on alpha is the same
  // outage as a user hitting it on production; only the blast radius differs.
  const live = [];
  for (const t of tracks) {
    for (const r of t.releases ?? []) {
      if (r.status === 'draft') continue;
      for (const vc of r.versionCodes ?? []) live.push({ track: t.track, vc });
    }
  }
  if (!live.length) return skip(G3, name, 'no rolled-out release on any track');

  const problems = [];
  const seen = [];
  for (const { track, vc } of live) {
    let groups;
    try {
      const res = await client.request({ url: `${base}/generatedApks/${vc}` });
      groups = res.data.generatedApks ?? [];
    } catch (e) {
      problems.push(`${track} vc ${vc}: could not read generatedApks (${e.message})`);
      continue;
    }
    for (const g of groups) {
      const hash = String(g.certificateSha256Hash ?? '').toLowerCase().replace(/:/g, '');
      if (!hash) continue;
      seen.push(`${track} vc ${vc} → ${hash.slice(0, 12)}…`);
      if (!registered.has(hash)) {
        problems.push(
          `${track} vc ${vc} ships APKs signed by ${hash} — NOT registered on the Firebase app. ` +
            'Google Sign-In returns DEVELOPER_ERROR for every install of it. Fix: ' +
            `npx firebase apps:android:sha:create ${ANDROID_APP_ID} <sha> --project ${PROJECT}`,
        );
      }
    }
  }

  if (problems.length) fail(G3, name, problems.join(' · '));
  else pass(G3, name, `${seen.length} shipping cert(s) all registered — ${seen.join(', ')}`);
}

/**
 * `public/app-version.json` is what tells an installed Android app that a newer
 * binary exists. Nothing in the app derives it — it is a number written into a
 * file and deployed to hosting — so the moment it lags what Play ships, every
 * older install is told it is up to date and the update banner never fires.
 *
 * That failure is invisible from inside the app: no error, no warning, and a
 * screen that looks exactly like a user who genuinely is current. This check is
 * the only thing standing between "we shipped vc N" and "nobody was told", which
 * is why it FAILS rather than warns.
 *
 * It compares against the live androidpublisher tracks, the same authority the
 * signing-cert check above uses.
 */
async function checkAppVersionManifest() {
  const name = 'app-version.json matches what Play ships';
  const keyPath = 'apps/mobile/credentials/play-service-account.json';
  if (!has(keyPath)) return skip(G3, name, `${keyPath} not found (see CLAUDE.local.md)`);
  if (!has('public/app-version.json')) {
    return fail(G3, name, 'public/app-version.json is missing — the update banner has nothing to read');
  }

  let sync;
  try {
    sync = await import('./app-version-sync.mjs');
  } catch (e) {
    return skip(G3, name, `could not load app-version-sync.mjs: ${e.message}`);
  }

  const declared = sync.readManifest().android?.latestVersionCode ?? 0;

  let live;
  try {
    live = await sync.readLivePlayVersionCode();
  } catch (e) {
    return skip(G3, name, `androidpublisher refused the request: ${e.message}`);
  }
  if (!live.versionCode) return skip(G3, name, 'no rolled-out release on any track');

  if (declared === live.versionCode) {
    return pass(G3, name, `android.latestVersionCode = ${declared} (${live.tracks.join(', ')})`);
  }
  if (declared > live.versionCode) {
    // Harmless to users (nobody is running something newer than Play has), but
    // it means the file was bumped for a release that never rolled out.
    return fail(
      G3,
      name,
      `app-version.json claims ${declared} but Play's newest rolled-out build is ${live.versionCode}. ` +
        'Anyone who taps the banner lands on a store page with nothing newer to install.',
    );
  }
  fail(
    G3,
    name,
    `app-version.json says ${declared}, Play is shipping ${live.versionCode} (${live.tracks.join(', ')}). ` +
      `Every install below ${live.versionCode} is being told it is up to date and will never see the ` +
      'update banner. Fix: node scripts/app-version-sync.mjs && firebase deploy --only hosting',
  );
}

/**
 * The same guard for iOS, which was hand-held until 2026-08-15.
 *
 * The iOS half has a failure mode Android's does not: the number must name the
 * live APP STORE build, and TestFlight always runs ahead, so the most visible
 * build number is almost always the wrong one to write. Pointing a store user
 * at a build they cannot install is worse than saying nothing.
 *
 * `READY_FOR_SALE` is the authority because it is definitionally what the public
 * can download. A value of 0 disables the prompt on purpose and is not drift.
 */
async function checkAppVersionManifestIos() {
  const name = 'app-version.json matches what the App Store ships';
  if (!has('public/app-version.json')) {
    return fail(G3, name, 'public/app-version.json is missing');
  }

  let sync;
  try {
    sync = await import('./app-version-sync.mjs');
  } catch (e) {
    return skip(G3, name, `could not load app-version-sync.mjs: ${e.message}`);
  }

  const declared = sync.readManifest().ios?.latestBuild ?? 0;

  let live;
  try {
    live = await sync.readLiveAppStoreBuild();
  } catch (e) {
    return skip(G3, name, `App Store Connect refused the request: ${e.message}`);
  }
  if (!live) return skip(G3, name, 'no READY_FOR_SALE version on the App Store');

  if (declared === 0) {
    return pass(G3, name, `ios prompt is disabled on purpose (live is ${live.version} build ${live.build})`);
  }
  if (declared === live.build) {
    return pass(G3, name, `ios.latestBuild = ${declared} (${live.version} build ${live.build})`);
  }
  if (declared > live.build) {
    return fail(
      G3,
      name,
      `app-version.json claims build ${declared} but the App Store is serving ${live.version} build ${live.build}. ` +
        'That is almost certainly a TestFlight build number — anyone who taps the banner lands on a store ' +
        'page with nothing newer to install.',
    );
  }
  fail(
    G3,
    name,
    `app-version.json says build ${declared}, the App Store is serving ${live.version} build ${live.build}. ` +
      'Every install below that is being told it is up to date. ' +
      'Fix: node scripts/app-version-sync.mjs && npm run build && firebase deploy --only hosting',
  );
}

function checkSecretVersions() {
  const name = `active secret versions <= ${ACCEPTED_SECRET_VERSIONS} (free tier ${MAX_SECRET_VERSIONS})`;
  const listRes = sh('gcloud', ['secrets', 'list', '--project', PROJECT, '--format=json']);
  const listOut = useOutput(G3, name, listRes, { skipHint: 'gcloud is not installed' });
  if (listOut === null) return;
  const secrets = parseJsonLoose(listOut);
  if (!Array.isArray(secrets)) return skip(G3, name, 'gcloud returned no parseable secret list');

  let total = 0;
  const per = [];
  for (const s of secrets) {
    const id = (s.name ?? '').split('/').pop();
    const vRes = sh('gcloud', [
      'secrets', 'versions', 'list', id, '--project', PROJECT, '--format=json',
    ]);
    // A per-secret failure would silently undercount and turn a real overage
    // into a pass, so it fails the check rather than skipping the secret.
    if (!vRes.ok) {
      return fail(G3, name, `could not list versions of ${id}: ${firstLine(vRes.stderr)}`);
    }
    const versions = parseJsonLoose(vRes.stdout);
    if (!Array.isArray(versions)) continue;
    // --format=json reports state as ENABLED; the `--filter` flag sees the
    // lowercased display value and silently matches nothing, which is why
    // this counts in JS rather than filtering server-side.
    const active = versions.filter((v) => String(v.state).toUpperCase() === 'ENABLED').length;
    if (active) per.push(`${id}=${active}`);
    total += active;
  }
  if (total <= MAX_SECRET_VERSIONS) {
    pass(G3, name, `${total}/${MAX_SECRET_VERSIONS} active — ${per.join(', ') || 'none'}`);
  } else if (total <= ACCEPTED_SECRET_VERSIONS) {
    // Over the free tier, but at or under the reviewed floor. Say what it
    // costs every single run — an accepted overage that stops being visible
    // is just an unnoticed bill.
    const over = total - MAX_SECRET_VERSIONS;
    pass(
      G3,
      name,
      `${total} active — ${over} over the ${MAX_SECRET_VERSIONS} free tier, accepted ` +
        `(~$${(over * 0.06).toFixed(2)}/mo). Floor is ${ACCEPTED_SECRET_VERSIONS}: ${per.join(', ')}. ` +
        'Under it only by retiring the dormant Stripe extension — a product call.',
    );
  } else {
    // Two very different causes, and the wrong advice is worse than none:
    // rotation residue is free to clean up, whereas N distinct secrets each
    // holding one live version means the project genuinely needs more than the
    // free tier and someone has to decide to consolidate or to pay.
    const residue = per.filter((p) => Number(p.split('=')[1]) > 1);
    fail(
      G3,
      name,
      `${total} active versions — ABOVE the accepted floor of ${ACCEPTED_SECRET_VERSIONS} (free tier ${MAX_SECRET_VERSIONS}): ${per.join(', ')}. ` +
        (residue.length
          ? `Rotation residue — destroy the superseded ones: ${residue.join(', ')} ` +
            '(gcloud secrets versions destroy <n> --secret=<name>). ' +
            'The Stripe extension pins versions/latest, so destroy only older versions.'
          : 'Every secret holds exactly one live version, so this is NOT rotation residue and ' +
            'nothing here is safe to destroy — each one is in use. Going under the cap means ' +
            'retiring a secret (the dormant Stripe extension holds 2), otherwise this is a ' +
            'deliberate ~$0.06/version/month over the free tier.'),
    );
  }
}

/**
 * STATUS.md §3's iOS build-quota line vs what EAS reports.
 *
 * The number was carried in prose as a hand-copied observation and was acted
 * on days after it stopped being true. `eas account:usage` is authoritative
 * and easy to miss — it does not appear in `eas-cli --help`.
 *
 * Format drift SKIPs rather than fails: this parses a third-party CLI's JSON
 * and a sentence written by a human, and neither is a contract. A doctor that
 * cries wolf when Expo renames a field gets muted.
 */
const QUOTA_DOC = 'docs/build-infrastructure.md';

function checkEasQuota() {
  const name = `${QUOTA_DOC} matches the EAS iOS quota`;
  if (!has(QUOTA_DOC)) return fail(G3, name, `${QUOTA_DOC} not found`);

  // e.g. "iOS 8/15" — the claim being audited. The figure moved out of
  // STATUS.md on 2026-08-15 with the rest of the build tooling; this is
  // repointed rather than deleted, because a guard that silently stops finding
  // its input is worse than no guard — it reports SKIP and reads as healthy.
  const claim = read(QUOTA_DOC).match(/iOS[^.\n]*?\b(\d+)\s*\/\s*(\d+)\b/i);
  if (!claim) return skip(G3, name, `${QUOTA_DOC} states no parseable "iOS <used>/<limit>" figure`);

  const res = sh('npx', ['eas-cli', 'account:usage', 'gabandres', '--non-interactive'], {
    timeout: 240_000,
  });
  if (res.missing) return skip(G3, name, 'eas-cli is not installed');
  if (!res.ok) return skip(G3, name, `eas account:usage failed: ${firstLine(res.stderr)}`);

  const usage = parseJsonLoose(res.stdout);
  const ios = usage?.builds?.ios?.plan;
  if (!ios || typeof ios.used !== 'number' || typeof ios.limit !== 'number') {
    return skip(G3, name, 'could not parse builds.ios.plan from eas account:usage output');
  }

  const [, used, limit] = claim;
  if (Number(used) === ios.used && Number(limit) === ios.limit) {
    const period = usage?.account?.billingPeriod?.end;
    pass(G3, name, `doc and EAS agree: iOS ${ios.used}/${ios.limit}` + (period ? ` · resets ${String(period).slice(0, 10)}` : ''));
  } else {
    fail(
      G3,
      name,
      `${QUOTA_DOC} says iOS ${used}/${limit}, EAS reports ${ios.used}/${ios.limit}` +
        (usage?.account?.billingPeriod?.end
          ? ` (period ends ${String(usage.account.billingPeriod.end).slice(0, 10)})`
          : ''),
    );
  }
}

// ═══ 4. Locale key parity ═══════════════════════════════════════════════
/**
 * Is the Sentry auth token actually good?
 *
 * On 2026-08-03 this cost an Android build. `@sentry/react-native`'s Gradle
 * integration uploads source maps and native symbols as a **build task**, and
 * a bad token fails that task, which fails the whole build:
 *
 *     sentry reported an error: Invalid token (http status: 401)
 *     > Task :app:createBundleReleaseJsAndAssets_SentryUpload_… FAILED
 *
 * The build sat in the free-tier queue for **two hours** before a worker
 * picked it up, ran Gradle for five minutes, and died on an HTTP 401. One of
 * the 15 monthly Android builds, spent on an auth failure that is knowable in
 * one request before anything is queued.
 *
 * Two properties make this worth a check rather than a habit. It is
 * **invisible until the build runs** — nothing local reads the token — and it
 * **breaks by sitting still**: rotating or revoking the token in Sentry
 * changes nothing here until the next build. There are three copies (this
 * machine's `.env.local`, both EAS environments, the GitHub Actions secret)
 * and no mechanism keeps them in step.
 *
 * This checks only the copy on this machine, which is the one a human is most
 * likely to have updated last. It cannot read the EAS or GitHub copies —
 * secrets are write-only there by design — so a PASS means "the token you have
 * is good", not "every copy is good". Re-set all three together; that is the
 * only guarantee available.
 */
async function checkSentryToken() {
  const name = 'SENTRY_AUTH_TOKEN authenticates';
  const org = process.env.SENTRY_ORG || 'gabriel-bermudez';

  if (!has('.env.local')) return skip(G3, name, 'no .env.local on this machine');
  try {
    process.loadEnvFile(resolve(root, '.env.local'));
  } catch (e) {
    return skip(G3, name, `could not read .env.local: ${e.message}`);
  }

  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) return skip(G3, name, 'SENTRY_AUTH_TOKEN is not set in .env.local');

  let res;
  try {
    res = await fetch(`https://sentry.io/api/0/organizations/${org}/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    return skip(G3, name, `could not reach sentry.io: ${e.message}`);
  }

  if (res.ok) {
    return pass(G3, name, `token is valid for org ${org} (EAS + GitHub copies are unreadable — re-set all three together)`);
  }
  if (res.status === 401) {
    return fail(
      G3,
      name,
      `sentry.io rejects the token in .env.local (401). A Gradle/EAS build WILL fail on ` +
        `SentryUpload after its full queue wait. Fix .env.local, then re-set both EAS ` +
        `environments (eas env:create --environment production|preview --name SENTRY_AUTH_TOKEN ` +
        `--visibility secret --force) and the GitHub secret (gh secret set SENTRY_AUTH_TOKEN).`,
    );
  }
  if (res.status === 403) {
    return fail(G3, name, `token authenticates but lacks scope for org ${org} (403) — needs org:read + project:releases`);
  }
  return skip(G3, name, `unexpected HTTP ${res.status} from sentry.io`);
}

const G4 = '4. i18n key parity';

function diffKeys(group, name, a, b, labelA, labelB) {
  const onlyA = [...a].filter((k) => !b.has(k));
  const onlyB = [...b].filter((k) => !a.has(k));
  if (!onlyA.length && !onlyB.length) {
    pass(group, name, `${a.size} keys, identical`);
    return;
  }
  const show = (arr) => arr.slice(0, 10).join(', ') + (arr.length > 10 ? ` …+${arr.length - 10}` : '');
  fail(
    group,
    name,
    [
      onlyA.length ? `only in ${labelA} (${onlyA.length}): ${show(onlyA)}` : '',
      onlyB.length ? `only in ${labelB} (${onlyB.length}): ${show(onlyB)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
  );
}

/**
 * Which locales to check, discovered from the FILES rather than listed here.
 *
 * A hardcoded pair is what made adding Portuguese a ten-file change: this
 * check said "en vs es-PR" and would have passed, silently, on a repo whose
 * third language was half-written. Globbing the directory means a fourth
 * language is covered the day its file lands, with no edit here.
 */
function localeFiles(dir, pattern) {
  if (!existsSync(resolve(root, dir))) return [];
  return readdirSync(resolve(root, dir))
    .filter((f) => pattern.test(f) && !/^en\./.test(f))
    .sort();
}

function checkWebI18n() {
  const name = 'web i18n locales vs en.json';
  const en = 'src/app/i18n/en.json';
  if (!has(en)) return fail(G4, name, 'src/app/i18n/en.json not found');
  const enKeys = new Set(Object.keys(flattenJson(JSON.parse(read(en)))));
  const others = localeFiles('src/app/i18n', /^[a-z]{2}(-[A-Za-z]+)?\.json$/);
  if (!others.length) return fail(G4, name, 'no non-English locale files found');
  for (const f of others) {
    const tag = f.replace(/\.json$/, '');
    diffKeys(
      G4,
      `web en.json vs ${f}`,
      enKeys,
      new Set(Object.keys(flattenJson(JSON.parse(read(`src/app/i18n/${f}`))))),
      'en',
      tag,
    );
  }
}

/** Mobile bundles are flat `'key.name': 'value'` object literals in .ts, so
 *  the keys are read with a regex — importing them would need the RN runtime. */
function mobileKeys(file) {
  const keys = new Set();
  for (const m of read(file).matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)) keys.add(m[1]);
  return keys;
}

function checkMobileI18n() {
  const name = 'mobile i18n locales vs en.ts';
  const en = 'apps/mobile/src/i18n/en.ts';
  if (!has(en)) return fail(G4, name, 'apps/mobile/src/i18n/en.ts not found');
  const enKeys = mobileKeys(en);
  const others = localeFiles('apps/mobile/src/i18n', /^[a-z]{2}-[A-Za-z]+\.ts$/);
  if (!others.length) return fail(G4, name, 'no non-English locale files found');
  for (const f of others) {
    diffKeys(
      G4,
      `mobile en.ts vs ${f}`,
      enKeys,
      mobileKeys(`apps/mobile/src/i18n/${f}`),
      'en',
      f.replace(/\.ts$/, ''),
    );
  }

  // Three lists must agree, and each can drift on its own:
  //   packages/core/src/locales.ts  — the shared tag list (both frontends)
  //   apps/mobile/src/i18n/DICTS    — which tags this app has strings for
  //   <tag>.ts on disk              — the strings themselves
  // A dict file with no registry entry renders for nobody while reading in a
  // diff as "Portuguese shipped"; a core tag with no dict shows a language in
  // the settings picker that paints an entirely English app.
  const core = 'packages/core/src/locales.ts';
  const reg = 'apps/mobile/src/i18n/registry.ts';
  if (!has(core) || !has(reg)) return fail(G4, 'mobile locale registry', 'locales.ts or registry.ts not found');

  const coreTags = new Set(
    [...read(core).matchAll(/\{\s*tag:\s*'([^']+)'/g)].map((m) => m[1]),
  );
  const dictBlock = read(reg).match(/const DICTS = \{([\s\S]*?)\n\}/);
  const dictTags = new Set(
    dictBlock
      ? [...dictBlock[1].matchAll(/^\s*'?([A-Za-z-]+)'?\s*[,:]/gm)].map((m) => m[1])
      : [],
  );
  const onDisk = new Set(['en', ...others.map((f) => f.replace(/\.ts$/, ''))]);

  const problems = [
    [...dictTags].filter((t) => !coreTags.has(t)).map((t) => `${t}: in DICTS but not in packages/core`),
    [...coreTags].filter((t) => !dictTags.has(t)).map((t) => `${t}: in packages/core but has no dict`),
    [...dictTags].filter((t) => !onDisk.has(t)).map((t) => `${t}: in DICTS but no <tag>.ts file`),
    [...onDisk].filter((t) => !dictTags.has(t)).map((t) => `${t}: has a file but is not in DICTS`),
  ].flat();

  if (problems.length) {
    fail(G4, 'mobile locale registry', problems.join(' · '));
  } else {
    pass(
      G4,
      'mobile locale registry',
      `${coreTags.size} locales — packages/core, DICTS and the files on disk agree`,
    );
  }
}


// ═══ 5. STATUS.md §3 vs open issues ═════════════════════════════════════
const G5 = '5. STATUS.md vs issue tracker';

function checkStatusVsIssues() {
  const name = 'STATUS.md §3 matches open issues';
  if (!has('STATUS.md')) return fail(G5, name, 'STATUS.md not found');
  const section = statusSection(3);
  if (section === null) return fail(G5, name, 'no "## 3." section in STATUS.md');

  const res = sh('gh', [
    'issue', 'list', '--state', 'open', '--limit', '200',
    '--json', 'number,title,labels',
  ]);
  const out = useOutput(G5, name, res, { skipHint: 'gh CLI is not installed' });
  if (out === null) return;
  const open = parseJsonLoose(out);
  if (!Array.isArray(open)) {
    return skip(G5, name, 'gh returned no parseable issue list (`gh auth login`?)');
  }
  const openNums = new Set(open.map((i) => i.number));
  const cited = [...new Set([...section.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];

  const stale = cited.filter((n) => !openNums.has(n));

  // Maps (`wayfinder:map`) are containers for tasks, not work items — §3 is a
  // table of what is blocked on what, so requiring every open map to appear
  // there would report noise forever. Tasks must appear.
  const uncited = open
    .filter((i) => i.labels?.some((l) => l.name === 'wayfinder:task'))
    .filter((i) => !read('STATUS.md').includes(`#${i.number}`))
    .map((i) => `#${i.number} ${i.title}`);

  if (!stale.length && !uncited.length) {
    pass(G5, name, `${cited.length} cited, all open; every open task is listed`);
  } else {
    fail(
      G5,
      name,
      [
        stale.length ? `cited in §3 but NOT open (closed or missing): ${stale.map((n) => `#${n}`).join(', ')}` : '',
        uncited.length ? `open task(s) absent from STATUS.md: ${uncited.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
}

// ═══ 6. Markdown hygiene ════════════════════════════════════════════════
const G6 = '6. markdown hygiene';

function checkNoCorrectionHeadings() {
  const name = 'no CORRECTION headings';
  const bad = [];
  for (const f of gitFiles('*.md')) {
    read(f).split('\n').forEach((line, i) => {
      // The marker form only: a heading that OPENS with "CORRECTION", which is
      // how a patched-in-place plan doc announces itself. Matching the word
      // anywhere in a heading is too broad — it flagged "Trends correction
      // card", a feature name, on the first run.
      if (/^#{1,6}\s+(?:\*\*)?CORRECTIONS?\b/.test(line.trim())) {
        bad.push(`${f}:${i + 1} — ${line.trim()}`);
      }
    });
  }
  // Only headings. A bold "**Correction 2 — …**" inside a doc that records
  // what an external system actually allowed (app-store-metadata.md) is a
  // legitimate finding log; a CORRECTION *section* is the smell — it means
  // the document beneath it is wrong and was patched rather than rewritten.
  if (bad.length) fail(G6, name, bad.join('\n      '));
  else pass(G6, name, `${gitFiles('*.md').length} markdown files scanned`);
}

function checkNoShippedPlanDocs() {
  const name = 'no *_PLAN.md for work already in CHANGELOG.md';
  if (!has('CHANGELOG.md')) return skip(G6, name, 'CHANGELOG.md not found');
  const changelog = read('CHANGELOG.md').toLowerCase();
  const bad = [];
  for (const f of gitFiles('*_PLAN.md')) {
    const feature = basename(f).replace(/_PLAN\.md$/i, '').replace(/_/g, ' ').toLowerCase();
    if (!feature) continue;
    const hits = (changelog.match(new RegExp(`\\b${feature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
    if (hits) bad.push(`${f} — CHANGELOG.md mentions "${feature}" ${hits}×`);
  }
  if (bad.length) {
    fail(
      G6,
      name,
      bad.join('; ') +
        '. A plan document is deleted the day its work ships: outcome to CHANGELOG.md, ' +
        'reasoning to docs/adr/, current state to STATUS.md. If the file is now a design ' +
        'or QA reference rather than a plan, rename it off _PLAN.md.',
    );
  } else {
    pass(G6, name, `${gitFiles('*_PLAN.md').length} plan doc(s)`);
  }
}

function checkRelativeMarkdownLinks() {
  const name = 'every relative .md link resolves';
  const broken = [];
  for (const f of gitFiles('*.md')) {
    const dir = dirname(resolve(root, f));
    const text = read(f);
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      let target = m[1].trim();
      if (/^(https?:|mailto:|tel:|#|<)/i.test(target)) continue;
      target = target.replace(/[#?].*$/, '');
      if (!target) continue;
      try {
        target = decodeURIComponent(target);
      } catch {
        /* leave as-is */
      }
      if (!/\.md$/i.test(target)) continue;
      const abs = target.startsWith('/') ? resolve(root, `.${target}`) : resolve(dir, target);
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        const line = text.slice(0, m.index).split('\n').length;
        broken.push(`${f}:${line} → ${m[1]}`);
      }
    }
  }
  if (broken.length) fail(G6, name, broken.join('\n      '));
  else pass(G6, name, 'all relative .md targets exist');
}

/**
 * The bundled food index and the ranking fixture are GENERATED artifacts, and
 * both fail silently when they go stale.
 *
 * `apps/mobile/assets/food-index.json` is compacted from
 * `functions/data/usda-foods.json`. Re-ingest the dataset without rebuilding it
 * and the server searches the new database while every phone searches the old
 * one — no error, no warning, just two different answers to the same query.
 *
 * `packages/core/src/__fixtures__/usda-search-golden.json` pins the ranking
 * that `functions/src/usda-db.ts` and `packages/core/src/usda-search.ts` must
 * both reproduce; it is the only thing stopping those two hand-mirrored copies
 * from drifting. Its `--check` runs the SERVER implementation, so it needs
 * `functions/lib` built and skips rather than fails when it is not.
 */
function checkGeneratedFoodArtifacts() {
  const idxName = 'bundled food index matches the USDA ingest';
  const idx = sh('node', ['scripts/build-food-index.mjs', '--check']);
  if (idx.missing) skip(G2, idxName, 'node is not installed');
  else if (!idx.ok) fail(G2, idxName, firstLine(idx.stderr) + ' — run: node scripts/build-food-index.mjs');
  else pass(G2, idxName, 'compact index is current');

  const goldName = 'food-search ranking fixture matches the server';
  if (!existsSync(resolve(root, 'functions/lib/usda-db.js'))) {
    skip(G2, goldName, 'functions/lib not built (npm --prefix functions run build)');
    return;
  }
  const gold = sh('node', ['scripts/build-food-golden.mjs', '--check']);
  if (gold.missing) skip(G2, goldName, 'node is not installed');
  else if (!gold.ok)
    fail(
      G2,
      goldName,
      firstLine(gold.stderr) +
        ' — the two copies of the ranking have drifted. Read the diff BEFORE regenerating: ' +
        'regenerating makes the drift permanent.',
    );
  else pass(G2, goldName, firstLine(gold.stdout ?? ''));
}

// ═══ Run ════════════════════════════════════════════════════════════════
guard(G1, 'copy vs flags', checkCopyVsFlags);

if (NO_CLOUD) {
  skip(G2, 'firestore.rules matches the released ruleset', '--no-cloud');
  skip(G2, 'deployed functions match functions/src exports', '--no-cloud');
  skip(G2, 'STATUS.md §1 matches App Store Connect', '--no-cloud');
  // Local, no network: still run under --no-cloud.
  guard(G2, 'generated food artifacts', checkGeneratedFoodArtifacts);
  skip(G3, `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`, '--no-cloud');
  skip(G3, `active secret versions <= ${ACCEPTED_SECRET_VERSIONS} (free tier ${MAX_SECRET_VERSIONS})`, '--no-cloud');
  skip(G3, `${QUOTA_DOC} matches the EAS iOS quota`, '--no-cloud');
  skip(G3, 'SENTRY_AUTH_TOKEN authenticates', '--no-cloud');
  skip(G3, 'app-version.json matches what Play ships', '--no-cloud');
  skip(G2, 'deployed functions are newer than functions/src', '--no-cloud');
  skip(G5, 'STATUS.md §3 matches open issues', '--no-cloud');
} else {
  await checkRulesMatchReleased().catch((e) =>
    fail(G2, 'firestore.rules matches the released ruleset', `check threw: ${e.message}`),
  );
  guard(G2, 'deployed functions match functions/src exports', checkDeployedFunctions);
  guard(G2, 'deployed functions are newer than functions/src', checkFunctionsFreshness);
  guard(G2, 'generated food artifacts', checkGeneratedFoodArtifacts);
  await checkStatusVsAsc().catch((e) =>
    fail(G2, 'STATUS.md §1 matches App Store Connect', `check threw: ${e.message}`),
  );
  guard(G3, `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`, checkSchedulerJobs);
  guard(G3, `active secret versions <= ${ACCEPTED_SECRET_VERSIONS} (free tier ${MAX_SECRET_VERSIONS})`, checkSecretVersions);
  guard(G3, `${QUOTA_DOC} matches the EAS iOS quota`, checkEasQuota);
  await checkPlaySigningCerts().catch((e) =>
    fail(G3, 'every cert Play ships is registered in Firebase', `check threw: ${e.message}`),
  );
  await checkAppVersionManifest().catch((e) =>
    fail(G3, 'app-version.json matches what Play ships', `check threw: ${e.message}`),
  );
  await checkAppVersionManifestIos().catch((e) =>
    fail(G3, 'app-version.json matches what the App Store ships', `check threw: ${e.message}`),
  );
  await checkSentryToken().catch((e) =>
    fail(G3, 'SENTRY_AUTH_TOKEN authenticates', `check threw: ${e.message}`),
  );
  guard(G5, 'STATUS.md §3 matches open issues', checkStatusVsIssues);
}

guard(G4, 'web i18n', checkWebI18n);
guard(G4, 'mobile i18n', checkMobileI18n);
guard(G6, 'no CORRECTION headings', checkNoCorrectionHeadings);
guard(G6, 'no shipped plan docs', checkNoShippedPlanDocs);
guard(G6, 'relative md links', checkRelativeMarkdownLinks);

// ─── Report ────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status === 'FAIL');
const skipped = results.filter((r) => r.status === 'SKIP');

if (AS_JSON) {
  console.log(JSON.stringify({ results, failed: failed.length, skipped: skipped.length }, null, 2));
} else {
  const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
  const badge = { PASS: c(32, ' PASS'), FAIL: c(31, ' FAIL'), SKIP: c(33, ' SKIP') };

  let group = '';
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      console.log(`\n${c(1, group)}`);
    }
    console.log(`  ${badge[r.status]}  ${r.name}`);
    if (r.detail) console.log(`        ${r.detail}`);
  }

  const n = results.length;
  console.log(
    `\n${results.filter((r) => r.status === 'PASS').length}/${n} passed · ` +
      `${failed.length} failed · ${skipped.length} skipped`,
  );
  if (skipped.length && STRICT) {
    console.log(
      `--strict: ${skipped.length} skipped check(s) count as failures. ` +
        'Nothing below was actually verified.',
    );
  } else if (skipped.length && !NO_CLOUD) {
    console.log('Skipped checks need credentials; they never fail the run.');
  }
}

process.exit(failed.length || (STRICT && skipped.length) ? 1 : 0);
