/**
 * Train's press-feedback wrapper, promoted to `components/Touchable.tsx` on
 * 2026-10-06 (S21 sweep) so the rest of the app's primary controls ripple on
 * Android too. Re-exported here so Train's imports keep their path.
 */
export { RIPPLE as TRAIN_RIPPLE, Touchable } from '@/components/Touchable';
