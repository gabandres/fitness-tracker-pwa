import { signal } from '@angular/core';

/** Returns a signal that tracks whether a CSS media query matches. */
export function mediaSignal(query: string) {
  const mql = window.matchMedia(query);
  const s = signal(mql.matches);
  mql.addEventListener('change', (e) => s.set(e.matches));
  return s;
}
