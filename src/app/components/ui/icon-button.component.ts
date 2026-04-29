import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

@Component({
  selector: 'v2-icon-button',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="v2-icon-btn"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel()"
      [attr.title]="title() || ariaLabel()">
      <lucide-icon [name]="icon()" [size]="iconSize()" />
    </button>
  `,
})
export class V2IconButton {
  readonly icon = input.required<string>();
  readonly ariaLabel = input.required<string>();
  readonly title = input<string | null>(null);
  readonly iconSize = input<number>(20);
  readonly disabled = input<boolean>(false);
}
