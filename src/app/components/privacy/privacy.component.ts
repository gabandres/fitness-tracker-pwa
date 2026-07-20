import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { TranslationService } from '../../services/translation.service';
import { extractErrorCode } from '../../models/error-codes';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

type DeleteStatus = 'idle' | 'confirming' | 'deleting' | 'error';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [TranslocoDirective, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      @if (showAuthoritativeBanner()) {
        <ui-card variant="flat" class="block mb-4">
          <p class="v2-caption" style="color: var(--v2-accent);">
            {{ t('legal.authoritativeBanner') }}
          </p>
        </ui-card>
      }

      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        {{ t('privacy.backLink') }}
      </a>

      <p class="v2-caption mt-6" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('privacy.section') }}
      </p>
      <h1 class="v2-h1 v2-display mt-1">
        {{ t('privacy.titleLead') }}
        <span style="color: var(--v2-accent);">{{ t('privacy.titleEm') }}</span>
      </h1>
      <p class="v2-caption mt-3">{{ t('privacy.lastUpdated') }}</p>

      <div class="mt-8 v2-prose">
        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.storeHeading') }}</h2>
        <p>{{ t('privacy.storeBody1') }}</p>
        <p>{{ t('privacy.storeBody2') }}</p>

        <!-- Apple requires HealthKit data handling to be disclosed in the
             privacy policy (5.1.3); the mobile app ships Health read+write. -->
        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.healthHeading') }}</h2>
        <p>{{ t('privacy.healthBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.geminiHeading') }}</h2>
        <p>{{ t('privacy.geminiIntro') }}</p>
        <ul>
          <li [innerHTML]="t('privacy.geminiPhoto')"></li>
          <li [innerHTML]="t('privacy.geminiCoach')"></li>
        </ul>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.dontHeading') }}</h2>
        <ul>
          <li>{{ t('privacy.dontSell') }}</li>
          <li>{{ t('privacy.dontAds') }}</li>
          <li>{{ t('privacy.dontTrain') }}</li>
          <li>{{ t('privacy.dontShare') }}</li>
        </ul>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.callHeading') }}</h2>
        <ul>
          <li [innerHTML]="t('privacy.callExport')"></li>
          <li [innerHTML]="t('privacy.callFullExport')"></li>
          <li [innerHTML]="t('privacy.callDelete')"></li>
          <li [innerHTML]="t('privacy.callQuestions')"></li>
        </ul>

        @if (auth.isSignedIn()) {
          <div class="mt-4 flex items-center gap-3 flex-wrap">
            <ui-button variant="secondary" size="sm"
              (click)="downloadFullExport()"
              [disabled]="exportStatus() === 'running'">
              {{ exportStatus() === 'running' ? t('privacy.exportRunning') : t('privacy.exportButton') }}
            </ui-button>
            @if (exportStatus() === 'error') {
              <span class="v2-caption" role="alert" style="color: var(--v2-danger);">{{ exportError() }}</span>
            }
          </div>
        }

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.gdprHeading') }}</h2>
        <p>{{ t('privacy.gdprBody') }}</p>
        <ul>
          <li>{{ t('privacy.gdprAccess') }}</li>
          <li>{{ t('privacy.gdprRectify') }}</li>
          <li>{{ t('privacy.gdprErase') }}</li>
          <li>{{ t('privacy.gdprPortable') }}</li>
          <li>{{ t('privacy.gdprRestrict') }}</li>
          <li>{{ t('privacy.gdprObject') }}</li>
        </ul>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.ccpaHeading') }}</h2>
        <p>{{ t('privacy.ccpaBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.jurisdictionHeading') }}</h2>
        <p [innerHTML]="t('privacy.jurisdictionBody')"></p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('privacy.medicalHeading') }}</h2>
        <p>{{ t('privacy.medicalBody') }}</p>
      </div>

      <!-- Danger zone: account deletion. Also anchor-linked as
           /privacy#delete from the settings sheet. -->
      <ui-card variant="default" class="block mt-12 scroll-mt-24"
        id="delete"
        style="border-color: var(--v2-danger);">
        <p class="v2-caption mb-2" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-danger); font-weight: 600;">
          {{ t('privacy.dangerSection') }}
        </p>

        @if (!auth.isSignedIn()) {
          <p class="v2-caption">{{ t('privacy.signInFirst') }}</p>
        } @else if (deleteStatus() === 'idle') {
          <p class="v2-body mb-3">
            {{ t('privacy.confirmEmail', { email: auth.user()?.email }) }}
          </p>
          <ui-button variant="destructive" size="sm" (click)="deleteStatus.set('confirming')">
            {{ t('privacy.deleteButton') }}
          </ui-button>
        } @else if (deleteStatus() === 'confirming') {
          <p class="v2-body mb-3">
            {{ t('privacy.typeDeletePrefix') }}
            <span class="v2-num" style="font-weight: 600;">{{ t('privacy.typeDeleteWord') }}</span>
            {{ t('privacy.typeDeleteSuffix') }}
          </p>
          <div class="flex items-baseline gap-2 flex-wrap">
            <input type="text"
              [value]="confirmInput()"
              (input)="confirmInput.set($any($event.target).value)"
              [placeholder]="t('privacy.deletePlaceholder')"
              class="v2-field"
              style="max-width: 200px;" />
            <ui-button variant="destructive" size="sm"
              (click)="confirmDelete()"
              [disabled]="confirmInput().trim().toLowerCase() !== t('privacy.typeDeleteWord').toLowerCase()"
              [ariaLabel]="t('privacy.confirmAria')">
              {{ t('privacy.confirm') }}
            </ui-button>
            <ui-button variant="ghost" size="sm" (click)="cancelDelete()">
              {{ t('privacy.cancel') }}
            </ui-button>
          </div>
        } @else if (deleteStatus() === 'deleting') {
          <p class="v2-caption">{{ t('privacy.erasing') }}</p>
        } @else if (deleteStatus() === 'error') {
          <p class="v2-caption" role="alert" style="color: var(--v2-danger);">{{ errorMsg() }}</p>
          <ui-button variant="ghost" size="sm" class="mt-2" (click)="deleteStatus.set('idle')">
            {{ t('privacy.tryAgain') }}
          </ui-button>
        }
      </ui-card>
    </section>
    </ng-container>
  `,
})
export class PrivacyComponent {
  protected readonly auth = inject(AuthService);
  private readonly firebase = inject(LEDGER_PORT);
  private readonly translation = inject(TranslationService);

  protected readonly deleteStatus = signal<DeleteStatus>('idle');
  protected readonly confirmInput = signal('');
  protected readonly errorMsg = signal('');
  protected readonly exportStatus = signal<'idle' | 'running' | 'error'>('idle');
  protected readonly exportError = signal('');

  protected readonly showAuthoritativeBanner = computed(
    () => this.translation.language() === 'es-PR',
  );

  protected async downloadFullExport(): Promise<void> {
    this.exportStatus.set('running');
    this.exportError.set('');
    try {
      const data = await this.firebase.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ignia-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.exportStatus.set('idle');
    } catch (err) {
      this.exportStatus.set('error');
      const code = extractErrorCode(err);
      if (code) {
        const details = (err as { details?: Record<string, unknown> }).details ?? {};
        this.exportError.set(this.translation.tError(code, details));
      } else {
        this.exportError.set(err instanceof Error ? err.message : this.translation.t('privacy.errorFallback'));
      }
    }
  }

  protected cancelDelete(): void {
    this.deleteStatus.set('idle');
    this.confirmInput.set('');
  }

  protected async confirmDelete(): Promise<void> {
    const confirmWord = this.translation.t('privacy.typeDeleteWord').toLowerCase();
    if (this.confirmInput().trim().toLowerCase() !== confirmWord) return;
    this.deleteStatus.set('deleting');
    this.errorMsg.set('');

    try {
      await this.firebase.deleteMyAccount();
      // Cloud Function deletes Firestore + Auth user. Sign-out is automatic
      // once the auth user is gone, but we force it to unblock the UI.
      await this.auth.signOut();
      window.location.assign('/');
    } catch (err) {
      this.deleteStatus.set('error');
      const code = extractErrorCode(err);
      if (code) {
        const details = (err as { details?: Record<string, unknown> }).details ?? {};
        this.errorMsg.set(this.translation.tError(code, details));
      } else {
        this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('privacy.errorFallback'));
      }
    }
  }
}
