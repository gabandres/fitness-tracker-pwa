import {
  ChangeDetectionStrategy, Component,
  inject, input, output,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService } from '../../services/auth.service';
import { ThemeChoice } from '../../utils/theme';
import { UiSheet } from '../ui/sheet.component';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';
import { SettingsPreferencesSectionComponent } from './settings-preferences-section.component';
import { SettingsDataSectionComponent } from './settings-data-section.component';
import { SettingsAboutSectionComponent } from './settings-about-section.component';

/**
 * v2 Settings sheet (Q20) — layout shell. The sheet owns the auth gate,
 * the Profile card (sign-out / redo-onboarding both route through the
 * parent App shell), and the section order; everything else lives in
 * the four section modules in this folder:
 *
 *   preferences — language, reminders, appearance, units
 *   membership  — subscription, referral, public profile
 *   data        — webhook, CSV export, deletion pointer
 *   about       — feedback, build/updates, legal
 *
 * Card order matches the pre-split sheet exactly.
 */
@Component({
  selector: 'app-settings-sheet',
  standalone: true,
  imports: [
    TranslocoDirective,
    LucideAngularModule,
    UiSheet,
    UiCard,
    UiButton,
    SettingsPreferencesSectionComponent,
    SettingsDataSectionComponent,
    SettingsAboutSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet labelledBy="settings-v2-title" (close)="requestClose()">
      <h1 id="settings-v2-title" class="v2-h1 mb-1">{{ t('settings.titleLead') }}</h1>
      <p class="v2-caption mb-5">{{ t('settings.sectionLabel') }}</p>

      @if (auth.user(); as u) {

      <!-- Profile -->
      <ui-card variant="default" id="settings-profile" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.profile.section') }}</h3>
        <p class="v2-caption mb-3">
          {{ t('settings.profile.signedInAs') }}
          <span class="v2-num" style="color: var(--v2-ink); font-size: 0.8125rem;">{{ u.email }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <ui-button variant="secondary" size="sm" (click)="onRedoOnboarding()">
            <lucide-icon name="pencil" [size]="14" />
            {{ t('settings.profile.redoOnboarding') }}
          </ui-button>
          <ui-button variant="ghost" size="sm" (click)="signOut()">
            {{ t('settings.profile.signOut') }}
          </ui-button>
        </div>
      </ui-card>

      <app-settings-preferences-section
        [themeChoice]="themeChoice()"
        (themeSelect)="themeSelect.emit($event)" />

      <app-settings-data-section />

      <app-settings-about-section (closeSheet)="requestClose()" />

      } @else {
        <p class="v2-caption">{{ t('settings.signInFirst') }}</p>
      }
    </ui-sheet>
    </ng-container>
  `,
})
export class SettingsSheetComponent {
  protected readonly auth = inject(AuthService);

  readonly darkMode = input.required<boolean>();
  readonly themeChoice = input.required<ThemeChoice>();

  readonly close = output<void>();
  readonly redoOnboarding = output<void>();
  readonly themeSelect = output<ThemeChoice>();

  // Escape handling lives in <ui-sheet>; no override needed.

  protected requestClose(): void { this.close.emit(); }

  protected onRedoOnboarding(): void {
    this.redoOnboarding.emit();
    this.requestClose();
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.requestClose();
  }
}
