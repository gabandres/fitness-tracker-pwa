import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FitnessStore } from '../../services/fitness-store.service';
import { Measurement } from '../../services/firebase.service';

type Mode = 'view' | 'add';

@Component({
  selector: 'app-measurements',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule"><span>body tape</span></div>

      @if (store.latestMeasurement(); as m) {
        <div class="mt-4 specimen px-4 py-3">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <div class="flex items-center justify-between mb-2">
            <span class="data-label">latest measurement</span>
            <span class="font-mono text-[11px] text-graphite">
              {{ formatDate(m.date) }}
            </span>
          </div>
          <div class="grid grid-cols-4 gap-2 text-center">
            @for (field of fields; track field.key) {
              @if (m[field.key] != null) {
                <div>
                  <div class="font-mono text-sm font-medium text-ink tabular-nums">
                    {{ m[field.key] }}
                    @if (store.measurementDeltas(); as d) {
                      @if (d[field.key] != null) {
                        <span class="text-[11px] ml-0.5"
                          [style.color]="d[field.key]! < 0 ? 'var(--color-olive)' : d[field.key]! > 0 ? 'var(--color-blood)' : 'var(--color-graphite)'">
                          {{ d[field.key]! > 0 ? '+' : '' }}{{ d[field.key] }}
                        </span>
                      }
                    }
                  </div>
                  <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ field.label }}</div>
                </div>
              }
            }
          </div>
        </div>
      }

      <div class="mt-4">
        @if (mode() === 'view') {
          <button type="button" (click)="mode.set('add')" class="stamp-btn">
            + log measurements
          </button>
        } @else {
          <div class="specimen px-4 py-5 slide-down">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">new</span>
              <span class="data-label">measurement</span>
            </div>
            <form (ngSubmit)="submit()" class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                @for (field of fields; track field.key) {
                  <div>
                    <label class="data-label block mb-1">{{ field.label }}</label>
                    <div class="flex items-baseline gap-1">
                      <input type="number" step="0.1" inputmode="decimal"
                        [ngModel]="formValues()[field.key]"
                        (ngModelChange)="setFormValue(field.key, $event)"
                        [name]="field.key" [placeholder]="field.placeholder"
                        class="field-input text-base" />
                      <span class="font-display italic text-graphite text-xs">in</span>
                    </div>
                  </div>
                }
              </div>
              <div class="flex gap-2 pt-1">
                <button type="submit" [disabled]="saving()" class="stamp-btn flex-1">
                  {{ saving() ? 'saving…' : 'commit' }}
                </button>
                <button type="button" (click)="mode.set('view')" class="tag-btn">cancel</button>
              </div>
              @if (error()) {
                <p class="font-mono text-[11px] text-blood">{{ error() }}</p>
              }
            </form>
          </div>
        }
      </div>
    </section>
  `,
})
export class MeasurementsComponent {
  protected readonly store = inject(FitnessStore);
  protected readonly mode = signal<Mode>('view');
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly fields = [
    { key: 'waist' as const, label: 'waist', placeholder: '__' },
    { key: 'chest' as const, label: 'chest', placeholder: '__' },
    { key: 'bicep' as const, label: 'bicep', placeholder: '__' },
    { key: 'hip' as const, label: 'hip', placeholder: '__' },
  ];

  protected readonly formValues = signal<Record<string, number | null>>({
    waist: null, chest: null, bicep: null, hip: null,
  });

  protected setFormValue(key: string, value: number | null): void {
    this.formValues.update((v) => ({ ...v, [key]: value }));
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  }

  protected async submit(): Promise<void> {
    const vals = this.formValues();
    const entry: Omit<Measurement, 'id' | 'date'> = {};
    if (vals['waist'] != null) entry.waist = Number(vals['waist']);
    if (vals['chest'] != null) entry.chest = Number(vals['chest']);
    if (vals['bicep'] != null) entry.bicep = Number(vals['bicep']);
    if (vals['hip'] != null) entry.hip = Number(vals['hip']);

    if (entry.waist == null && entry.chest == null && entry.bicep == null && entry.hip == null) {
      this.error.set('At least one measurement is required.');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    try {
      await this.store.addMeasurement(entry);
      this.mode.set('view');
      this.formValues.set({ waist: null, chest: null, bicep: null, hip: null });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      this.saving.set(false);
    }
  }
}
