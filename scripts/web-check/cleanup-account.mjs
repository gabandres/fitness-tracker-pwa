#!/usr/bin/env node
/**
 * Delete a throwaway check account through the app's own `deleteAccount`
 * callable, then prove it is gone by failing to sign in.
 *
 *   node scripts/web-check/cleanup-account.mjs <email> <password>
 *
 * Only `delivered+<label>@resend.dev` addresses: this is for accounts a check
 * created, never a person's. A leftover unverified account counts in the
 * signup numbers.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('usage: node scripts/web-check/cleanup-account.mjs <email> <password>');
  process.exit(64);
}
if (!/^delivered\+[^@]+@resend\.dev$/i.test(email)) {
  console.error('refusing: only delivered+<label>@resend.dev check accounts are deleted by this script');
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = readFileSync(resolve(root, 'apps/mobile/src/lib/firebase-config.ts'), 'utf8');
const pick = (key) => {
  const m = config.match(new RegExp(key + "\\s*:\\s*['\"]([^'\"]+)['\"]"));
  if (!m) throw new Error(`no ${key} in firebase-config.ts`);
  return m[1];
};
const apiKey = pick('apiKey');
const projectId = pick('projectId');

const post = async (url, body, headers = {}) => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
};
const signIn = () =>
  post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { email, password, returnSecureToken: true });

const first = await signIn();
if (first.status !== 200) {
  console.log('sign-in failed (already deleted, or a wrong password):', first.status, first.json?.error?.message);
  process.exit(1);
}
const del = await post(`https://us-central1-${projectId}.cloudfunctions.net/deleteAccount`, { data: {} }, { Authorization: 'Bearer ' + first.json.idToken });
console.log('deleteAccount →', del.status, JSON.stringify(del.json).slice(0, 160));
const again = await signIn();
const gone = again.status !== 200;
console.log('sign-in after delete →', again.status, again.json?.error?.message ?? '(STILL EXISTS)');
process.exit(gone ? 0 : 1);
