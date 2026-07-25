#!/usr/bin/env node
/**
 * Resend sending-domain setup for Ignia.
 *
 * Drives the Resend Domains API so the DKIM/SPF/return-path setup is a
 * reproducible command rather than a sequence of dashboard clicks, and so the
 * exact records to publish land in your terminal in copy-paste form.
 *
 * The API key is read from the environment and never written anywhere.
 *
 *   RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --list
 *   RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --create
 *   RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --records
 *   RESEND_API_KEY=re_xxx node scripts/resend-domain-setup.mjs --verify
 *
 * The key must be `full_access`; a `sending_access` key cannot create domains.
 *
 * Context: docs/email-deliverability.md
 */

const API = "https://api.resend.com";

// A subdomain, not the apex, so app-mail reputation can never contaminate
// ignia.fit itself. `bounces` puts the Return-Path at bounces.mail.ignia.fit,
// giving us an aligned SPF domain for feedback.
const DOMAIN = process.env.RESEND_DOMAIN || "mail.ignia.fit";
const RETURN_PATH = "bounces";
const REGION = "us-east-1";

const key = process.env.RESEND_API_KEY;
if (!key) {
  console.error("RESEND_API_KEY is not set.\n");
  console.error("Pull it from Secret Manager without echoing it:");
  console.error(
    '  RESEND_API_KEY=$(firebase functions:secrets:access RESEND_API_KEY \\\n' +
      "    --project fitness-tracker-gb-1775407101) node scripts/resend-domain-setup.mjs --list",
  );
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const listDomains = () => api("/domains");
const findDomain = async () =>
  (await listDomains()).data?.find((d) => d.name === DOMAIN) ?? null;

/** Renders Resend's record list as a Cloudflare-ready table. */
function printRecords(records) {
  if (!records?.length) {
    console.log("  (Resend returned no records yet — re-run --records shortly.)");
    return;
  }
  console.log("\nPublish these in Cloudflare — ALL as DNS only (grey cloud):\n");
  for (const r of records) {
    // Cloudflare appends the zone automatically, so strip the apex if Resend
    // returned an absolute name. Pasting the absolute form is the single most
    // common way to end up with `…ignia.fit.ignia.fit`.
    const name = r.name.endsWith(".ignia.fit")
      ? r.name.slice(0, -".ignia.fit".length)
      : r.name;
    console.log(`  Type     : ${r.type}`);
    console.log(`  Name     : ${name || "@"}`);
    console.log(`  Value    : ${r.value}`);
    if (r.priority != null) console.log(`  Priority : ${r.priority}`);
    console.log(`  TTL      : Auto`);
    console.log(`  (status  : ${r.status})\n`);
  }
  console.log("Then: node scripts/resend-domain-setup.mjs --verify\n");
}

async function main() {
  const cmd = process.argv[2] || "--list";

  if (cmd === "--list") {
    const { data } = await listDomains();
    if (!data?.length) return console.log("No domains on this account.");
    for (const d of data) {
      console.log(`${d.name.padEnd(28)} ${d.status.padEnd(12)} ${d.region}`);
    }
    return;
  }

  if (cmd === "--create") {
    const existing = await findDomain();
    if (existing) {
      console.log(`${DOMAIN} already exists (status: ${existing.status}).`);
      return printRecords((await api(`/domains/${existing.id}`)).records);
    }
    try {
      const created = await api("/domains", {
        method: "POST",
        body: JSON.stringify({
          name: DOMAIN,
          region: REGION,
          custom_return_path: RETURN_PATH,
          // Tracking stays OFF deliberately: click tracking rewrites every
          // URL through a redirect domain, which is actively harmful on a
          // password-reset link.
        }),
      });
      console.log(`Created ${DOMAIN} (id ${created.id}).`);
      printRecords(created.records);
    } catch (err) {
      if (err.status === 403 && /plan includes/i.test(err.message)) {
        console.error(`\nBLOCKED: ${err.message}`);
        console.error(
          "\nThe free plan allows one domain and it is already spent.\n" +
            "See docs/email-deliverability.md §2 for the three ways out.",
        );
        process.exit(2);
      }
      throw err;
    }
    return;
  }

  if (cmd === "--records" || cmd === "--verify") {
    const found = await findDomain();
    if (!found) {
      console.error(`${DOMAIN} does not exist yet. Run --create first.`);
      process.exit(1);
    }
    if (cmd === "--verify") await api(`/domains/${found.id}/verify`, { method: "POST" });
    const detail = await api(`/domains/${found.id}`);
    console.log(`${DOMAIN} status: ${detail.status}`);
    if (detail.status === "verified") {
      console.log(
        "\nVerified. Next: set MACROLOG_EMAIL_FROM on the functions runtime\n" +
          '  MACROLOG_EMAIL_FROM="Ignia <hello@mail.ignia.fit>"\n' +
          "then: npm --prefix functions run build && firebase deploy --only functions",
      );
    } else {
      printRecords(detail.records);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  console.error("Use --list | --create | --records | --verify");
  process.exit(1);
}

main().catch((err) => {
  console.error(`Failed: ${err.message}`);
  if (err.body) console.error(JSON.stringify(err.body, null, 2));
  process.exit(1);
});
