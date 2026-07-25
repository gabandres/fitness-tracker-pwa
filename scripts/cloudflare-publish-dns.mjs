#!/usr/bin/env node
/**
 * Publishes Resend's DKIM/SPF/return-path records for `mail.ignia.fit` into
 * Cloudflare, then asks Resend to verify.
 *
 * Pulls the record set from the Resend API rather than taking it as input, so
 * there is no transcription step between the two systems — the values that get
 * published are, by construction, the values Resend is expecting.
 *
 *   RESEND_API_KEY=re_xxx CLOUDFLARE_API_TOKEN=xxx \
 *     node scripts/cloudflare-publish-dns.mjs --dry-run
 *   RESEND_API_KEY=re_xxx CLOUDFLARE_API_TOKEN=xxx \
 *     node scripts/cloudflare-publish-dns.mjs --apply
 *
 * The Cloudflare token needs **Zone · DNS · Edit** on `ignia.fit`. A token with
 * only Zone·Read can list the zone but returns `Authentication error` on
 * /dns_records — which is exactly how this fails if the scope is wrong.
 *
 * Context: docs/email-deliverability.md
 */

const ZONE_NAME = process.env.CLOUDFLARE_ZONE || "ignia.fit";
const DOMAIN = process.env.RESEND_DOMAIN || "mail.ignia.fit";
const CF = "https://api.cloudflare.com/client/v4";
const RESEND = "https://api.resend.com";

const resendKey = process.env.RESEND_API_KEY;
const cfToken = process.env.CLOUDFLARE_API_TOKEN;
const apply = process.argv.includes("--apply");

if (!resendKey || !cfToken) {
  console.error("Set both RESEND_API_KEY and CLOUDFLARE_API_TOKEN.");
  process.exit(1);
}

async function cf(path, init = {}) {
  const res = await fetch(`${CF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    const msg = (body.errors || []).map((e) => `${e.code} ${e.message}`).join("; ");
    if (/Authentication error/i.test(msg)) {
      throw new Error(
        `${msg}\n\nThe token reached Cloudflare but is not allowed on DNS records.\n` +
          "Grant it: Zone · DNS · Edit, scoped to the ignia.fit zone.",
      );
    }
    throw new Error(msg || `CF ${res.status}`);
  }
  return body.result;
}

async function resendApi(path) {
  const res = await fetch(`${RESEND}${path}`, {
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message || `Resend ${res.status}`);
  return body;
}

/**
 * Resend returns names RELATIVE to the zone (`resend._domainkey.mail`), while
 * Cloudflare stores and returns them absolute (`…mail.ignia.fit`). Cloudflare
 * would happily append the zone to a relative name on write, but the read side
 * has to be normalised too — otherwise the upsert below compares a relative
 * name against absolute ones, never matches, and a second run creates
 * DUPLICATE records instead of updating them.
 */
function absolute(name) {
  return name === "@" || name.endsWith(`.${ZONE_NAME}`) || name === ZONE_NAME
    ? name
    : `${name}.${ZONE_NAME}`;
}

function toCloudflare(record) {
  const base = {
    type: record.type,
    name: absolute(record.name),
    ttl: 1, // "Auto"
    comment: `Resend ${DOMAIN} — managed by scripts/cloudflare-publish-dns.mjs`,
  };
  if (record.type === "MX") {
    return { ...base, content: record.value, priority: record.priority ?? 10 };
  }
  // TXT content must be quoted when it contains spaces; Cloudflare handles
  // the quoting itself, so send the raw value.
  return { ...base, content: record.value };
}

async function main() {
  const { data } = await resendApi("/domains");
  const domain = data?.find((d) => d.name === DOMAIN);
  if (!domain) {
    console.error(`${DOMAIN} is not in Resend. Run resend-domain-setup.mjs --create first.`);
    process.exit(1);
  }
  const detail = await resendApi(`/domains/${domain.id}`);
  const wanted = (detail.records || []).map(toCloudflare);
  if (!wanted.length) {
    console.error("Resend returned no records to publish.");
    process.exit(1);
  }

  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones[0];
  if (!zone) throw new Error(`Zone ${ZONE_NAME} not found for this token.`);
  console.log(`Zone ${ZONE_NAME} (${zone.id})\nResend domain ${DOMAIN} — status: ${detail.status}\n`);

  const existing = await cf(`/zones/${zone.id}/dns_records?per_page=200`);

  for (const rec of wanted) {
    // Match on name+type: re-running must update in place, never duplicate.
    const prior = existing.find((e) => e.name === rec.name && e.type === rec.type);
    const verb = prior ? "UPDATE" : "CREATE";
    console.log(`${verb} ${rec.type.padEnd(4)} ${rec.name}`);
    console.log(`       ${String(rec.content).slice(0, 90)}${String(rec.content).length > 90 ? "…" : ""}`);
    if (prior && prior.content === rec.content) {
      console.log("       (already correct — skipping)\n");
      continue;
    }
    if (!apply) {
      console.log("       (dry run)\n");
      continue;
    }
    await cf(
      prior ? `/zones/${zone.id}/dns_records/${prior.id}` : `/zones/${zone.id}/dns_records`,
      { method: prior ? "PUT" : "POST", body: JSON.stringify(rec) },
    );
    console.log("       done\n");
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to write these records.");
    return;
  }

  console.log("Asking Resend to verify…");
  const res = await fetch(`${RESEND}/domains/${domain.id}/verify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}` },
  });
  console.log(res.ok ? "Verification requested." : `Verify call returned ${res.status}.`);
  console.log(
    "DNS can take a few minutes. Check with:\n" +
      "  node scripts/resend-domain-setup.mjs --verify",
  );
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
