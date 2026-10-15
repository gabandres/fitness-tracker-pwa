import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AdminConsole } from './admin-console';
import { checkMinVersion, minVersionRows, type MinPlatform, type MinVersionRow } from './admin-min-version';

/**
 * System → "Update required": the per-platform minimum binary. Below it the
 * mobile app shows a full-screen, non-dismissible update screen. Shows, per
 * platform, the minimum in force, what the store has LIVE and the newest
 * distributed build, and refuses (here and on the server) a minimum above the
 * live store version — that would strand every user on a store page that
 * cannot give them what the gate demands.
 */
@Component({
  selector: 'adm-min-version',
  standalone: true,
  imports: [FormsModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t; prefix: 'admin.minVersion'">
      <div class="adm-section" data-testid="min-version">
        <span class="adm-label">{{ t('title') }}</span>
        <p class="adm-kpi-hint" style="margin: 2px 0 8px;">{{ t('hint') }}</p>
        @for (r of rows(); track r.platform) {
          <div style="display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-top: 1px solid var(--adm-rule);">
            <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;">
              <strong>{{ t(r.platform) }}</strong>
              @if (r.min != null) {
                <span class="adm-chip warn">{{ t('current', { value: fmt(r, r.min) }) }}</span>
              } @else {
                <span class="adm-chip muted">{{ t('none') }}</span>
              }
              <span class="adm-soft" style="font-size: 12px;">
                {{ t('live', { value: r.live == null ? '—' : fmt(r, r.live) }) }}
                @if (r.platform === 'android' && r.newest != null && r.newest !== r.live) { · {{ t('newest', { value: fmt(r, r.newest) }) }} }
              </span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input class="adm-field grow" [attr.aria-label]="t('inputLabel', { platform: t(r.platform) })"
                [placeholder]="r.platform === 'android' ? t('placeholderAndroid') : t('placeholderIos')"
                [inputMode]="r.platform === 'android' ? 'numeric' : 'decimal'"
                [ngModel]="draft()[r.platform]" (ngModelChange)="setDraft(r.platform, $event)" />
              <button type="button" class="adm-btn sm primary" (click)="save(r)"
                [disabled]="data.running('minVersion') || !verdict(r).ok">{{ t('set') }}</button>
              @if (r.min != null) {
                <button type="button" class="adm-btn sm ghost" (click)="clear(r.platform)" [disabled]="data.running('minVersion')">{{ t('clear') }}</button>
              }
            </div>
            @if (draft()[r.platform].trim()) {
              @let v = verdict(r);
              @if (!v.ok) {
                <div class="adm-kpi-hint" role="alert" style="color: var(--adm-danger);">{{ t('error.' + v.error, v.params ?? {}) }}</div>
              } @else {
                <div class="adm-kpi-hint" style="color: var(--adm-warn);">{{ t('warning') }}</div>
              }
            }
          </div>
        }
        <p class="adm-kpi-hint">{{ t('cacheNote') }}</p>
      </div>
    </ng-container>
  `,
})
export class AdminMinVersionComponent {
  readonly data = inject(AdminConsole);
  readonly rows = computed(() => minVersionRows(this.data.appVersionDoc()));
  readonly draft = signal<Record<MinPlatform, string>>({ android: '', ios: '' });

  constructor() { void this.data.appVersionDoc.load(); }

  fmt(r: MinVersionRow, v: number | string): string {
    return r.platform === 'android' ? `vc ${v}` : String(v);
  }

  setDraft(platform: MinPlatform, value: string): void {
    this.draft.update((d) => ({ ...d, [platform]: value ?? '' }));
  }

  verdict(r: MinVersionRow) { return checkMinVersion(r, this.draft()[r.platform]); }

  async save(r: MinVersionRow): Promise<void> {
    const v = this.verdict(r);
    if (!v.ok) return;
    if (await this.data.setMinAppVersion(r.platform, v.value)) this.setDraft(r.platform, '');
  }

  clear(platform: MinPlatform): Promise<boolean> { return this.data.setMinAppVersion(platform, null); }
}
