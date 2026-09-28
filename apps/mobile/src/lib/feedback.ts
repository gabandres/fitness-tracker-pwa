import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { Timestamp, addDoc, collection } from 'firebase/firestore';
import { db } from './firebase';

/**
 * In-app feedback — the write half.
 *
 * One document per report under `users/{uid}/feedback/{autoId}`. Create-only
 * in `firestore.rules`: the reporter cannot read, edit or delete what they
 * sent. That is deliberate rather than an oversight — there is no in-app
 * inbox, and a readable copy would imply a thread that does not exist.
 *
 * A `onDocumentCreated` trigger emails the owner on each write
 * (`functions/src/feedback-notify.ts`), so this needs no polling and no
 * Cloud Scheduler slot — the free tier's three jobs are already spent.
 */
export type FeedbackCategory = 'bug' | 'idea' | 'confusing' | 'other';

/** Mirrors the cap in `firestore.rules`. The rule is the control; this is the
 *  courtesy that stops someone losing a long message to a rejected write. */
export const FEEDBACK_MAX_LENGTH = 4000;

export interface FeedbackDraft {
  message: string;
  /** `null` when the reporter chose no chip. Stored as `'none'` so the rules
   *  can validate a closed set rather than an absent field. */
  category: FeedbackCategory | null;
}

export async function sendFeedback(uid: string, draft: FeedbackDraft): Promise<void> {
  const message = draft.message.trim().slice(0, FEEDBACK_MAX_LENGTH);
  if (message.length === 0) return;
  await addDoc(collection(db, 'users', uid, 'feedback'), {
    message,
    category: draft.category ?? 'none',
    createdAt: Timestamp.now(),
    // Attached silently so a report can be reproduced without asking the
    // reporter what they were running. Version, platform and language only —
    // the composer says so in as many words.
    appVersion: Application.nativeApplicationVersion ?? 'unknown',
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    locale: getLocale(),
  });
}

/** Mirrors the `locale` cap in `firestore.rules`. */
export const FEEDBACK_LOCALE_MAX_LENGTH = 20;

/**
 * Reduce a BCP 47 tag to its language-region base (`pt-BR`, `es-419`, `en`),
 * capped at {@link FEEDBACK_LOCALE_MAX_LENGTH}. A resolved device locale can
 * carry script, variant and `-u-` extension subtags (`zh-Hant-TW-u-ca-chinese`),
 * which blew the rules cap and rejected the whole report. Exported for the test.
 */
export function feedbackLocaleTag(tag: string | undefined | null): string {
  const parts = (tag ?? '').trim().split(/[-_]/).filter(Boolean);
  const language = parts[0]?.toLowerCase();
  if (!language || !/^[a-z]{2,8}$/.test(language)) return 'en';
  // First region-shaped subtag (ISO 3166 alpha-2 or UN M.49 digits), skipping
  // a 4-letter script. Stop at a singleton (`u`, `x`) — extensions follow it.
  let region: string | undefined;
  for (const p of parts.slice(1)) {
    if (p.length === 1) break;
    if (/^[A-Za-z]{2}$/.test(p) || /^[0-9]{3}$/.test(p)) { region = p.toUpperCase(); break; }
  }
  return (region ? `${language}-${region}` : language).slice(0, FEEDBACK_LOCALE_MAX_LENGTH);
}

/** The app's active locale, read off the same source the UI uses. Kept here
 *  rather than passed in so every caller reports it the same way. */
function getLocale(): string {
  // `useT` resolves from `profile.preferredLocale`, which the composer does
  // not hold; the device locale is the honest fallback and is what decides
  // which language the reporter was actually reading.
  return feedbackLocaleTag(Intl.DateTimeFormat().resolvedOptions().locale);
}
