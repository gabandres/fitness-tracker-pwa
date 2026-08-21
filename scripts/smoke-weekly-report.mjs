#!/usr/bin/env node
/**
 * smoke-weekly-report — run a REAL generateWeeklyReport call against PRODUCTION.
 *
 *   node scripts/smoke-weekly-report.mjs
 *
 * ## Why this exists
 *
 * `weekly-report.ts` was rewired onto the shared `functions/src/gemini-client.ts`
 * (lazy `require` + a memoized client) alongside `consultation` and
 * `analyze-photo`. `consultationStream` was verified end-to-end in the deployed
 * runtime; this callable was not. "Identical code path, so probably fine" is not
 * verification — the two differ in the one place that matters here, the model id
 * (`gemini-2.5-flash`) and the Firestore write that follows the generation.
 *
 * This is the sibling of `scripts/smoke-photo-scan.mjs` and follows its account
 * discipline exactly.
 *
 * ## The account, and why it needs a comp
 *
 * `generateWeeklyReport` throws `permission-denied` for `caller.tier === "free"`,
 * so a plain throwaway user cannot exercise it. Of the two comp routes in
 * `caller-access.ts`, this script uses the per-user one:
 *
 *   - `config/accessList.compedEmails` is a SHARED production document. Editing
 *     it to smoke-test would mutate real config, and its 60s per-instance cache
 *     means the edit lingers in warm instances after cleanup. Not used.
 *   - `users/{uid}.compedUntil` is a future Timestamp on the throwaway's OWN
 *     profile. It is per-user, it is deleted with the user, and because the uid
 *     is brand new no warm instance can hold a stale cache entry for it.
 *
 * Writing that field needs the Admin SDK — `firestore.rules` blocks a client
 * from comping itself, which is the point. ADC is assumed (see CLAUDE.local.md).
 *
 * ## Cleanup
 *
 * Deleting the Auth user does NOT delete its Firestore documents. The report
 * this script generates lands in `users/{uid}/reports`, so the `finally` block
 * removes the profile doc and the whole subcollection as well as the account.
 * An orphan here is a real document tree that nothing else will ever collect.
 *
 * ## Reading the output
 *
 * A pass means: auth → tier resolution → payload validation → the 6-day rate
 * limit → a real Gemini call through the shared memoized client → a non-empty
 * markdown body → a `users/{uid}/reports` document that the client can read
 * back. The markdown preview is printed because an empty-but-successful
 * response is exactly what a broken lazy `require` would produce.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT = 'fitness-tracker-gb-1775407101';
// Public by design — the same key the web app ships (see CLAUDE.md and
// `src/environments/*`). It authorizes nothing on its own.
const WEB_API_KEY = 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs';
const FN_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/generateWeeklyReport`;
const IDP = 'https://identitytoolkit.googleapis.com/v1/accounts';

const post = async (url, body, headers = {}) =>
  (
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  ).json();

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();

const email = `smoke-report-${Date.now()}@ignia-test.invalid`;
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
const { idToken, localId: uid } = signUp;
console.log(`throwaway user ${uid}`);

let failures = 0;
try {
  // Comp it. A brand-new uid cannot be in any instance's compedUntilCache, so
  // this takes effect on the very next call rather than after the 60s TTL.
  await db.doc(`users/${uid}`).set(
    { compedUntil: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000) },
    { merge: true },
  );
  console.log('comped via users/{uid}.compedUntil (+1h)');

  // Deliberately small: this is a transport + wiring check, not a prompt
  // evaluation. The real client sends a much larger systemInstruction, but a
  // broken `require` fails identically at any size and costs less here.
  const systemInstruction =
    'You are a fitness coach writing a short weekly report in markdown. ' +
    'Use a heading and at most three bullet points. Be concise.';
  const prompt =
    'Week summary: averaged 2,050 kcal/day against a 2,100 target, ' +
    '148 g protein/day against 150 g, 6 of 7 days logged, weight down 0.4 lb. ' +
    'Write the report.';

  const t0 = Date.now();
  const body = await post(
    FN_URL,
    { data: { systemInstruction, prompt } },
    { authorization: `Bearer ${idToken}` },
  );
  const ms = Date.now() - t0;

  if (body.error) {
    failures++;
    console.log(`FAILED in ${ms}ms:`, JSON.stringify(body.error).slice(0, 600));
  } else {
    const r = body.result ?? {};
    const markdown = r.markdown ?? '';
    console.log(`ok in ${ms}ms · report ${r.id} · ${markdown.length} chars markdown`);
    console.log('--- markdown ---');
    console.log(markdown.slice(0, 600) + (markdown.length > 600 ? '\n…(truncated)' : ''));
    console.log('----------------');

    if (!markdown) {
      failures++;
      console.log('!! empty markdown — the callable returned success with no content');
    }
    if (!r.id) {
      failures++;
      console.log('!! no document id returned');
    }

    // The return value is not the deliverable — the Firestore doc is. The web
    // client reads reports back from `users/{uid}/reports`, so verify the write
    // landed rather than trusting the response.
    const snap = await db.collection('users').doc(uid).collection('reports').get();
    if (snap.size !== 1) {
      failures++;
      console.log(`!! expected 1 report doc, found ${snap.size}`);
    } else {
      const doc = snap.docs[0].data();
      const okId = snap.docs[0].id === r.id;
      const okMd = doc.markdown === markdown;
      const okTs = doc.generatedAt instanceof Timestamp;
      console.log(
        `firestore doc: id match ${okId} · markdown match ${okMd} · generatedAt Timestamp ${okTs}`,
      );
      if (!okId || !okMd || !okTs) failures++;
    }
  }
} finally {
  // Always, including on a thrown error. Deleting the Auth user leaves its
  // documents behind, so both have to go.
  try {
    const reports = await db.collection('users').doc(uid).collection('reports').get();
    await Promise.all(reports.docs.map((d) => d.ref.delete()));
    await db.doc(`users/${uid}`).delete();
    console.log(`firestore cleaned: ${reports.size} report doc(s) + profile`);
  } catch (e) {
    console.log('!! firestore cleanup failed:', e?.message ?? e);
  }
  const del = await fetch(`${IDP}:delete?key=${WEB_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  console.log(`throwaway user deleted: ${del.ok}`);
}

process.exit(failures > 0 ? 1 : 0);
