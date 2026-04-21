import { Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { AVAILABLE_LANGS, AppLang } from '../i18n/transloco.providers';

type TranslocoParams = Record<string, unknown>;

const STORAGE_KEY = 'macrolog.lang';

@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly transloco = inject(TranslocoService);

  readonly language = signal<AppLang>(this.resolveInitial());

  /** Active route-level title key (e.g. 'privacy.pageTitle'). When unset
      we fall back to the app-wide default `common.appTitle` so the base
      title is preserved for the main /app view. */
  private currentTitleKey: string | null = null;

  constructor() {
    this.transloco.setActiveLang(this.language());
    this.updateHtmlLang(this.language());
    // Title update happens after first translation load.
    this.transloco.events$.subscribe((event) => {
      if (event.type === 'translationLoadSuccess' && event.payload.langName === this.language()) {
        this.updateTitle();
      }
    });
  }

  setLanguage(lang: AppLang): void {
    if (!AVAILABLE_LANGS.includes(lang)) return;
    this.language.set(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Private-mode Safari throws; non-fatal.
    }
    this.transloco.setActiveLang(lang);
    this.updateHtmlLang(lang);
    this.updateTitle();
  }

  /** Set the document title from a specific i18n key. Pass `null` to
      restore the default app title. Keeps title/lang management in one
      place so per-route titles flip correctly on language change too. */
  setTitleKey(key: string | null): void {
    this.currentTitleKey = key;
    this.updateTitle();
  }

  t(key: string, params?: TranslocoParams): string {
    return this.transloco.translate(key, params, this.language());
  }

  /**
   * Maps a server error code (see src/app/models/error-codes.ts) to a localized
   * user-facing message under `errors.<camelCase>`. Falls back to
   * `errors.unknown` when the code has no translation or is missing. Pass
   * `params` to fill interpolation placeholders (e.g. `{{ limit }}`).
   */
  tError(code: string | undefined | null, params?: TranslocoParams): string {
    const key = code ? `errors.${this.toCamel(code)}` : 'errors.unknown';
    const translated = this.t(key, params);
    return translated === key ? this.t('errors.unknown') : translated;
  }

  private resolveInitial(): AppLang {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && AVAILABLE_LANGS.includes(stored as AppLang)) {
        return stored as AppLang;
      }
    } catch {
      // ignore, fall through
    }
    const nav = typeof navigator !== 'undefined' ? navigator.language : '';
    return nav?.toLowerCase().startsWith('es') ? 'es-PR' : 'en';
  }

  private updateTitle(): void {
    if (typeof document === 'undefined') return;
    const key = this.currentTitleKey ?? 'common.appTitle';
    const title = this.t(key);
    if (title && title !== key) {
      document.title = title;
    }
  }

  private updateHtmlLang(lang: AppLang): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang;
  }

  private toCamel(code: string): string {
    return code
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }
}
