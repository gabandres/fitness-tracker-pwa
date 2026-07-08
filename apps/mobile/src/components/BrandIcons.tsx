import Svg, { Path } from 'react-native-svg';

/**
 * Official third-party sign-in marks, per Google's and Microsoft's branding
 * guidelines (their button treatments require the real logo, not text alone).
 * Kept as exact-path SVGs so they're crisp at any size and don't need image
 * assets. Apple's mark is supplied by its native AppleAuthenticationButton.
 */

/** Google "G" — the official four-colour mark (viewBox 0 0 48 48). */
export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <Path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <Path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <Path
        fill="#EA4335"
        d="M24 9.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 3.18 29.93 1 24 1 15.4 1 7.96 5.93 4.34 13.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </Svg>
  );
}

/** Microsoft — the four-square mark (viewBox 0 0 23 23). */
export function MicrosoftIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 23 23">
      <Path fill="#F25022" d="M1 1h10v10H1z" />
      <Path fill="#7FBA00" d="M12 1h10v10H12z" />
      <Path fill="#00A4EF" d="M1 12h10v10H1z" />
      <Path fill="#FFB900" d="M12 12h10v10H12z" />
    </Svg>
  );
}
