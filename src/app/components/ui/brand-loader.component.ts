import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Branded boot / loading splash — the web mirror of the mobile `BrandLoader`
 * (apps/mobile/src/components/BrandLoader.tsx): the flame ember flickers while
 * sparks rise off it and the "Ignia" wordmark sits below. Replaces the old
 * generic dual-ring spinner so the boot moment is the same brand on both
 * platforms. Used for the app-shell loading gates (initial load + "opening
 * account"). Respects prefers-reduced-motion (flame + wordmark hold still, no
 * embers). The visible wordmark is the brand; `label` is an sr-only status
 * string for assistive tech.
 */
@Component({
  selector: 'ui-brand-loader',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bl-wrap" role="status" aria-live="polite">
      <div class="bl-stage" aria-hidden="true">
        <span class="bl-ember bl-ember--1"></span>
        <span class="bl-ember bl-ember--2"></span>
        <span class="bl-ember bl-ember--3"></span>
        <span class="bl-ember bl-ember--4"></span>
        <span class="bl-ember bl-ember--5"></span>
        <svg class="bl-flame" viewBox="0 0 100 100">
          <defs>
            <radialGradient id="brandLoaderEmber" cx="50%" cy="66%" r="62%">
              <stop offset="0" stop-color="#f2b24a" />
              <stop offset="0.5" stop-color="#c0472f" />
              <stop offset="1" stop-color="#6e121a" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="#f6ede0" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e6dccb" stroke-width="4" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="#ff6a3d" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="176 120" transform="rotate(-90 50 50)" />
          <g class="bl-flame-inner" transform="translate(21 20) scale(0.58)">
            <path d="M50 15 C 62 31 64 45 60 58 C 57 70 52 78 50 87 C 48 78 43 70 40 58 C 36 45 38 31 50 15 Z" fill="url(#brandLoaderEmber)" />
            <path d="M50 41 C 56 49 57 57 54 64 C 52 70 51 74 50 79 C 49 74 48 70 46 64 C 43 57 44 49 50 41 Z" fill="#f2b24a" opacity="0.92" />
            <circle cx="50" cy="66" r="6" fill="#fdf6ec" opacity="0.85" />
          </g>
        </svg>
      </div>
      <span class="bl-word">Ignia</span>
      @if (label()) {
        <span class="sr-only">{{ label() }}</span>
      }
    </div>
  `,
  styles: [`
    .bl-wrap {
      display: flex; flex-direction: column; align-items: center;
      gap: var(--v2-space-4);
      padding: var(--v2-space-7) var(--v2-space-5);
    }
    .bl-stage {
      position: relative;
      width: 92px; height: 92px;
      display: flex; align-items: center; justify-content: center;
    }
    .bl-flame { width: 92px; height: 92px; }
    .bl-flame-inner {
      transform-box: fill-box; transform-origin: center bottom;
      animation: bl-flicker 1.3s ease-in-out infinite alternate;
    }
    .bl-word {
      font-family: var(--v2-font-display); font-size: 2rem; line-height: 1;
      letter-spacing: 0.02em; color: var(--v2-ink);
      animation: bl-rise 0.5s var(--v2-ease, ease-out) both;
    }
    /* Embers: small sparks rising off the flame base, staggered + looping. */
    .bl-ember {
      position: absolute; bottom: 30px; width: 5px; height: 5px;
      border-radius: 50%; opacity: 0;
    }
    .bl-ember--1 { left: 34px; background: var(--v2-accent); animation: bl-spark 1.6s ease-out 0s infinite; }
    .bl-ember--2 { left: 52px; background: var(--v2-sage);   animation: bl-spark 1.9s ease-out 0.26s infinite; }
    .bl-ember--3 { left: 44px; background: var(--v2-accent); animation: bl-spark 1.5s ease-out 0.52s infinite; }
    .bl-ember--4 { left: 58px; background: var(--v2-accent); animation: bl-spark 2s   ease-out 0.78s infinite; }
    .bl-ember--5 { left: 30px; background: var(--v2-sage);   animation: bl-spark 1.75s ease-out 1.04s infinite; }

    @keyframes bl-flicker {
      0%   { transform: scale(1) translateY(0); opacity: 0.94; }
      100% { transform: scale(1.05) translateY(-1px); opacity: 1; }
    }
    @keyframes bl-spark {
      0%   { opacity: 0; transform: translateY(0) scale(1); }
      12%  { opacity: 0.85; }
      100% { opacity: 0; transform: translateY(-52px) scale(0.4); }
    }
    @keyframes bl-rise {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .bl-flame-inner, .bl-word { animation: none; }
      .bl-ember { display: none; }
    }
  `],
})
export class UiBrandLoader {
  /** sr-only status text for assistive tech (the visible brand is the wordmark). */
  readonly label = input('');
}
