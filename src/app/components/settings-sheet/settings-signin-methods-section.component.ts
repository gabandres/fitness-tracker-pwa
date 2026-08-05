import {
  ChangeDetectionStrategy, Component,
  computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { AuthService, LinkError, type LinkFailure, type LinkableProvider } from '../../services/auth.service';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Sign-in methods — connect Google / Microsoft / Apple / a password to the
 * account you are ALREADY signed into.
 *
 * This is the counterpart to `AuthService.pendingLink`, which only helps when a
 * provider returns an email that already exists. Apple's Hide My Email returns
 * a `@privaterelay.appleid.com` address, so that collision never fires and
 * Firebase silently makes a second account instead — linking from inside a
 * session is the only path that covers it. Mirrors the mobile
 * `SignInMethodsCard` (ADR-0015 parity).
 */
@Component({
  selector: 'app-settings-signin-methods-section',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, FormsModule, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-card variant="default" id="settings-signin-methods" class="block mb-3">
      <h3 class="v2-h3 mb-2">{{ t('settings.signInMethods.section') }}</h3>
      <p class="v2-caption mb-3">{{ t('settings.signInMethods.explainer') }}</p>

      @for (row of rows(); track row.id) {
        <div class="flex items-center justify-between gap-3 py-2 border-t"
             style="border-color: var(--v2-rule);">
          <div class="min-w-0">
            <p class="text-sm font-semibold truncate" style="color: var(--v2-ink);">{{ row.label }}</p>
            <p class="v2-caption">
              {{ row.connected ? t('settings.signInMethods.connected')
                               : t('settings.signInMethods.notConnected') }}
            </p>
          </div>
          @if (row.connected) {
            <ui-button variant="ghost" size="sm"
                       [disabled]="isLast() || busy() !== null"
                       (click)="disconnect(row.id)">
              {{ t('settings.signInMethods.disconnect') }}
            </ui-button>
          } @else if (row.id === 'password') {
            <ui-button variant="secondary" size="sm"
                       [disabled]="busy() !== null"
                       (click)="passwordOpen.set(!passwordOpen())">
              {{ t('settings.signInMethods.connect') }}
            </ui-button>
          } @else {
            <ui-button variant="secondary" size="sm"
                       [disabled]="busy() !== null"
                       (click)="connect(row.id)">
              {{ t('settings.signInMethods.connect') }}
            </ui-button>
          }
        </div>
      }

      @if (passwordOpen() && !hasPassword()) {
        <div class="pt-3 flex flex-col gap-2">
          <label class="v2-caption" for="link-password">
            {{ t('settings.signInMethods.passwordHint', { email: auth.user()?.email ?? '' }) }}
          </label>
          <input id="link-password" type="password" class="v2-input" autocomplete="new-password"
                 [(ngModel)]="password"
                 [placeholder]="t('settings.signInMethods.passwordPlaceholder')" />
          <div>
            <ui-button variant="primary" size="sm"
                       [disabled]="password.length === 0 || busy() !== null"
                       (click)="savePassword()">
              {{ t('settings.signInMethods.savePassword') }}
            </ui-button>
          </div>
        </div>
      }

      @if (error(); as e) {
        <p class="v2-caption mt-2" style="color: var(--v2-danger);">
          {{ t('settings.signInMethods.err.' + e) }}
        </p>
      }
      @if (isLast()) {
        <p class="v2-caption mt-2">{{ t('settings.signInMethods.lastNote') }}</p>
      }
    </ui-card>
    </ng-container>
  `,
})
export class SettingsSignInMethodsSectionComponent {
  protected readonly auth = inject(AuthService);

  protected readonly busy = signal<LinkableProvider | null>(null);
  protected readonly error = signal<LinkFailure | null>(null);
  protected readonly passwordOpen = signal(false);
  protected password = '';

  protected readonly hasPassword = computed(() => this.auth.linkedProviders().includes('password'));
  protected readonly isLast = computed(() => this.auth.linkedProviders().length <= 1);

  /** Row order is stable and provider-agnostic so the list doesn't reshuffle
   *  under the user's cursor when something connects. */
  protected readonly rows = computed(() => {
    const linked = this.auth.linkedProviders();
    return ([
      { id: 'google.com', label: 'Google' },
      { id: 'microsoft.com', label: 'Microsoft' },
      { id: 'apple.com', label: 'Apple' },
      { id: 'password', label: 'Email and password' },
    ] as const).map((r) => ({ ...r, connected: linked.includes(r.id) }));
  });

  protected async connect(providerId: Exclude<LinkableProvider, 'password'>): Promise<void> {
    this.error.set(null);
    this.busy.set(providerId);
    try {
      await this.auth.linkProvider(providerId);
    } catch (err) {
      this.report(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async savePassword(): Promise<void> {
    this.error.set(null);
    this.busy.set('password');
    try {
      await this.auth.linkPassword(this.password);
      this.password = '';
      this.passwordOpen.set(false);
    } catch (err) {
      this.report(err);
    } finally {
      this.busy.set(null);
    }
  }

  protected async disconnect(providerId: LinkableProvider): Promise<void> {
    this.error.set(null);
    this.busy.set(providerId);
    try {
      await this.auth.unlinkProvider(providerId);
    } catch (err) {
      this.report(err);
    } finally {
      this.busy.set(null);
    }
  }

  /** A closed popup is a decision, not an error — everything else gets said. */
  private report(err: unknown): void {
    const failure = err instanceof LinkError ? err.failure : 'failed';
    this.error.set(failure === 'cancelled' ? null : failure);
  }
}
