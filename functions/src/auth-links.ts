/**
 * Firebase mints action links (password reset, email verification) on the
 * project's default auth domain — `<project>.firebaseapp.com`. That host is
 * fine functionally and poor everywhere else: it does not match the brand in
 * the message, it does not match the sending domain, and a link whose host a
 * recipient has never heard of is a phishing shape.
 *
 * `ignia.fit` serves the SAME handler. Firebase Hosting exposes the OOB
 * handler at `/__/auth/action` on every site linked to the project, and the
 * response body at `https://ignia.fit/__/auth/action` was compared against
 * the firebaseapp.com one on 2026-08-15: byte-identical, both booting
 * `fireauth.oob.OobHandler`. The action code is validated against the project,
 * not the host, so swapping the origin changes nothing about how the code is
 * consumed.
 *
 * This is deliberately conservative: an unexpected host is passed through
 * untouched rather than rewritten. A branded link is a nice-to-have; a
 * working link is not, and a wrong guess here breaks account recovery.
 */

/** Hosts we are willing to rewrite. Anything else passes through. */
const REWRITABLE = /^[a-z0-9-]+\.(firebaseapp\.com|web\.app)$/i;

const BRANDED_ORIGIN = process.env.MACROLOG_AUTH_ACTION_ORIGIN || "https://ignia.fit";

/**
 * Rebrands the host of a Firebase-generated action link, preserving the path
 * and every query parameter (the `oobCode` above all). Returns the input
 * unchanged if it is not a URL, or not on a host we recognise.
 */
export function brandActionLink(link: string): string {
  try {
    const url = new URL(link);
    if (!REWRITABLE.test(url.hostname)) return link;
    const branded = new URL(BRANDED_ORIGIN);
    url.protocol = branded.protocol;
    url.hostname = branded.hostname;
    url.port = branded.port;
    return url.toString();
  } catch {
    // Not parseable as a URL — hand back exactly what Firebase gave us.
    return link;
  }
}
