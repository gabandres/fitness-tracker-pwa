/**
 * Put water on the QA account so the Trends water card can be LOOKED AT
 * (#115 §3), and take it off again afterwards.
 *
 * The card needs three logged days in a fourteen-day window before it is a card
 * at all, and the QA account has none — which is the same wall the fasting card
 * hit (`AGENTS.md`, OTA 66–68: twelve fasts had to be seeded before anyone could
 * see that v1 was a barcode). A card nobody can see is a card nobody can
 * correct, and every recent publish here has needed a device correction that no
 * test could produce.
 *
 * ## It is reversible, and that is the point
 *
 * `--clear` deletes exactly the keys in the window rather than the collection,
 * so a real day the account happens to hold outside it is never touched. Run it
 * when the screenshots are taken. A QA account left carrying fabricated data is
 * how the next person's baseline goes quietly wrong.
 *
 * ## Safety
 *
 * Refuses any uid that is not marked `syntheticAccount: true`. The QA account is
 * synthetic on purpose; a real account's water is somebody's record and this
 * script must not be one keystroke away from overwriting it. That guard exists
 * because a guessed uid once created a junk `users/` document here (#110).
 *
 * Water feeds no estimator — `dailyTargets`/`tdee` read logs and weights, never
 * `dailyWater` — so unlike a fabricated weigh-in this cannot distort the
 * account's measured maintenance. That was checked, not assumed.
 *
 *   node scripts/seed-qa-water.mjs --uid <uid>
 *   node scripts/seed-qa-water.mjs --uid <uid> --clear
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'fitness-tracker-gb-1775407101';
const WINDOW_DAYS = 14;

/**
 * A believable fortnight, oldest first: mostly-consistent days around 48–72 fl
 * oz with three gaps.
 *
 * Deliberately NOT flat. A flat series would draw the exact chart this card was
 * built to survive — fourteen identical bars — and hide whether the median line
 * is visible against them, which is the thing the fasting card's device pass
 * found and could only find by looking. `null` is a day with no record, and it
 * must render as a hairline at the baseline rather than a zero-height bar.
 */
const SERIES = [40, 56, null, 64, 48, 72, 60, null, 52, 68, 44, 56, null, 64];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function windowKeys() {
  const out = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const uid = arg('--uid');
  const clear = process.argv.includes('--clear');
  if (!uid) {
    console.error('Usage: node scripts/seed-qa-water.mjs --uid <uid> [--clear]');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  const db = getFirestore();

  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    console.error(`No users/${uid} document. Refusing — a guessed uid creates junk.`);
    process.exit(1);
  }
  if (snap.data()?.syntheticAccount !== true) {
    console.error(
      `users/${uid} is not marked syntheticAccount: true. Refusing.\n` +
        `This script writes over somebody's record if pointed at a real account.`,
    );
    process.exit(1);
  }

  const keys = windowKeys();
  const batch = db.batch();
  let written = 0;
  let removed = 0;

  for (let i = 0; i < keys.length; i++) {
    const ref = userRef.collection('dailyWater').doc(keys[i]);
    if (clear) {
      batch.delete(ref);
      removed++;
      continue;
    }
    const flOz = SERIES[i];
    if (flOz == null) {
      // A gap must be an ABSENT document, never a stored 0 — the card reads a
      // zero as "no record" too, but only because it is defensive; the honest
      // representation of a day nobody logged is a day with no document.
      batch.delete(ref);
      continue;
    }
    batch.set(ref, { flOz });
    written++;
  }

  await batch.commit();

  if (clear) {
    console.log(`Cleared ${removed} dailyWater docs across ${keys[0]}..${keys[keys.length - 1]}.`);
  } else {
    console.log(`Seeded ${written} days of water on ${uid}, ${keys[0]}..${keys[keys.length - 1]}.`);
    console.log(`Run again with --clear when the captures are taken.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
