#!/usr/bin/env node
/**
 * Read an OTA back from `eas update:list --json` and write its two ledger rows.
 * Called by `scripts/ota-release.sh`; `--print` shows the rows and writes nothing.
 *
 *   node scripts/ota-ledger.mjs --list <list.json> --message "<msg>" --sha <sha>
 *     --ios-runtime <hash> --ios-binary "build 75 / 1.2.11"
 *     --android-runtime <hash> --android-binary "vc 53 / 1.2.10" [--print]
 *
 * It fails (exit 1) when a platform's newest update with that message is
 * missing or went out under another runtime: a publish on the wrong runtime
 * exits 0 and reaches nobody, so the read-back is the only proof.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const need = (name) => {
  const v = arg(name);
  if (!v) { console.error(`missing --${name}`); process.exit(64); }
  return v;
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = resolve(root, 'apps/mobile/docs/fingerprint-ledger.md');
const message = need('message');
const sha = need('sha');
const targets = [
  { platform: 'ios', label: 'iOS', runtime: need('ios-runtime'), binary: need('ios-binary') },
  { platform: 'android', label: 'Android', runtime: need('android-runtime'), binary: need('android-binary') },
];

const parsed = JSON.parse(readFileSync(need('list'), 'utf8'));
const updates = Array.isArray(parsed) ? parsed : parsed.currentPage ?? [];

let ledger = readFileSync(ledgerPath, 'utf8');
const crlf = ledger.includes('\r\n');
const lines = ledger.split(/\r?\n/);
const firstRow = lines.findIndex((l) => /^\| (iOS|Android) only \|/.test(l));
if (firstRow === -1) { console.error('no OTA row found in the ledger to insert before'); process.exit(1); }

const previousGroup = (label) => {
  const row = lines.find((l) => l.startsWith(`| ${label} only |`));
  return row?.match(/Group `([0-9a-f-]{36})`/)?.[1] ?? null;
};

// EAS hands the message back as `"<message>" (2 hours ago by <user>)`.
const bare = (s) => {
  const text = String(s ?? '').trim();
  const m = text.match(/^"([\s\S]*)" \([^()]* by [^()]*\)$/);
  return (m ? m[1] : text.replace(/^"+|"+$/g, '')).trim();
};
const sameMessage = (a, b) => bare(a) === bare(b);
const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
const cell = (s) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const rows = [];
for (const t of targets) {
  const hit = updates.find((u) => String(u.platforms ?? u.platform ?? '').includes(t.platform) && sameMessage(u.message, message));
  if (!hit) { console.error(`READ-BACK FAILED: no ${t.platform} update with this message in the newest ${updates.length}`); process.exit(1); }
  if (hit.runtimeVersion !== t.runtime) {
    console.error(`READ-BACK FAILED: ${t.platform} went out under ${hit.runtimeVersion}, not ${t.runtime} — it reaches nobody. Republish.`);
    process.exit(1);
  }
  const prev = previousGroup(t.label);
  const rollback = prev ? `Rollback: republish \`${prev}\`.` : 'Rollback: the previous group in `eas update:list`.';
  console.log(`READBACK ${t.platform} group ${hit.group} runtime ${hit.runtimeVersion}`);
  rows.push(
    t.platform === 'ios'
      ? `| iOS only | **iOS OTA on ${t.binary} — ${date}: ${cell(message)}. \`main\` @ \`${sha}\`** | \`${t.runtime}\` | gate = tree hash on \`winbox\` (matched, no pin); \`update:list\` read back | Group \`${hit.group}\`. JS only; gates and publish by \`scripts/ota-release.sh\`. ${rollback} |`
      : `| Android only | **Android OTA on ${t.binary} — ${date}: same commit** | \`${t.runtime}\` | PINNED (AGENTS.md artifact value), reverted (verified) | Group \`${hit.group}\`. ${rollback} |`,
  );
}

if (args.includes('--print')) {
  console.log(rows.join('\n'));
  process.exit(0);
}
lines.splice(firstRow, 0, ...rows);
writeFileSync(ledgerPath, lines.join(crlf ? '\r\n' : '\n'));
console.log(`ledger: 2 rows written above line ${firstRow + 1}`);
