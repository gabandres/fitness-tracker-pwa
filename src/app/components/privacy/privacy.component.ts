import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { TranslationService } from '../../services/translation.service';
import { extractErrorCode } from '../../models/error-codes';

type DeleteStatus = 'idle' | 'confirming' | 'deleting' | 'error';

@Component({
  selector: 'app-privacy',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      @if (showAuthoritativeBanner()) {
        <div class="mb-4 specimen px-3 py-2" style="border-color: var(--color-gold)">
          <span class="crop-bl" style="border-color: var(--color-gold)"></span>
          <span class="crop-br" style="border-color: var(--color-gold)"></span>
          <p class="caption text-[11px]" style="color: var(--color-gold)">
            {{ t('legal.authoritativeBanner') }}
          </p>
        </div>
      }

      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        {{ t('privacy.backLink') }}
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">{{ t('privacy.stamp') }}</span>
        <span class="data-label">{{ t('privacy.section') }}</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        {{ t('privacy.titleLead') }}<br/><em class="text-blood">{{ t('privacy.titleEm') }}</em>
      </h1>
      <p class="caption mt-3 text-xs">{{ t('privacy.lastUpdated') }}</p>

      <div class="mt-8 prose-field text-ink leading-relaxed">
        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.storeHeading') }}</h2>
        <p>{{ t('privacy.storeBody1') }}</p>
        <p>{{ t('privacy.storeBody2') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.geminiHeading') }}</h2>
        <p>{{ t('privacy.geminiIntro') }}</p>
        <ul>
          <li [innerHTML]="t('privacy.geminiPhoto')"></li>
          <li [innerHTML]="t('privacy.geminiCoach')"></li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.dontHeading') }}</h2>
        <ul>
          <li>{{ t('privacy.dontSell') }}</li>
          <li>{{ t('privacy.dontAds') }}</li>
          <li>{{ t('privacy.dontTrain') }}</li>
          <li>{{ t('privacy.dontShare') }}</li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.callHeading') }}</h2>
        <ul>
          <li [innerHTML]="t('privacy.callExport')"></li>
          <li [innerHTML]="t('privacy.callFullExport')"></li>
          <li [innerHTML]="t('privacy.callDelete')"></li>
          <li [innerHTML]="t('privacy.callQuestions')"></li>
        </ul>

        @if (auth.isSignedIn()) {
          <div class="mt-4 flex items-center gap-3">
            <button type="button"
              (click)="downloadFullExport()"
              [disabled]="exportStatus() === 'running'"
              class="tag-btn text-[11px]">
              @if (exportStatus() === 'running') {
                <span>{{ t('privacy.exportRunning') }}</span>
              } @else {
                <span>{{ t('privacy.exportButton') }}</span>
              }
            </button>
            @if (exportStatus() === 'error') {
              <span class="font-mono text-[11px] text-blood">✕ {{ exportError() }}</span>
            }
          </div>
        }

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.gdprHeading') }}</h2>
        <p>{{ t('privacy.gdprBody') }}</p>
        <ul>
          <li>{{ t('privacy.gdprAccess') }}</li>
          <li>{{ t('privacy.gdprRectify') }}</li>
          <li>{{ t('privacy.gdprErase') }}</li>
          <li>{{ t('privacy.gdprPortable') }}</li>
          <li>{{ t('privacy.gdprRestrict') }}</li>
          <li>{{ t('privacy.gdprObject') }}</li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.ccpaHeading') }}</h2>
        <p>{{ t('privacy.ccpaBody') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.jurisdictionHeading') }}</h2>
        <p [innerHTML]="t('privacy.jurisdictionBody')"></p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('privacy.medicalHeading') }}</h2>
        <p>{{ t('privacy.medicalBody') }}</p>
      </div>

      <!-- Danger zone: account deletion. Also anchor-linked as
           /privacy#delete from the settings sheet. -->
      <div id="delete" class="mt-12 specimen px-5 py-5 relative scroll-mt-24" style="border-color: var(--color-blood)">
        <span class="crop-bl" style="border-color: var(--color-blood)"></span>
        <span class="crop-br" style="border-color: var(--color-blood)"></span>

        <div class="flex items-center gap-3 mb-2">
          <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-blood); color: var(--color-blood)">{{ t('privacy.dangerStamp') }}</span>
          <span class="data-label">{{ t('privacy.dangerSection') }}</span>
        </div>

        @if (!auth.isSignedIn()) {
          <p class="caption text-xs">{{ t('privacy.signInFirst') }}</p>
        } @else if (deleteStatus() === 'idle') {
          <p class="font-sans text-sm text-ink leading-relaxed mb-3">
            {{ t('privacy.confirmEmail', { email: auth.user()?.email }) }}
          </p>
          <button type="button" (click)="deleteStatus.set('confirming')"
            class="tag-btn text-blood border-blood/60">
            {{ t('privacy.deleteButton') }}
          </button>
        } @else if (deleteStatus() === 'confirming') {
          <p class="font-sans text-sm text-ink leading-relaxed mb-3">
            {{ t('privacy.typeDeletePrefix') }} <span class="font-mono font-semibold">{{ t('privacy.typeDeleteWord') }}</span> {{ t('privacy.typeDeleteSuffix') }}
          </p>
          <div class="flex items-baseline gap-2">
            <input type="text"
              [value]="confirmInput()"
              (input)="confirmInput.set($any($event.target).value)"
              [placeholder]="t('privacy.deletePlaceholder')"
              class="field-input text-sm flex-1 max-w-[200px]" />
            <button type="button" (click)="confirmDelete()"
              [disabled]="confirmInput().trim().toLowerCase() !== t('privacy.typeDeleteWord').toLowerCase()"
              class="tag-btn text-blood border-blood/60"
              [attr.aria-label]="t('privacy.confirmAria')">
              {{ t('privacy.confirm') }}
            </button>
            <button type="button" (click)="cancelDelete()" class="tag-btn">{{ t('privacy.cancel') }}</button>
          </div>
        } @else if (deleteStatus() === 'deleting') {
          <p class="caption text-xs">{{ t('privacy.erasing') }}</p>
        } @else if (deleteStatus() === 'error') {
          <p class="font-mono text-xs text-blood">✕ {{ errorMsg() }}</p>
          <button type="button" (click)="deleteStatus.set('idle')" class="tag-btn text-[11px] mt-2">{{ t('privacy.tryAgain') }}</button>
        }
      </div>
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
      a.download = `macrolog-export-${stamp}.json`;
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
