import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type V2ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type V2ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'v2-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [type]="type()"
      [class]="cssClass()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel() || null">
      <ng-content />
    </button>
  `,
  host: { class: 'inline-block' },
})
export class V2Button {
  readonly variant = input<V2ButtonVariant>('primary');
  readonly size = input<V2ButtonSize>('md');
  readonly block = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly ariaLabel = input<string | null>(null);

  protected readonly cssClass = computed(() => {
    const parts = ['v2-btn', `v2-btn--${this.variant()}`];
    if (this.size() === 'sm') parts.push('v2-btn--sm');
    if (this.size() === 'lg') parts.push('v2-btn--lg');
    if (this.block()) parts.push('v2-btn--block');
    return parts.join(' ');
  });
}
