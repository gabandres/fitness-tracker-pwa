import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * Round account avatar. Renders the auth provider's photo (Google /
 * Microsoft populate `photoURL`) and falls back to deterministic colored
 * initials when there's no photo or the image fails to load — provider
 * photo URLs (e.g. googleusercontent) can 403, so the fallback matters.
 *
 * Presentational + clickable: it owns its own button so it can sit
 * alongside the header icon-buttons and open settings on tap.
 */
@Component({
  selector: 'ui-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [attr.aria-label]="ariaLabel()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      style="border: none; padding: 0; cursor: pointer; border-radius: 9999px; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; line-height: 1;"
      [style.background]="photoReady() ? 'transparent' : bgColor()"
      (click)="activate.emit()">
      @if (photoReady()) {
        <img
          [src]="photoUrl()"
          alt=""
          referrerpolicy="no-referrer"
          [style.width.px]="size()"
          [style.height.px]="size()"
          style="object-fit: cover; display: block;"
          (error)="imgFailed.set(true)" />
      } @else {
        <span
          style="color: #fff; font-weight: 600; letter-spacing: 0.01em;"
          [style.font-size.px]="size() * 0.42">{{ initials() }}</span>
      }
    </button>
  `,
})
export class UiAvatar {
  readonly photoUrl = input<string | null>(null);
  /** Display name or email — drives initials + the fallback color. */
  readonly name = input<string | null>(null);
  readonly ariaLabel = input<string>('Account');
  readonly size = input<number>(32);

  readonly activate = output<void>();

  protected readonly imgFailed = signal(false);

  protected readonly photoReady = computed(() => !!this.photoUrl() && !this.imgFailed());

  protected readonly initials = computed(() => {
    const raw = (this.name() ?? '').trim();
    if (!raw) return '?';
    // Email: use the local part before '@'.
    const base = raw.includes('@') ? raw.split('@')[0] : raw;
    const words = base.split(/[\s._-]+/).filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  });

  /** Deterministic, pleasant background from the name so the same account
   *  always gets the same color. */
  protected readonly bgColor = computed(() => {
    const s = this.name() ?? '';
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 45%, 45%)`;
  });
}
