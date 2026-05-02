/**
 * One-tap share helper. Prefers the native Web Share sheet on mobile
 * (which gives the user iMessage / WhatsApp / Discord etc. directly);
 * falls back to clipboard copy on desktop and on browsers that don't
 * implement navigator.share. Returns the channel used so callers can
 * decide whether to flash a "Copied" confirmation.
 *
 * Why this matters for acquisition: the highest-converting acquisition
 * channel for a fitness app is a friend sharing it in a DM ("here, use
 * this for your macros"). The friction floor for that share is one tap
 * — not "open browser, copy URL, paste into chat".
 */

export type ShareChannel = 'native' | 'clipboard' | 'failed';

export interface ShareOpts {
  title?: string;
  text?: string;
  url: string;
}

export async function share(opts: ShareOpts): Promise<ShareChannel> {
  // Native share sheet (mobile Safari, Chrome Android, modern desktop
  // Chrome / Edge with the share API enabled). Throws AbortError when
  // the user dismisses the sheet — treat as success since the user
  // intended the share, just chose not to follow through.
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(opts);
      return 'native';
    } catch (err) {
      // AbortError = user dismissed. Anything else = real failure;
      // fall through to the clipboard path.
      const name = (err as { name?: string })?.name;
      if (name === 'AbortError') return 'native';
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(opts.url);
      return 'clipboard';
    } catch {
      // Clipboard write may be blocked when the call isn't a user
      // gesture (rare — buttons usually count) or in a sandboxed iframe.
    }
  }

  return 'failed';
}
