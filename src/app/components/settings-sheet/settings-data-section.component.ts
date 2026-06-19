import {
  ChangeDetectionStrategy, Component, ElementRef,
  inject, signal, viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { FitnessStore } from '../../services/fitness-store.service';
import { AnalyticsService } from '../../services/analytics.service';
import { buildCsv, downloadCsv } from '../../utils/csv-export';
import { ImportParseResult, parseImportCsv } from '../../utils/import-csv';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Settings · data section — the Apple-Shortcuts webhook key, CSV
 * export, and account-deletion pointer. Owns the export read fan-out
 * and the webhook key reveal/copy/revoke flow.
 */
@Component({
  selector: 'app-settings-data-section',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.data.section') }}</h3>

        <div class="mb-4">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.webhook') }}</div>
              <p class="v2-caption mt-0.5">{{ t('settings.data.webhookDesc') }}</p>
            </div>
            <ui-button variant="ghost" size="sm"
              (click)="showWebhook.set(!showWebhook())"
              [ariaLabel]="showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow')">
              {{ showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow') }}
            </ui-button>
          </div>
          @if (showWebhook()) {
            <div style="padding: 12px; background: var(--v2-paper-2); border-radius: var(--v2-radius-sm); border: 1px solid var(--v2-rule);">
              @if (store.webhookApiKey(); as key) {
                <div class="v2-num"
                  style="font-size: 0.75rem; padding: 8px; background: var(--v2-paper); border-radius: var(--v2-radius-sm); word-break: break-all; user-select: all;">
                  {{ key }}
                </div>
                <p class="v2-caption mt-2">
                  {{ t('settings.data.webhookEndpoint') }}
                  <span class="v2-num" style="font-size: 0.75rem;">{{ webhookUrl }}</span>
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <ui-button variant="secondary" size="sm" (click)="copyWebhookKey()">
                    {{ webhookCopied() ? t('settings.data.webhookCopied') : t('settings.data.webhookCopy') }}
                  </ui-button>
                  <ui-button variant="ghost" size="sm" (click)="store.revokeWebhookApiKey()">
                    {{ t('settings.data.webhookRevoke') }}
                  </ui-button>
                  @if (webhookCopied()) {
                    <span class="sr-only" role="status" aria-live="polite">
                      {{ t('settings.data.webhookCopiedAria') }}
                    </span>
                  }
                </div>
              } @else {
                <p class="v2-caption mb-3">{{ t('settings.data.webhookGenerateHint') }}</p>
                <ui-button variant="secondary" size="sm" (click)="store.generateWebhookApiKey()">
                  {{ t('settings.data.webhookGenerate') }}
                </ui-button>
              }
            </div>
          }
        </div>

        <!-- Switcher import: MyFitnessPal / Lose It! / Cronometer CSV.
             Parsing is fully client-side (utils/import-csv.ts); the
             ledger bulk-writes in ≤450-row batches. -->
        <div class="mb-4">
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.importTitle') }}</div>
              <p class="v2-caption mt-0.5">{{ t('settings.data.importDesc') }}</p>
            </div>
            <ui-button variant="secondary" size="sm" (click)="pickImportFile()" [disabled]="importing()">
              <lucide-icon name="upload" [size]="14" />
              {{ t('settings.data.importChoose') }}
            </ui-button>
          </div>
          <input #importFile type="file" accept=".csv,text/csv" class="sr-only"
            [attr.aria-label]="t('settings.data.importTitle')"
            (change)="onImportFile($event)" />
          @if (importPreview(); as p) {
            <div style="padding: 12px; background: var(--v2-paper-2); border-radius: var(--v2-radius-sm); border: 1px solid var(--v2-rule);">
              <p class="v2-body" style="font-weight: 500;">
                {{ t('settings.data.importPreview', { n: p.entries.length, from: p.firstDate, to: p.lastDate }) }}
              </p>
              @if (p.skipped > 0) {
                <p class="v2-caption mt-1">{{ t('settings.data.importSkipped', { n: p.skipped }) }}</p>
              }
              <p class="v2-caption mt-1" style="color: var(--v2-accent);">
                {{ t('settings.data.importDupWarning') }}
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                <ui-button variant="primary" size="sm" (click)="confirmImport()" [disabled]="importing()">
                  {{ importing() ? t('settings.data.importImporting') : t('settings.data.importConfirm') }}
                </ui-button>
                <ui-button variant="ghost" size="sm" (click)="cancelImport()" [disabled]="importing()">
                  {{ t('settings.data.importCancel') }}
                </ui-button>
              </div>
            </div>
          } @else if (importDone(); as n) {
            <p class="v2-caption" role="status" aria-live="polite" style="color: var(--v2-sage);">
              {{ t('settings.data.importDone', { n }) }}
            </p>
          }
          @if (importError(); as errKey) {
            <p class="v2-caption mt-1" role="alert" style="color: var(--v2-danger);">{{ t(errKey) }}</p>
          }
        </div>

        <div class="flex items-center justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.export') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.data.exportDesc') }}</p>
            <p class="v2-caption mt-1">{{ t('settings.data.exportHint') }}</p>
            @if (exportError()) {
              <p class="v2-caption mt-1" role="status" aria-live="polite" style="color: var(--v2-danger);">
                {{ t('settings.data.exportError') }}
              </p>
            }
          </div>
          <ui-button variant="secondary" size="sm" (click)="exportData()" [disabled]="exporting()">
            <lucide-icon name="download" [size]="14" />
            {{ exporting() ? t('settings.data.exportPreparing') : t('settings.data.exportButton') }}
          </ui-button>
        </div>

        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.delete') }}</div>
            <p class="v2-caption">{{ t('settings.data.deleteDesc') }}</p>
          </div>
          <a href="/privacy#delete"
            class="v2-btn v2-btn--sm v2-btn--ghost"
            style="color: var(--v2-danger);">
            {{ t('settings.data.deleteManage') }}
          </a>
        </div>
      </ui-card>
    </ng-container>
  `,
})
export class SettingsDataSectionComponent {
  protected readonly firebase = inject(LEDGER_PORT);
  protected readonly store = inject(FitnessStore);
  private readonly analytics = inject(AnalyticsService);

  protected readonly showWebhook = signal(false);
  protected readonly webhookCopied = signal(false);
  protected readonly webhookUrl = 'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/logWebhook';
  private webhookCopyTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── CSV export ──────────────────────────────────────────────
  protected readonly exporting = signal(false);
  protected readonly exportError = signal(false);

  protected async exportData(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(false);
    try {
      const [logs, measurements, dailyWeights, dailyWater, workoutSessions] = await Promise.all([
        this.firebase.getRecentLogs(9999),
        this.firebase.getRecentMeasurements(9999),
        this.firebase.getDailyWeights(),
        this.firebase.getDailyWater(),
        this.firebase.getAllSessions(),
      ]);
      const csv = buildCsv({ logs, measurements, dailyWeights, dailyWater, workoutSessions });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`macrolog-export-${stamp}.csv`, csv);
      this.analytics.track('data_export_csv', {
        rows: logs.length + measurements.length + workoutSessions.length,
      });
    } catch {
      this.exportError.set(true);
    } finally {
      this.exporting.set(false);
    }
  }

  // ─── Switcher import (MFP / Lose It / Cronometer CSV) ─────────
  private readonly importFileInput = viewChild<ElementRef<HTMLInputElement>>('importFile');
  protected readonly importPreview = signal<ImportParseResult | null>(null);
  protected readonly importing = signal(false);
  protected readonly importDone = signal<number | null>(null);
  protected readonly importError = signal<string | null>(null);

  protected pickImportFile(): void {
    this.importDone.set(null);
    this.importError.set(null);
    this.importFileInput()?.nativeElement.click();
  }

  protected async onImportFile(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // re-selecting the same file must re-fire change
    if (!file) return;
    const text = await file.text();
    const parsed = parseImportCsv(text);
    if (!parsed.ok) {
      this.importPreview.set(null);
      this.importError.set(`settings.data.importError.${parsed.error}`);
      return;
    }
    this.importError.set(null);
    this.importPreview.set(parsed.result);
  }

  protected async confirmImport(): Promise<void> {
    const preview = this.importPreview();
    if (!preview || this.importing()) return;
    this.importing.set(true);
    this.importError.set(null);
    try {
      const written = await this.firebase.importLogs(preview.entries);
      this.importPreview.set(null);
      this.importDone.set(written);
      this.analytics.track('data_import_csv', { rows: written, skipped: preview.skipped });
      // Full reload so the rolling window, all-time cache, and every
      // derivation see the imported history.
      void this.store.refresh();
    } catch {
      // Batches are not atomic — earlier chunks may have landed. The
      // user re-importing would duplicate those; tell them to check
      // History rather than blindly retry.
      this.importError.set('settings.data.importError.failed');
    } finally {
      this.importing.set(false);
    }
  }

  protected cancelImport(): void {
    this.importPreview.set(null);
  }

  protected async copyWebhookKey(): Promise<void> {
    const key = this.store.webhookApiKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      this.webhookCopied.set(true);
      if (this.webhookCopyTimer) clearTimeout(this.webhookCopyTimer);
      this.webhookCopyTimer = setTimeout(() => this.webhookCopied.set(false), 2000);
    } catch { /* clipboard rejected — silent */ }
  }
}
