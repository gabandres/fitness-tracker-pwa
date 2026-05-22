import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type UiCardVariant = 'default' | 'flat' | 'raised' | 'accent';

@Component({
  selector: 'ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    '[class]': 'cssClass()',
  },
})
export class UiCard {
  readonly variant = input<UiCardVariant>('default');

  protected readonly cssClass = computed(() => {
    const parts = ['ui-card'];
    const v = this.variant();
    if (v !== 'default') parts.push(`v2-card--${v}`);
    return parts.join(' ');
  });
}
