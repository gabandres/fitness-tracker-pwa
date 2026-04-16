import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

export type MobileTab = 'log' | 'insights' | 'body';

const TABS: { id: MobileTab; labelKey: string }[] = [
  { id: 'log', labelKey: 'tabs.log' },
  { id: 'insights', labelKey: 'tabs.insights' },
  { id: 'body', labelKey: 'tabs.body' },
];

@Component({
  selector: 'app-mobile-tabs',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <nav class="fixed bottom-0 inset-x-0 z-40 lg:hidden"
        role="tablist"
        [attr.aria-label]="t('tabs.ariaLabel')"
        style="background: var(--color-paper); border-top: 1px solid var(--color-rule);
               padding-bottom: env(safe-area-inset-bottom)">
        <div class="flex h-14 max-w-[560px] mx-auto">
          @for (tab of tabs; track tab.id) {
            <button
              role="tab"
              [id]="'tab-' + tab.id"
              [attr.aria-selected]="activeTab() === tab.id"
              [attr.aria-controls]="'tabpanel-' + tab.id"
              [attr.tabindex]="activeTab() === tab.id ? 0 : -1"
              (click)="select(tab.id)"
              (keydown)="onKeydown($event)"
              class="tab-bar-btn flex-1 flex items-center justify-center">
              {{ t(tab.labelKey) }}
            </button>
          }
        </div>
      </nav>
    </ng-container>
  `,
})
export class MobileTabsComponent {
  readonly activeTab = input.required<MobileTab>();
  readonly tabChange = output<MobileTab>();

  protected readonly tabs = TABS;

  protected select(id: MobileTab): void {
    this.tabChange.emit(id);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const ids = TABS.map((t) => t.id);
    const current = ids.indexOf(this.activeTab());
    let next: number | null = null;

    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % ids.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + ids.length) % ids.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = ids.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.tabChange.emit(ids[next]);
    // Move focus to the newly-selected tab button
    (document.getElementById('tab-' + ids[next]) as HTMLElement | null)?.focus();
  }
}
