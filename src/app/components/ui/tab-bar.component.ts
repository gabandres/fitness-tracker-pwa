import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';

export interface UiTab {
  id: string;
  /** Translation key, NOT a display string. The labels used to be English
   *  literals supplied by the caller, which left the whole primary nav in
   *  English for es-PR readers — on every screen, under a fully translated
   *  app. Key-set parity checks cannot catch that: a string that never became
   *  a key is invisible to them. */
  labelKey: string;
  icon: string;
}

@Component({
  selector: 'ui-tab-bar',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <nav class="v2-tabbar" role="tablist" [attr.aria-label]="t('v2.tabs.ariaLabel')">
      @for (tab of tabs(); track tab.id) {
        <button
          type="button"
          role="tab"
          [id]="'v2-tab-' + tab.id"
          [class]="tab.id === activeId() ? 'v2-tab v2-tab--active' : 'v2-tab'"
          [attr.aria-selected]="tab.id === activeId()"
          (click)="select.emit(tab.id)">
          <lucide-icon [name]="tab.icon" [size]="22" />
          <span>{{ t(tab.labelKey) }}</span>
        </button>
      }
    </nav>
    </ng-container>
  `,
})
export class UiTabBar {
  readonly tabs = input.required<UiTab[]>();
  readonly activeId = input.required<string>();
  readonly select = output<string>();
}
