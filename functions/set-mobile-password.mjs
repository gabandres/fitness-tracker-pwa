// One-shot helper: link an email/password credential to an existing
// (Google-only) account so the Expo mobile app can sign in with it.
// Run from the functions/ dir so firebase-admin resolves:
//
//   node set-mobile-password.mjs '<your-password>'
//
// Requires Application Default Credentials. If it errors on auth, run:
//   gcloud auth application-default login
//
// Safe + reversible: it only adds a password provider; Google sign-in
// on the web keeps working unchanged.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const EMAIL = 'gabrielandresbermudez@gmail.com';
const PROJECT_ID = 'fitness-tracker-gb-1775407101';

const password = process.argv[2];
if (!password || password.length < 6) {
  console.error('Usage: node set-mobile-password.mjs <password>  (min 6 chars)');
  process.exit(1);
}

initializeApp({ projectId: PROJECT_ID });

const auth = getAuth();
const user = await auth.getUserByEmail(EMAIL);
await auth.updateUser(user.uid, { password });

console.log(`✅ Password set for ${EMAIL} (uid ${user.uid}).`);
console.log('   Sign in on the Expo app with this email + the password you just set.');
console.log('   Google sign-in on the web is unaffected.');
process.exit(0);
