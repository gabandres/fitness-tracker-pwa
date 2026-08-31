#!/usr/bin/env node
/**
 * announce-ota — tell every registered device to pre-download a just-published
 * OTA (#112/#114). Run from the workstation right after `eas update`:
 *
 *   node scripts/announce-ota.mjs --platform ios
 *   node scripts/announce-ota.mjs --platform android --message "water card fix"
 *
 * Invokes the admin-gated `adminAnnounceOta` callable, which queries profiles
 * holding an `expoPushToken` and POSTs SILENT pushes (no title/body) to Expo's
 * push API in chunks of 100. Until vc 41 / the next iOS build ship the native
 * push config, no device holds a token, so `recipients: 0` is the expected
 * output — not a failure.
 *
 * ## Auth
 *
 * ADC → `createCustomToken` for the admin uid → exchange for an ID token at
 * the Identity Toolkit REST endpoint → call the function with a Bearer header.
 * `serviceAccountId` is required because ADC user credentials cannot sign
 * custom tokens on their own; the App Engine default SA can, via IAM
 * signBlob. The API key is the public web key (see CLAUDE.md — public by
 * design; it authorizes nothing on its own).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const PROJECT = 'fitness-tracker-gb-1775407101';
const WEB_API_KEY = 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs';
const ADMIN_UID = 'ujRSJjYQWVMQyXGmXG06Qf0HehD2'; // the one SEED_ADMINS owner account
const FN_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/adminAnnounceOta`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const platform = flag('platform');
if (platform !== 'ios' && platform !== 'android') {
  console.error('usage: node scripts/announce-ota.mjs --platform <ios|android> [--message <text>]');
  process.exit(1);
}
const message = flag('message');

initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT,
  serviceAccountId: `firebase-adminsdk-fbsvc@${PROJECT}.iam.gserviceaccount.com`,
});

const customToken = await getAuth().createCustomToken(ADMIN_UID);

const signIn = await (
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  )
).json();
if (!signIn.idToken) {
  console.error('custom-token exchange failed:', JSON.stringify(signIn).slice(0, 400));
  process.exit(1);
}

const t0 = Date.now();
const res = await (
  await fetch(FN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${signIn.idToken}`,
    },
    body: JSON.stringify({ data: message ? { platform, message } : { platform } }),
  })
).json();
const ms = Date.now() - t0;

if (res.error) {
  console.error(`FAILED in ${ms}ms:`, JSON.stringify(res.error).slice(0, 600));
  process.exit(1);
}

const { recipients, sent, errors, cleared } = res.result ?? {};
console.log(
  `announced ${platform} OTA in ${ms}ms · recipients ${recipients} · sent ${sent} · errors ${errors} · tokens cleared ${cleared}`,
);
if (recipients === 0) {
  console.log(
    '(0 recipients is expected until the vc-41 / next-iOS-build native push config ships — no device can register a token yet)',
  );
}
