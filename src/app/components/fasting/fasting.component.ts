import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { TranslationService } from '../../services/translation.service';
import { bcp47ForLang } from '../../utils/locale';

/**
 * Analog Fasting Chronometer
 *
 * A vintage dial that tracks a 16-hour (or custom) fasting window.
 * The dial fills clockwise as hours pass. "Punch the clock" starts
 * or breaks the fast.
 *
 * The aesthetic: an analog gauge/chronometer from a mid-century
 * scientific instrument. Tick marks around the perimeter, a single
 * hand sweeping the elapsed hours, fill arc behind it.
 */
@Component({
  selector: 'app-fasting',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <!-- The section stays mounted in both fasting and idle states so
         end-fast doesn't pop a whole new panel into the right column
         (that jump was the "broken transition" flagged in UX_AUDIT §S11).
         The strip at the top of the ledger is ambient; this dial is the
         detail view and always has a reachable CTA (start or end). -->
    <section>
      <h2 class="rule"><span>{{ t('fasting.chronometer') }}</span></h2>

      <div class="mt-4 flex flex-col items-center">
        <!-- Analog dial -->
        <div class="relative w-44 h-44 sm:w-52 sm:h-52">
          <svg viewBox="0 0 200 200" class="w-full h-full" aria-hidden="true">
            <!-- Outer ring -->
            <circle cx="100" cy="100" r="92" fill="none"
              stroke="var(--color-rule)" stroke-width="1" />
            <circle cx="100" cy="100" r="88" fill="none"
              stroke="var(--color-rule)" stroke-width="0.5" />

            <!-- Hour tick marks (16 for a 16h fast) -->
            @for (tick of dialTicks; track tick.hour) {
              <line
                [attr.x1]="tick.x1" [attr.y1]="tick.y1"
                [attr.x2]="tick.x2" [attr.y2]="tick.y2"
                [attr.stroke]="tick.hour % 4 === 0 ? 'var(--color-ink)' : 'var(--color-graphite)'"
                [attr.stroke-width]="tick.hour % 4 === 0 ? 1.5 : 0.75"
              />
              @if (tick.hour % 4 === 0) {
                <text
                  [attr.x]="tick.labelX" [attr.y]="tick.labelY"
                  text-anchor="middle" dominant-baseline="central"
                  fill="var(--color-graphite)"
                  style="font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.05em;">
                  {{ tick.hour }}h
                </text>
              }
            }

            <!-- Progress arc (fills as fast progresses) -->
            @if (store.isFasting() && elapsedHours() > 0) {
              <circle cx="100" cy="100" r="78" fill="none"
                stroke="var(--color-blood)" stroke-width="6"
                stroke-linecap="round"
                [attr.stroke-dasharray]="arcLength"
                [attr.stroke-dashoffset]="arcOffset()"
                style="transform: rotate(-90deg); transform-origin: center;"
                class="transition-all duration-1000"
              />
            }

            <!-- Center display -->
            <text x="100" y="90" text-anchor="middle" dominant-baseline="central"
              fill="var(--color-ink)"
              style="font-family: var(--font-display); font-style: italic; font-size: 28px;">
              {{ store.isFasting() ? elapsedLabel() : '—' }}
            </text>
            <text x="100" y="112" text-anchor="middle" dominant-baseline="central"
              fill="var(--color-graphite)"
              style="font-family: var(--font-mono); font-size: 8px; letter-spacing: 0.2em; text-transform: uppercase;">
              {{ store.isFasting() ? t('fasting.elapsed') : t('fasting.idle') }}
            </text>

            <!-- Hand -->
            @if (store.isFasting()) {
              <line x1="100" y1="100"
                [attr.x2]="handX()" [attr.y2]="handY()"
                stroke="var(--color-blood)" stroke-width="1.5" stroke-linecap="round" />
              <circle cx="100" cy="100" r="3" fill="var(--color-blood)" />
            } @else {
              <circle cx="100" cy="100" r="3" fill="var(--color-graphite)" />
            }
          </svg>
        </div>

        <!-- Status + button. The CTA stays at the same offset in both
             states so end-fast swaps the label in place instead of
             jumping the layout. -->
        <div class="mt-4 text-center w-full max-w-xs">
          @if (store.isFasting()) {
            @if (!editing()) {
              <p class="caption text-[11px]">
                {{ t('fasting.fastingSince', { time: startTimeLabel() }) }}
                <button type="button" (click)="beginEdit()"
                  [attr.aria-label]="t('fasting.editStartAria')"
                  class="ml-1 underline text-graphite hover:text-ink">
                  {{ t('fasting.editStart') }}
                </button>
              </p>
              <button type="button" (click)="punchClock()"
                [attr.aria-label]="t('fasting.endFastAria')"
                class="stamp-btn mt-3 max-w-xs">
                {{ t('fasting.endFast') }}
              </button>
            } @else {
              <p class="caption text-[11px] mb-2">{{ t('fasting.editStartPrompt') }}</p>
              <div class="flex items-center justify-center gap-2">
                <input type="time" [value]="editValue()"
                  (input)="editValue.set($any($event.target).value)"
                  [attr.aria-label]="t('fasting.editStartAria')"
                  [attr.aria-invalid]="editError() ? 'true' : null"
                  [attr.aria-describedby]="editError() ? 'fasting-edit-error' : null"
                  class="font-mono text-sm px-2 py-1 border border-rule bg-paper" />
              </div>
              @if (editError()) {
                <p id="fasting-edit-error" role="alert"
                  class="caption text-[11px] mt-1" style="color: var(--color-blood)">
                  {{ editError() }}
                </p>
              }
              <div class="mt-3 flex items-center justify-center gap-2">
                <button type="button" (click)="cancelEdit()"
                  class="tag-btn text-[11px]">
                  {{ t('fasting.cancel') }}
                </button>
                <button type="button" (click)="commitEdit()"
                  class="stamp-btn text-[11px]">
                  {{ t('fasting.save') }}
                </button>
              </div>
            }
          } @else {
            @if (!editing()) {
              <button type="button" (click)="punchClock()"
                [attr.aria-label]="t('fasting.startFastAria')"
                class="stamp-btn stamp-btn--ink mt-3 max-w-xs">
                {{ t('fasting.startFast') }}
              </button>
              <p class="mt-2">
                <button type="button" (click)="beginEdit()"
                  class="caption text-[11px] underline text-graphite hover:text-ink">
                  {{ t('fasting.startedEarlier') }}
                </button>
              </p>
            } @else {
              <p class="caption text-[11px] mb-2">{{ t('fasting.startedEarlierPrompt') }}</p>
              <div class="flex items-center justify-center gap-2">
                <input type="time" [value]="editValue()"
                  (input)="editValue.set($any($event.target).value)"
                  [attr.aria-label]="t('fasting.editStartAria')"
                  [attr.aria-invalid]="editError() ? 'true' : null"
                  [attr.aria-describedby]="editError() ? 'fasting-edit-error' : null"
                  class="font-mono text-sm px-2 py-1 border border-rule bg-paper" />
              </div>
              @if (editError()) {
                <p id="fasting-edit-error" role="alert"
                  class="caption text-[11px] mt-1" style="color: var(--color-blood)">
                  {{ editError() }}
                </p>
              }
              <div class="mt-3 flex items-center justify-center gap-2">
                <button type="button" (click)="cancelEdit()"
                  class="tag-btn text-[11px]">
                  {{ t('fasting.cancel') }}
                </button>
                <button type="button" (click)="commitEdit()"
                  class="stamp-btn text-[11px]">
                  {{ t('fasting.startFast') }}
                </button>
              </div>
            }
          }
        </div>
      </div>
    </section>
    </ng-container>
  `,
})
export class FastingComponent implements OnInit, OnDestroy {
  protected readonly store = inject(FitnessStore);
  private readonly translation = inject(TranslationService);

  private readonly FAST_HOURS = 16;
  private readonly RADIUS = 78;
  // Allow backdating a start up to 48 hours — beyond that the session
  // would already be past any plausible fasting window.
  private readonly MAX_BACKDATE_HOURS = 48;
  protected readonly arcLength = 2 * Math.PI * this.RADIUS;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  // Signal that updates every minute to drive the hand + arc.
  private readonly _now = signal(new Date());

  // Inline start-time editor state. Used for both "backdate a fast that
  // I'm starting now" and "correct the start time of the active fast".
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');
  protected readonly editError = signal('');

  protected readonly elapsedHours = computed(() => {
    const start = this.store.fastStartedAt();
    if (!start) return 0;
    const ms = this._now().getTime() - start.getTime();
    return Math.max(0, ms / (1000 * 60 * 60));
  });

  protected readonly elapsedLabel = computed(() => {
    const h = this.elapsedHours();
    const hours = Math.floor(h);
    const mins = Math.floor((h - hours) * 60);
    return `${hours}:${String(mins).padStart(2, '0')}`;
  });

  protected readonly startTimeLabel = computed(() => {
    const start = this.store.fastStartedAt();
    if (!start) return '';
    const locale = bcp47ForLang(this.translation.language());
    return start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  });

  /** SVG arc offset: full circle minus the fraction elapsed. */
  protected readonly arcOffset = computed(() => {
    const fraction = Math.min(1, this.elapsedHours() / this.FAST_HOURS);
    return this.arcLength * (1 - fraction);
  });

  /** Hand endpoint on the dial — sweeps 360° over FAST_HOURS. */
  protected readonly handX = computed(() => {
    const angle = (this.elapsedHours() / this.FAST_HOURS) * 2 * Math.PI - Math.PI / 2;
    return 100 + 65 * Math.cos(angle);
  });
  protected readonly handY = computed(() => {
    const angle = (this.elapsedHours() / this.FAST_HOURS) * 2 * Math.PI - Math.PI / 2;
    return 100 + 65 * Math.sin(angle);
  });

  /** Tick marks around the dial — one per hour, 0 to FAST_HOURS. */
  protected readonly dialTicks = Array.from({ length: this.FAST_HOURS + 1 }, (_, i) => {
    const angle = (i / this.FAST_HOURS) * 2 * Math.PI - Math.PI / 2;
    const outerR = 88;
    const innerR = i % 4 === 0 ? 78 : 83;
    const labelR = 70;
    return {
      hour: i,
      x1: 100 + outerR * Math.cos(angle),
      y1: 100 + outerR * Math.sin(angle),
      x2: 100 + innerR * Math.cos(angle),
      y2: 100 + innerR * Math.sin(angle),
      labelX: 100 + labelR * Math.cos(angle),
      labelY: 100 + labelR * Math.sin(angle),
    };
  });

  ngOnInit(): void {
    // Tick every 30 seconds to update the hand smoothly.
    this.tickInterval = setInterval(() => this._now.set(new Date()), 30_000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  protected async punchClock(): Promise<void> {
    if (this.store.isFasting()) {
      // Confirm before ending a meaningful fast — a misplaced thumb on
      // the END FAST button otherwise wipes a 14+ hour session with no
      // recourse. Skip the prompt for trivially-short fasts (< 1 hour)
      // where a confirmation is just friction.
      const start = this.store.fastStartedAt();
      const elapsedMs = start ? Date.now() - start.getTime() : 0;
      if (elapsedMs > 60 * 60 * 1000) {
        const ok = window.confirm(this.translation.t('fasting.endFastConfirm'));
        if (!ok) return;
      }
      await this.store.breakFast();
    } else {
      await this.store.startFast();
    }
  }

  protected beginEdit(): void {
    const start = this.store.fastStartedAt() ?? new Date();
    this.editValue.set(this.toTimeInputValue(start));
    this.editError.set('');
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
    this.editError.set('');
  }

  protected async commitEdit(): Promise<void> {
    const parsed = this.parseEditValue(this.editValue());
    if (!parsed) {
      this.editError.set(this.translation.t('fasting.editStartInvalid'));
      return;
    }
    await this.store.startFast(parsed);
    this.editing.set(false);
    this.editError.set('');
  }

  /** Convert a Date to a local "HH:MM" string for an <input type="time">. */
  private toTimeInputValue(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /**
   * Parse an HH:MM value into a Date in the recent past.
   * Strategy: interpret the time as "today at HH:MM in local time".
   * If that's later than now, it must mean yesterday (e.g., entering
   * 5:15pm at 1am). Reject anything older than MAX_BACKDATE_HOURS.
   */
  private parseEditValue(v: string): Date | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const now = new Date();
    const candidate = new Date(now);
    candidate.setHours(hh, mm, 0, 0);
    if (candidate.getTime() > now.getTime()) {
      candidate.setDate(candidate.getDate() - 1);
      // Re-apply wall-clock components — setDate across a DST boundary
      // can shift the hour by ±1, producing a timestamp that doesn't
      // match what the user typed.
      candidate.setHours(hh, mm, 0, 0);
    }
    const ageMs = now.getTime() - candidate.getTime();
    if (ageMs > this.MAX_BACKDATE_HOURS * 60 * 60 * 1000) return null;
    return candidate;
  }
}
