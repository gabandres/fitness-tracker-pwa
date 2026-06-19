import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

export interface UiTab {
  id: string;
  label: string;
  icon: string;
}

@Component({
  selector: 'ui-tab-bar',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="v2-tabbar" role="tablist" aria-label="Primary">
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          role="tab"
          [id]="'v2-tab-' + tab.id"
          [class]="tab.id === activeId() ? 'v2-tab v2-tab--active' : 'v2-tab'"
          [attr.aria-selected]="tab.id === activeId()"
          (click)="select.emit(tab.id)">
          <lucide-icon [name]="tab.icon" [size]="22" />
          <span>{{ tab.label }}</span>
        </button>
      }
    </nav>
  `,
})
export class UiTabBar {
  readonly tabs = input.required<UiTab[]>();
  readonly activeId = input.required<string>();
  readonly select = output<string>();
}
