import {
  ChangeDetectionStrategy, Component,
  computed, inject, output, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { SwUpdate } from '@angular/service-worker';
import { TranslationService } from '../../services/translation.service';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Settings · about section — the Feedback, About/Updates (build label +
 * manual SW update check), and Legal cards. Emits `closeSheet` after
 * launching the feedback mailto so the sheet gets out of the way.
 */
@Component({
  selector: 'app-settings-about-section',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <!-- Feedback -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.feedback.section') }}</h3>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.feedback.label') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.feedback.desc') }}</p>
          </div>
          <ui-button variant="secondary" size="sm" (click)="sendFeedback()"
            [ariaLabel]="t('settings.feedback.aria')">
            {{ t('settings.feedback.send') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- About / Updates -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('v2.settings.about') }}</h3>
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('v2.settings.appVersion') }}</div>
            <p class="v2-caption mt-0.5">
              {{ t('v2.settings.build') }} <span class="v2-num" style="color: var(--v2-ink); font-size: 0.75rem;">{{ buildLabel() }}</span>
            </p>
            @if (updateMsg(); as msg) {
              <p class="v2-caption mt-1" role="status" aria-live="polite"
                [style.color]="msg.tone === 'sage' ? 'var(--v2-sage)' : msg.tone === 'accent' ? 'var(--v2-accent)' : 'var(--v2-ink-muted)'">
                {{ msg.text }}
              </p>
            }
            @if (updateAvailable()) {
              <!-- Inline reload — the global SwUpdate dialog renders
                   behind this sheet (same z-stack), so an in-sheet
                   action is the only way the user can discover the
                   update without first closing settings. Activates
                   the SW + reloads. -->
              <div class="mt-2">
                <ui-button variant="primary" size="sm" (click)="reloadForUpdate()">
                  {{ t('v2.settings.reloadNow') }}
                </ui-button>
              </div>
            }
          </div>
          <ui-button variant="secondary" size="sm" (click)="checkForUpdate()" [disabled]="checkingUpdate()">
            <lucide-icon name="check" [size]="14" />
            {{ checkingUpdate() ? t('v2.settings.checking') : t('v2.settings.checkForUpdates') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- Legal -->
      <ui-card variant="flat" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.legal.section') }}</h3>
        <p class="v2-caption">
          <a href="/privacy" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.privacy') }}</a>
          &middot;
          <a href="/terms" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.terms') }}</a>
          &middot;
          <a href="/changelog" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('v2.settings.changelog') }}</a>
          &middot;
          <a href="mailto:gabrielandresbermudez&#64;gmail.com" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.contact') }}</a>
        </p>
      </ui-card>
    </ng-container>
  `,
})
export class SettingsAboutSectionComponent {
  private readonly translation = inject(TranslationService);
  private readonly swUpdate = inject(SwUpdate);

  /** Emitted after the feedback mailto launches, so the sheet closes. */
  readonly closeSheet = output<void>();

  protected readonly checkingUpdate = signal(false);
  protected readonly updateMsg = signal<{ text: string; tone: 'sage' | 'accent' | 'muted' } | null>(null);
  /** Latched when the manual check installs a new version. Drives the
   *  inline Reload button — kept separate from updateMsg so the
   *  message can clear without hiding the affordance. */
  protected readonly updateAvailable = signal(false);

  /** Show abbreviated build SHA, or "dev" in non-prod builds. The
   *  global is injected at build time by `scripts/sentry-release.mjs`. */
  protected readonly buildLabel = computed(() => {
    const v = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__;
    if (!v) return 'dev';
    return v.length > 8 ? v.substring(0, 8) : v;
  });

  /** Manual update check from the settings sheet. The 60s background
   *  poll usually catches new versions, but this is the explicit
   *  affordance for users on long-lived tabs. Banner from app.ts
   *  fires automatically on VERSION_READY. */
  protected async checkForUpdate(): Promise<void> {
    if (this.checkingUpdate()) return;
    this.checkingUpdate.set(true);
    this.updateMsg.set(null);
    try {
      if (!this.swUpdate.isEnabled) {
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateUnavailable'), tone: 'muted' });
        return;
      }
      // SwUpdate.checkForUpdate() can hang indefinitely when no service
      // worker controls the page yet (lazy registerWhenStable:30000) or the
      // network stalls, leaving the button stuck on "Checking…". Race it
      // against a timeout so the control always resolves to a message.
      const found = await Promise.race([
        this.swUpdate.checkForUpdate(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('update-check-timeout')), 15_000),
        ),
      ]);
      if (found) {
        this.updateAvailable.set(true);
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateFound'), tone: 'accent' });
      } else {
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateLatest'), tone: 'sage' });
      }
    } catch {
      // Timeout or SW error — show the friendly "Could not check." rather
      // than leaking an internal message, and never leave the button stuck.
      this.updateMsg.set({ text: this.translation.t('v2.settings.updateError'), tone: 'muted' });
    } finally {
      this.checkingUpdate.set(false);
    }
  }

  /** Inline reload from the settings sheet. activateUpdate swaps the
   *  waiting SW into control; location.reload then loads the fresh
   *  shell. Try/finally so a thrown activateUpdate (rare but possible
   *  with no waiting worker) still triggers the reload — at worst the
   *  user reloads against the same version. */
  protected async reloadForUpdate(): Promise<void> {
    try { await this.swUpdate.activateUpdate(); }
    finally { document.location.reload(); }
  }

  protected sendFeedback(): void {
    const subject = this.translation.t('settings.feedback.emailSubject');
    const whatHappened = this.translation.t('settings.feedback.whatHappened');
    const expected = this.translation.t('settings.feedback.expected');
    const build = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev';
    const body = [
      whatHappened, '', '', expected, '', '',
      '---',
      `Build: ${build}`,
      `Path : ${window.location.pathname}`,
      `Agent: ${navigator.userAgent}`,
      `Time : ${new Date().toISOString()}`,
    ].join('\n');
    const href = `mailto:gabrielandresbermudez@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    this.closeSheet.emit();
  }
}
