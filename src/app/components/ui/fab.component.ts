import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'v2-fab',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="v2-fab"
      (click)="click.emit()"
      [attr.aria-label]="ariaLabel()">
      <lucide-icon [name]="icon()" [size]="24" />
    </button>
  `,
})
export class V2Fab {
  readonly icon = input<string>('plus');
  readonly ariaLabel = input.required<string>();
  readonly click = output<void>();
}
