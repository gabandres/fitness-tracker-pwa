import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type UiRingTone = 'accent' | 'sage' | 'warn' | 'danger';

/**
 * SVG progress ring. Renders a track + fill arc whose length is
 * `clamp(0, value/target, 1) * circumference`. When over target,
 * caller should switch tone to 'warn' or 'danger' to signal it.
 *
 * Default size 120px stroke 12px → comfortable for the Today hero
 * dual-ring layout. Override via inputs for sparklines / micro-rings.
 */
@Component({
  selector: 'ui-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="v2-ring" [style.width.px]="size()" [style.height.px]="size()">
      <svg
        class="v2-ring__svg"
        [attr.width]="size()"
        [attr.height]="size()"
        [attr.viewBox]="'0 0 ' + size() + ' ' + size()"
        [attr.role]="ariaLabel() ? 'img' : null"
        [attr.aria-label]="ariaLabel() || null"
        [attr.aria-hidden]="ariaLabel() ? null : 'true'">
        <circle
          class="v2-ring__track"
          [attr.cx]="size() / 2"
          [attr.cy]="size() / 2"
          [attr.r]="radius()"
          [attr.stroke-width]="stroke()" />
        <circle
          [class]="fillClass()"
          [attr.cx]="size() / 2"
          [attr.cy]="size() / 2"
          [attr.r]="radius()"
          [attr.stroke-width]="stroke()"
          [attr.stroke-dasharray]="circumference()"
          [attr.stroke-dashoffset]="dashOffset()" />
      </svg>
      <div class="v2-ring__center">
        <ng-content />
      </div>
    </div>
  `,
})
export class UiRing {
  readonly value = input<number>(0);
  readonly target = input<number>(100);
  readonly size = input<number>(120);
  readonly stroke = input<number>(12);
  readonly tone = input<UiRingTone>('accent');
  readonly ariaLabel = input<string>('progress');

  protected readonly radius = computed(() => (this.size() - this.stroke()) / 2);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly progress = computed(() => {
    const t = this.target();
    if (t <= 0) return 0;
    return Math.min(1, Math.max(0, this.value() / t));
  });
  protected readonly dashOffset = computed(
    () => this.circumference() * (1 - this.progress()),
  );
  protected readonly fillClass = computed(() => {
    const t = this.tone();
    return t === 'accent' ? 'v2-ring__fill' : `v2-ring__fill v2-ring__fill--${t}`;
  });
}
