import { Flame } from '@/components/Flame';

/**
 * The Ignia brand mark — a flickering ember (coral heat-ring + flame + core).
 * Hero for sign-in / onboarding. The animated splash/loader (BrandLoader) wraps
 * the same {@link Flame} glyph with rising embers + wordmark, so the fire is one
 * consistent identity across the app.
 */
export function BrandMark({ size = 96 }: { size?: number }) {
  return <Flame size={size} flicker />;
}
