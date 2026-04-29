import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type V2CardVariant = 'default' | 'flat' | 'raised' | 'accent';

@Component({
  selector: 'v2-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class]': 'cssClass()',
  },
})
export class V2Card {
  readonly variant = input<V2CardVariant>('default');

  protected readonly cssClass = computed(() => {
    const parts = ['v2-card'];
    const v = this.variant();
    if (v !== 'default') parts.push(`v2-card--${v}`);
    return parts.join(' ');
  });
}
