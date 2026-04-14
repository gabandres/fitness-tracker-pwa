import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FitnessStore } from '../../services/fitness-store.service';

/**
 * Cross-platform install nudge for the PWA.
 *
 * Desktop + Android (Chrome/Edge/Brave):
 *   The browser fires `beforeinstallprompt` when the PWA is installable.
 *   We stash the event and show a single-button install card; tapping
 *   triggers the native prompt.
 *
 * iOS Safari (iPadOS + iOS):
 *   No `beforeinstallprompt` API. We detect iOS Safari via UA and show
 *   a text-only card with the manual two-tap instructions (share →
 *   Add to Home Screen).
 *
 * Hidden when:
 *   - Already running as installed (display-mode: standalone)
 *   - User has fewer than 1 logged meal (don't pester before engagement)
 *   - User dismissed the prompt in the last 7 days
 *   - We're not on a page that supports PWA install (privacy/terms routes)
 *
 * We listen for `appinstalled` to immediately hide after a successful
 * install without waiting for a reload.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'macrolog.install-prompt-dismissed-at';
const DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-install-prompt',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shouldShow()) {
      <div class="specimen px-4 py-3 mb-4 flex items-center gap-3 slide-down"
        role="status" style="border-color: var(--color-olive)">
        <span class="crop-bl" style="border-color: var(--color-olive)"></span>
        <span class="crop-br" style="border-color: var(--color-olive)"></span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="stamp-mark"
              style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">
              install
            </span>
            <span class="data-label">home screen</span>
          </div>
          @if (canPromptNatively()) {
            <p class="font-sans text-xs text-ink leading-relaxed">
              install macro log as an app — one tap, opens faster, works offline.
            </p>
          } @else {
            <p class="font-sans text-xs text-ink leading-relaxed">
              to install on iphone: tap the <span class="font-mono">share</span> button in safari, then
              <span class="font-mono">Add to Home Screen</span>.
            </p>
          }
        </div>
        @if (canPromptNatively()) {
          <button type="button" (click)="install()"
            aria-label="Install Macro Log as an app"
            class="tag-btn text-[11px] shrink-0"
            style="border-color: var(--color-olive); color: var(--color-olive)">
            install
          </button>
        }
        <button type="button" (click)="dismiss()"
          aria-label="Dismiss install prompt"
          class="text-graphite text-base leading-none shrink-0 px-1"
          title="Hide for 7 days">&times;</button>
      </div>
    }
  `,
})
export class InstallPromptComponent {
  private readonly store = inject(FitnessStore);

  /** Stashed BIP event. Present => we can call .prompt() natively. */
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);
  /** Forces re-eval when the user clicks dismiss (writes to localStorage). */
  private readonly dismissTick = signal(0);
  /** Forces re-eval after `appinstalled` fires (hides the card forever). */
  private readonly installed = signal(this.detectStandalone());

  protected readonly canPromptNatively = computed(() => this.deferred() !== null);

  protected readonly shouldShow = computed(() => {
    if (this.installed()) return false;
    if (this.store.logs().length < 1) return false;
    this.dismissTick(); // subscribe so dismiss triggers re-eval
    if (this.isDismissedRecently()) return false;
    // Show if native prompt is available OR we're on iOS (text-only path).
    return this.canPromptNatively() || this.isIOSSafari();
  });

  constructor() {
    if (typeof window === 'undefined') return;

    const onBeforeInstall = (e: Event) => {
      // Prevent the mini-infobar on mobile Chrome.
      e.preventDefault();
      this.deferred.set(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      this.installed.set(true);
      this.deferred.set(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onAppInstalled);

    // Clean up if the component is ever torn down (route change,
    // ancestor @if, etc). Currently it lives for the session, but
    // making this explicit keeps things safe if the tree ever changes.
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onAppInstalled);
    });
  }

  protected async install(): Promise<void> {
    const evt = this.deferred();
    if (!evt) return;
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      if (outcome === 'dismissed') this.dismiss();
      // On accept, the `appinstalled` listener flips `installed`.
    } finally {
      // The BIP event is single-use; clear it regardless of outcome.
      this.deferred.set(null);
    }
  }

  protected dismiss(): void {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
    this.dismissTick.update((n) => n + 1);
  }

  private isDismissedRecently(): boolean {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY));
      if (!at) return false;
      return Date.now() - at < DISMISS_COOLDOWN_MS;
    } catch {
      return false;
    }
  }

  private detectStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    // iOS sets this non-standard `standalone` prop; everyone else uses
    // the display-mode media query.
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone;
    if (iosStandalone) return true;
    return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  }

  private isIOSSafari(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
    // Real Safari carries `Version/<n> ... Safari/<n>` in the UA. Every
    // embedded WKWebView (in-app browsers like Chrome, Firefox, Edge,
    // Opera, FB, IG, DuckDuckGo, Gmail-WebView, Google App, Snapchat,
    // Twitter, etc) drops the `Version/` token — so that single marker
    // is a far more robust Safari check than enumerating exclusions.
    const isRealSafari = /Version\/[\d.]+.*Safari/.test(ua);
    return isIOS && isRealSafari;
  }
}
