#!/usr/bin/env node
/**
 * doctor — assert the facts this repo has actually drifted on.
 *
 *   npm run doctor              # everything the current credentials allow
 *   npm run doctor -- --no-cloud   # only checks that need no credentials (CI)
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
 *   5. `STATUS.md` §4 listed work that was already closed.
 *   6. Plan docs outlived their work and grew "CORRECTION" blocks on top,
 *      which is how a status doc and a wish list became indistinguishable —
 *      three separate times, features already shipped were re-scoped as new.
 *
 * Exit code is 1 if any check FAILS. SKIP never fails the run: a machine
 * without gcloud/firebase/gh credentials must still be able to run this, and
 * CI runs the credential-free subset via --no-cloud.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'fitness-tracker-gb-1775407101';

const argv = process.argv.slice(2);
const NO_CLOUD = argv.includes('--no-cloud');
const AS_JSON = argv.includes('--json');

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

/** Run a command, returning null instead of throwing when it is missing or
 *  unauthenticated — that is a SKIP condition, not a failure. `shell: true`
 *  because firebase/gh/gcloud are .cmd shims on Windows. */
function sh(cmd, args, { timeout = 120_000 } = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: true,
    timeout,
    cwd: root,
    windowsHide: true,
  });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
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
  const out = sh('git', ['ls-files', `"${glob}"`]);
  if (!out) return [];
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))];
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
  flags.webPro = readFlag(
    'src/app/services/subscription.service.ts',
    /export const PRO_ENABLED\s*=\s*(true|false)/,
  );
  flags.webPhotoScan = readFlag(
    'src/app/utils/features.ts',
    /photoScan:\s*(true|false)/,
  );
  flags.mobilePro = readFlag(
    'apps/mobile/src/lib/subscription.ts',
    /export const PRO_ENABLED\s*=\s*(true|false)/,
  );

  // Mobile photoScan is NOT a literal — features.ts defaults it ON and the
  // shipped value comes from eas.json, which sets
  // EXPO_PUBLIC_FEATURE_PHOTO_SCAN=0 on the production and preview profiles.
  // Reading features.ts alone would report "on" and be wrong about every
  // binary users can install, so the build config is the source of truth.
  let mobilePhotoScan = { value: null, why: 'apps/mobile/eas.json not found' };
  if (has('apps/mobile/eas.json')) {
    const eas = JSON.parse(read('apps/mobile/eas.json'));
    const env = eas?.build?.production?.env ?? {};
    const raw = env.EXPO_PUBLIC_FEATURE_PHOTO_SCAN;
    mobilePhotoScan =
      raw === undefined
        ? { value: null, why: 'production profile sets no EXPO_PUBLIC_FEATURE_PHOTO_SCAN' }
        : { value: raw !== '0', why: '' };
  }
  flags.mobilePhotoScan = mobilePhotoScan;
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
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenJson(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(' ') : String(v);
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

  const proOff = flags.webPro.value === false || flags.mobilePro.value === false;
  const photoOff = flags.webPhotoScan.value === false || flags.mobilePhotoScan.value === false;

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

function gcloudToken() {
  const t = sh('gcloud', ['auth', 'print-access-token'], { timeout: 60_000 });
  return t ? t.trim() : null;
}

async function checkRulesMatchReleased() {
  const name = 'firestore.rules matches the released ruleset';
  if (!has('firestore.rules')) return fail(G2, name, 'firestore.rules not found');
  const token = gcloudToken();
  if (!token) {
    return skip(G2, name, 'no gcloud access token (run `gcloud auth application-default login`)');
  }
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
  const out = sh('firebase', ['functions:list', '--json', '--project', PROJECT], {
    timeout: 180_000,
  });
  const parsed = parseJsonLoose(out);
  const list = Array.isArray(parsed) ? parsed : parsed?.result;
  if (!Array.isArray(list)) {
    return skip(G2, name, 'firebase CLI unavailable or not logged in (`firebase login`)');
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

// ═══ 3. Free-tier ceilings ══════════════════════════════════════════════
const G3 = '3. free-tier ceilings';
const MAX_SCHEDULER_JOBS = 3;
const MAX_SECRET_VERSIONS = 6;

function checkSchedulerJobs() {
  const name = `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`;
  const out = sh('gcloud', [
    'scheduler', 'jobs', 'list', '--project', PROJECT,
    '--location', 'us-central1', '--format=json',
  ]);
  const jobs = parseJsonLoose(out);
  if (!Array.isArray(jobs)) return skip(G3, name, 'gcloud unavailable or not authenticated');
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

function checkSecretVersions() {
  const name = `active secret versions <= ${MAX_SECRET_VERSIONS}`;
  const listOut = sh('gcloud', ['secrets', 'list', '--project', PROJECT, '--format=json']);
  const secrets = parseJsonLoose(listOut);
  if (!Array.isArray(secrets)) return skip(G3, name, 'gcloud unavailable or not authenticated');

  let total = 0;
  const per = [];
  for (const s of secrets) {
    const id = (s.name ?? '').split('/').pop();
    const vOut = sh('gcloud', [
      'secrets', 'versions', 'list', id, '--project', PROJECT, '--format=json',
    ]);
    const versions = parseJsonLoose(vOut);
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
  } else {
    // Two very different causes, and the wrong advice is worse than none:
    // rotation residue is free to clean up, whereas N distinct secrets each
    // holding one live version means the project genuinely needs more than the
    // free tier and someone has to decide to consolidate or to pay.
    const residue = per.filter((p) => Number(p.split('=')[1]) > 1);
    fail(
      G3,
      name,
      `${total} active versions, free tier is ${MAX_SECRET_VERSIONS}: ${per.join(', ')}. ` +
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

// ═══ 4. Locale key parity ═══════════════════════════════════════════════
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

function checkWebI18n() {
  const name = 'web en.json vs es-PR.json';
  const en = 'src/app/i18n/en.json';
  const es = 'src/app/i18n/es-PR.json';
  if (!has(en) || !has(es)) return fail(G4, name, 'web i18n files not found');
  diffKeys(
    G4,
    name,
    new Set(Object.keys(flattenJson(JSON.parse(read(en))))),
    new Set(Object.keys(flattenJson(JSON.parse(read(es))))),
    'en',
    'es-PR',
  );
}

/** Mobile bundles are flat `'key.name': 'value'` object literals in .ts, so
 *  the keys are read with a regex — importing them would need the RN runtime. */
function mobileKeys(file) {
  const keys = new Set();
  for (const m of read(file).matchAll(/^\s*['"]([^'"]+)['"]\s*:/gm)) keys.add(m[1]);
  return keys;
}

function checkMobileI18n() {
  const name = 'mobile en.ts vs es-PR.ts';
  const en = 'apps/mobile/src/i18n/en.ts';
  const es = 'apps/mobile/src/i18n/es-PR.ts';
  if (!has(en) || !has(es)) return fail(G4, name, 'mobile i18n files not found');
  diffKeys(G4, name, mobileKeys(en), mobileKeys(es), 'en', 'es-PR');
}

// ═══ 5. STATUS.md §4 vs open issues ═════════════════════════════════════
const G5 = '5. STATUS.md vs issue tracker';

function statusSection4() {
  const text = read('STATUS.md');
  const start = text.search(/^##\s*4\./m);
  if (start === -1) return null;
  const rest = text.slice(start + 1);
  const end = rest.search(/^##\s/m);
  return end === -1 ? rest : rest.slice(0, end);
}

function checkStatusVsIssues() {
  const name = 'STATUS.md §4 matches open issues';
  if (!has('STATUS.md')) return fail(G5, name, 'STATUS.md not found');
  const section = statusSection4();
  if (section === null) return fail(G5, name, 'no "## 4." section in STATUS.md');

  const out = sh('gh', [
    'issue', 'list', '--state', 'open', '--limit', '200',
    '--json', 'number,title,labels',
  ]);
  const open = parseJsonLoose(out);
  if (!Array.isArray(open)) {
    return skip(G5, name, 'gh CLI unavailable or not authenticated (`gh auth login`)');
  }
  const openNums = new Set(open.map((i) => i.number));
  const cited = [...new Set([...section.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];

  const stale = cited.filter((n) => !openNums.has(n));

  // Maps (`wayfinder:map`) are containers for tasks, not work items — §4 is a
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
        stale.length ? `cited in §4 but NOT open (closed or missing): ${stale.map((n) => `#${n}`).join(', ')}` : '',
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

// ═══ Run ════════════════════════════════════════════════════════════════
guard(G1, 'copy vs flags', checkCopyVsFlags);

if (NO_CLOUD) {
  skip(G2, 'firestore.rules matches the released ruleset', '--no-cloud');
  skip(G2, 'deployed functions match functions/src exports', '--no-cloud');
  skip(G3, `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`, '--no-cloud');
  skip(G3, `active secret versions <= ${MAX_SECRET_VERSIONS}`, '--no-cloud');
  skip(G5, 'STATUS.md §4 matches open issues', '--no-cloud');
} else {
  await checkRulesMatchReleased().catch((e) =>
    fail(G2, 'firestore.rules matches the released ruleset', `check threw: ${e.message}`),
  );
  guard(G2, 'deployed functions match functions/src exports', checkDeployedFunctions);
  guard(G3, `Cloud Scheduler jobs <= ${MAX_SCHEDULER_JOBS}`, checkSchedulerJobs);
  guard(G3, `active secret versions <= ${MAX_SECRET_VERSIONS}`, checkSecretVersions);
  guard(G5, 'STATUS.md §4 matches open issues', checkStatusVsIssues);
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
  if (skipped.length && !NO_CLOUD) {
    console.log('Skipped checks need credentials; they never fail the run.');
  }
}

process.exit(failed.length ? 1 : 0);
