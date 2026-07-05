import {
  ChangeDetectionStrategy, Component,
  computed, inject, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { CallableGateway } from '../../services/callable.gateway';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { SubscribeComponent } from '../subscribe/subscribe.component';
import { buildReferralLink } from '../../utils/referral';
import { share } from '../../utils/share';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Settings · membership section — the Subscription, Refer-a-friend, and
 * Public-profile cards. Owns the referral share/copy flow and the
 * `claimPublicSlug` / `releasePublicSlug` callable round-trips.
 */
@Component({
  selector: 'app-settings-membership-section',
  standalone: true,
  imports: [TranslocoDirective, UiCard, UiButton, SubscribeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <!-- Subscription -->
      <ui-card variant="default" id="settings-subscription" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.subscription.section') }}</h3>
        <app-subscribe />
      </ui-card>

      <!-- Refer a friend -->
      @if (referralLink(); as link) {
        <ui-card variant="default" class="block mb-3">
          <h3 class="v2-h3 mb-2">{{ t('settings.referral.section') }}</h3>
          <p class="v2-body-soft mb-3" style="font-size: 0.875rem;">
            {{ t('settings.referral.body') }}
          </p>
          <div style="padding: 10px 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); margin-bottom: 8px;">
            <div class="v2-num" style="font-size: 0.75rem; word-break: break-all; user-select: all; color: var(--v2-ink);">
              {{ link }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <ui-button variant="secondary" size="sm" (click)="copyReferralLink()">
              {{ referralCopied() ? t('settings.referral.copied') : t('settings.referral.copy') }}
            </ui-button>
            <ui-button variant="ghost" size="sm" (click)="shareReferral()">
              {{ t('settings.referral.share') }}
            </ui-button>
          </div>
          @if (referralRewardActive(); as until) {
            <p class="v2-caption mt-3" style="color: var(--v2-sage);">
              {{ t('settings.referral.rewardActive', { date: until }) }}
            </p>
          }
        </ui-card>
      }

    </ng-container>
  `,
})
export class SettingsMembershipSectionComponent {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(LEDGER_PORT);
  private readonly callables = inject(CallableGateway);
  protected readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);

  // ─── Refer a friend ──────────────────────────────────────────
  protected readonly referralCopied = signal(false);
  private referralCopyTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly referralLink = computed(() => {
    const uid = this.auth.user()?.uid;
    return uid ? buildReferralLink(uid) : null;
  });

  /** Server-stamped reward expiry — when present and in the future,
   *  the user is currently inside their bonus window from a referral
   *  conversion. Surfaced as a positive confirmation under the share
   *  controls so users see the loop actually paid out. */
  protected readonly referralRewardActive = computed<string | null>(() => {
    // `compedUntil` crosses the ledger seam as a domain `Date` (never a
    // Firestore Timestamp) — see CONTEXT.md "Date type at the seam".
    const t = this.firebase.profile()?.compedUntil;
    if (!t) return null;
    const ms = t.getTime();
    if (ms <= Date.now()) return null;
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  });

  protected async copyReferralLink(): Promise<void> {
    const link = this.referralLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.referralCopied.set(true);
      this.analytics.track('referral_copied');
      if (this.referralCopyTimer) clearTimeout(this.referralCopyTimer);
      this.referralCopyTimer = setTimeout(() => this.referralCopied.set(false), 2000);
    } catch { /* clipboard rejected — silent */ }
  }

  protected async shareReferral(): Promise<void> {
    const link = this.referralLink();
    if (!link) return;
    const channel = await share({
      title: this.translation.t('settings.referral.shareTitle'),
      text: this.translation.t('settings.referral.shareText'),
      url: link,
    });
    this.analytics.track('referral_shared', { channel });
    if (channel === 'clipboard') {
      this.referralCopied.set(true);
      if (this.referralCopyTimer) clearTimeout(this.referralCopyTimer);
      this.referralCopyTimer = setTimeout(() => this.referralCopied.set(false), 2000);
    }
  }

  // ─── Public profile (/u/<slug>) ─────────────────────────────
  protected readonly publicSlug = computed<string | null>(() => {
    const profile = this.firebase.profile() as { publicSlug?: string; publicProfileEnabled?: boolean } | null;
    return profile?.publicProfileEnabled && profile.publicSlug ? profile.publicSlug : null;
  });
  protected readonly publicDisplayNameStored = computed<string>(() => {
    const profile = this.firebase.profile() as { publicDisplayName?: string } | null;
    return profile?.publicDisplayName ?? '';
  });
  protected readonly slugInput = signal<string>('');
  protected readonly publicDisplayNameInput = signal<string>('');
  protected readonly publicBusy = signal(false);
  protected readonly publicError = signal<string | null>(null);

  /** Seed the inputs from the stored profile when the sheet opens. */
  private seededPublicProfile = false;
  private seedPublicProfileInputs(): void {
    if (this.seededPublicProfile) return;
    const slug = this.publicSlug();
    if (slug != null) this.slugInput.set(slug);
    const dn = this.publicDisplayNameStored();
    if (dn) this.publicDisplayNameInput.set(dn);
    this.seededPublicProfile = true;
  }

  protected onSlugInput(ev: Event): void {
    this.seedPublicProfileInputs();
    const v = (ev.target as HTMLInputElement).value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30);
    this.slugInput.set(v);
    if (this.publicError()) this.publicError.set(null);
  }

  protected onDisplayNameInput(ev: Event): void {
    this.seedPublicProfileInputs();
    this.publicDisplayNameInput.set((ev.target as HTMLInputElement).value.slice(0, 40));
  }

  protected async claimSlug(): Promise<void> {
    const slug = this.slugInput().trim();
    if (!slug || this.publicBusy()) return;
    this.publicBusy.set(true);
    this.publicError.set(null);
    try {
      await this.callables.call<{ slug: string; displayName?: string }, { slug: string }>(
        'claimPublicSlug',
        { slug, displayName: this.publicDisplayNameInput().trim() || undefined },
      );
      // Profile snapshot listener will re-render the link once Firestore syncs.
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'functions/already-exists') {
        this.publicError.set(this.translation.t('publicProfileSettings.errorTaken'));
      } else if (code === 'functions/invalid-argument') {
        // Could be reserved or format — message string distinguishes.
        const msg = (err as { message?: string })?.message ?? '';
        this.publicError.set(msg.includes('reserved')
          ? this.translation.t('publicProfileSettings.errorReserved')
          : this.translation.t('publicProfileSettings.errorFormat'));
      } else {
        this.publicError.set((err as Error)?.message ?? 'unknown error');
      }
    } finally {
      this.publicBusy.set(false);
    }
  }

  protected async releaseSlug(): Promise<void> {
    if (this.publicBusy()) return;
    this.publicBusy.set(true);
    this.publicError.set(null);
    try {
      await this.callables.call<Record<string, never>, { released: boolean }>('releasePublicSlug', {});
      this.slugInput.set('');
      this.publicDisplayNameInput.set('');
      this.seededPublicProfile = false;
    } catch (err) {
      this.publicError.set((err as Error)?.message ?? 'unknown error');
    } finally {
      this.publicBusy.set(false);
    }
  }
}
