#!/usr/bin/env node
/**
 * smoke-photo-scan — run a REAL photo scan against PRODUCTION, end to end.
 *
 *   node scripts/smoke-photo-scan.mjs <image.jpg> [more.jpg ...]
 *
 * ## Why this exists
 *
 * Until 2026-08-07, photo-scan had **never had a single end-to-end round trip**
 * on a real signed-in account — not once, across months of it being deployed and
 * then switched on for every user. Unit tests cover the resolver, and the
 * emulator covers the guards, but neither exercises the thing that actually
 * breaks: auth → rate limit → quota → spend ceiling → a real Gemini call → JSON
 * that matches the schema → USDA resolution → the response shape the clients
 * parse. Every one of those is a seam, and the first run of this script found
 * two real bugs that all 96 unit tests had passed over.
 *
 * It costs about $0.0015 and one of the caller's three daily scans.
 *
 * ## The account
 *
 * A throwaway user is created via the public Identity Toolkit signUp endpoint
 * and **deleted at the end**, including on failure. It is deliberately not
 * either demo account: `review@ignia.fit` is what Apple App Review signs in as
 * and must never be touched, and burning `demo@`'s daily scans would break a
 * screenshot capture. A fresh user also proves the FREE path — 3 scans/day —
 * which is what almost every real user is on.
 *
 * ## Reading the output
 *
 * The `source` column is the point. `usda` means the macros came from the
 * bundled database; `model` means nothing matched and the vision model's own
 * numbers stand (ADR-0019). A plate that is all `model` means resolution is
 * failing and the feature has quietly reverted to the design ADR-0015 §1
 * rejected — that is the regression to watch for, and it is invisible in the
 * totals alone.
 *
 * `-> Matched description` is what the app thinks each food IS. Read it: the
 * production bugs found this way were "tomato sauce" resolving to *Sauce, steak,
 * tomato based* and "mixed seafood" to *Turnover, seafood*, both of which look
 * perfectly reasonable as a calorie number and are obviously wrong as a name.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const PROJECT = 'fitness-tracker-gb-1775407101';
// Public by design — the same key the web app ships (see CLAUDE.md, and
// `src/environments/*`). It authorizes nothing on its own; Firestore rules and
// the callables' own auth checks are the access-control layer.
const WEB_API_KEY = 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs';
const FN_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/analyzePhoto`;
const IDP = 'https://identitytoolkit.googleapis.com/v1/accounts';

/** The per-uid rate limit in analyze-photo.ts is 3s; leave margin. */
const RATE_LIMIT_PAUSE_MS = 4_000;

/**
 * `--note "<text>"` sends the description field (ADR-0029 item 1) with every
 * image, exactly as the mobile describe step does.
 *
 * It is here because the note is a SEAM, and seams are what this script exists
 * to exercise. The server fences the note into the prompt as data-not-
 * instructions and scopes it to naming and portion; nothing in the unit tests
 * or the emulator sends one to a real model. Run the same photo with and
 * without to see what it actually buys — that comparison is the only honest way
 * to price the feature, and ADR-0029's Definition of Done asks for the token
 * cost "measured rather than estimated".
 */
/**
 * `--multi` sends EVERY image listed as ONE scan (ADR-0029 item 5) instead of
 * one scan each. It is the only way to exercise the multi-image path against a
 * real model — and the only way to see whether the "these are the same meal"
 * prompt clause actually stops the model enumerating each photo separately,
 * which is the failure that would make multi-image worse than single-image.
 *
 * It costs one quota slot PER IMAGE, which is the point of the change it tests.
 */
const argv = process.argv.slice(2);
const multi = argv.includes('--multi');
const noteFlag = argv.indexOf('--note');
const note = noteFlag === -1 ? '' : (argv[noteFlag + 1] ?? '');
const images = (noteFlag === -1 ? argv : argv.filter((_, i) => i !== noteFlag && i !== noteFlag + 1))
  .filter((a) => a !== '--multi');
if (images.length === 0) {
  console.error('usage: node scripts/smoke-photo-scan.mjs [--multi] [--note "<text>"] <image.jpg> [...]');
  process.exit(2);
}

const post = async (url, body, headers = {}) =>
  (
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  ).json();

const email = `smoke-photo-${Date.now()}@ignia-test.invalid`;
const password = `Tmp!${Math.floor(Math.random() * 1e9)}aA`;

const signUp = await post(`${IDP}:signUp?key=${WEB_API_KEY}`, {
  email,
  password,
  returnSecureToken: true,
});
if (!signUp.idToken) {
  console.error('sign-up failed:', JSON.stringify(signUp));
  process.exit(1);
}
const idToken = signUp.idToken;
console.log(`throwaway user ${signUp.localId} (free tier, 3 scans/day)`);

let failures = 0;
try {
  // One request per image, or one request for all of them under --multi.
  const requests = multi ? [images] : images.map((x) => [x]);
  for (const [i, paths] of requests.entries()) {
    // Mirrors what the clients send. The two do NOT agree, and that is not a
    // bug: mobile resizes to 768px WIDE, web to 1920px on the long edge. 1080
    // is a middle value both paths tolerate; sending an unresized original
    // would test a payload no client produces.
    const bufs = await Promise.all(
      paths.map((path) =>
        sharp(readFileSync(path)).resize({ width: 1080 }).jpeg({ quality: 80 }).toBuffer(),
      ),
    );
    const buf = bufs[0];
    const path = paths.join(' + ');
    console.log(`\n=== ${path} — ${(buf.length / 1024).toFixed(0)} KB${note ? ` · note: "${note}"` : ''} ===`);

    const t0 = Date.now();
    const body = await post(
      FN_URL,
      { data: { photoBase64: bufs[0].toString('base64'), ...(bufs.length>1?{photosBase64:bufs.map(b=>b.toString('base64'))}:{}), locale: 'en', ...(note ? { note } : {}) } },
      { authorization: `Bearer ${idToken}` },
    );
    const ms = Date.now() - t0;

    if (body.error) {
      failures++;
      console.log(`FAILED in ${ms}ms:`, JSON.stringify(body.error).slice(0, 400));
      continue;
    }
    const r = body.result;
    const items = r.items ?? [];
    const grounded = items.filter((it) => it.source === 'usda').length;
    console.log(
      `ok in ${ms}ms · "${r.description}" · confidence ${r.confidence} · ` +
        `${grounded}/${items.length} grounded in USDA · ${r.photosRemaining} scans left`,
    );
    for (const it of items) {
      console.log(
        `  ${String(it.source).padEnd(5)} ${it.measured ? '[weighed]' : '        '} ${String(it.grams).padStart(4)}g ` +
          `${String(it.calories).padStart(4)}kcal ${String(it.protein).padStart(5)}p  ` +
          `${it.name} -> ${it.matchedDescription ?? '(model fallback)'}`,
      );
    }
    console.log(`  TOTAL ${r.calories} kcal · ${r.protein}p · ${r.carbs}c · ${r.fat}f`);

    if (items.length === 0) {
      failures++;
      console.log('  !! no items — the model returned nothing the server could itemize');
    }
    if (i < images.length - 1) await new Promise((res) => setTimeout(res, RATE_LIMIT_PAUSE_MS));
  }
} finally {
  // Always, including on a thrown error: an orphaned account is a real user in
  // Firebase Auth that nothing will ever clean up.
  const del = await fetch(`${IDP}:delete?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  console.log(`\nthrowaway user deleted: ${del.ok}`);
}

process.exit(failures > 0 ? 1 : 0);
