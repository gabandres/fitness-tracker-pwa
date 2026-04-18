import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { EntryFormManager } from '../../services/entry-form-manager.service';

@Component({
  selector: 'app-mobile-fab',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (form.mode() === 'view') {
        <button type="button"
          (click)="addEntry()"
          [attr.aria-label]="t('fab.addEntryAria')"
          class="fab-btn md:hidden fixed right-5 z-40"
          style="bottom: calc(4rem + env(safe-area-inset-bottom))">
          <span aria-hidden="true" class="fab-plus">+</span>
        </button>
      }
    </ng-container>
  `,
})
export class MobileFabComponent {
  protected readonly form = inject(EntryFormManager);

  protected addEntry(): void {
    this.form.startAdd();
    this.form.requestLogFocus();
  }
}
