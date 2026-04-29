import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface V2BarChartDay {
  key: string;
  label: string;
  kcal: number;
  protein: number;
}

const W = 320;     // viewBox width
const H = 200;     // viewBox height
const PAD_X = 24;  // horizontal padding
const PAD_T = 16;  // top padding (room for the over-target marker)
const PAD_B = 28;  // bottom padding (room for day labels)
const BAR_GAP = 3; // gap between paired bars within a day
const HEAD = 16;   // headroom above the higher of (max value, target)

/**
 * Twin-bar chart per day. Kcal in accent (left), protein in sage (right).
 * Two horizontal target lines (one per metric). Each metric scales to
 * its own y-axis so both target lines stay visible regardless of the
 * relative magnitudes.
 *
 * Hand-rolled SVG (no chart lib). Tokens come from styles-v2.css —
 * `--v2-accent`, `--v2-sage`, `--v2-warn`, `--v2-rule`, `--v2-ink-muted`.
 */
@Component({
  selector: 'v2-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      class="v2-bar-chart"
      [attr.viewBox]="'0 0 ' + W + ' ' + H"
      preserveAspectRatio="none"
      role="img"
      [attr.aria-label]="ariaLabel()">
      <!-- Target lines -->
      <line
        [attr.x1]="padX" [attr.x2]="W - padX"
        [attr.y1]="kcalTargetY()" [attr.y2]="kcalTargetY()"
        stroke="var(--v2-accent)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" />
      <line
        [attr.x1]="padX" [attr.x2]="W - padX"
        [attr.y1]="proteinTargetY()" [attr.y2]="proteinTargetY()"
        stroke="var(--v2-sage)" stroke-width="1" stroke-dasharray="3 3" opacity="0.5" />

      <!-- Bars -->
      @for (col of cols(); track col.key) {
        <g>
          <rect
            [attr.x]="col.kcalX" [attr.y]="col.kcalY"
            [attr.width]="col.barW" [attr.height]="col.kcalH"
            [attr.fill]="col.kcalOver ? 'var(--v2-warn)' : 'var(--v2-accent)'"
            rx="2">
            <title>{{ col.label }}: {{ col.kcal }} kcal</title>
          </rect>
          <rect
            [attr.x]="col.proteinX" [attr.y]="col.proteinY"
            [attr.width]="col.barW" [attr.height]="col.proteinH"
            fill="var(--v2-sage)"
            rx="2">
            <title>{{ col.label }}: {{ col.protein }}g protein</title>
          </rect>
          <text
            [attr.x]="col.labelX" [attr.y]="H - 8"
            text-anchor="middle"
            font-family="var(--v2-font-sans)"
            font-size="10"
            fill="var(--v2-ink-muted)">
            {{ col.label }}
          </text>
        </g>
      }
    </svg>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }
    .v2-bar-chart {
      width: 100%;
      height: 200px;
      display: block;
    }
  `],
})
export class V2BarChart {
  readonly data = input.required<V2BarChartDay[]>();
  readonly kcalTarget = input.required<number>();
  readonly proteinTarget = input.required<number>();

  protected readonly W = W;
  protected readonly H = H;
  protected readonly padX = PAD_X;

  /** Highest kcal value across the visible range OR the target plus a
   *  small headroom percentage — whichever is bigger. Guards target=0
   *  by clamping at 1 to avoid divide-by-zero in `kcalTargetY`. */
  private readonly kcalScale = computed(() => {
    const t = Math.max(1, this.kcalTarget());
    const peak = this.data().reduce(
      (m, d) => (Number.isFinite(d.kcal) && d.kcal > m ? d.kcal : m),
      t,
    );
    return peak * (1 + HEAD / 100);
  });

  private readonly proteinScale = computed(() => {
    const t = Math.max(1, this.proteinTarget());
    const peak = this.data().reduce(
      (m, d) => (Number.isFinite(d.protein) && d.protein > m ? d.protein : m),
      t,
    );
    return peak * (1 + HEAD / 100);
  });

  protected readonly kcalTargetY = computed(() =>
    this.toY(this.kcalTarget(), this.kcalScale()),
  );

  protected readonly proteinTargetY = computed(() =>
    this.toY(this.proteinTarget(), this.proteinScale()),
  );

  protected readonly cols = computed(() => {
    const days = this.data();
    if (days.length === 0) return [];
    const usable = W - PAD_X * 2;
    const colW = usable / days.length;
    const barW = Math.max(4, (colW - BAR_GAP * 3) / 2);
    const kcalScale = this.kcalScale();
    const proteinScale = this.proteinScale();
    const target = this.kcalTarget();
    return days.map((d, i) => {
      const colCenter = PAD_X + colW * (i + 0.5);
      const kcalX = colCenter - barW - BAR_GAP / 2;
      const proteinX = colCenter + BAR_GAP / 2;
      const kcalY = this.toY(d.kcal, kcalScale);
      const proteinY = this.toY(d.protein, proteinScale);
      return {
        key: d.key,
        label: d.label,
        kcal: d.kcal,
        protein: d.protein,
        kcalX, kcalY,
        kcalH: H - PAD_B - kcalY,
        kcalOver: target > 0 && d.kcal > target * 1.1,
        proteinX, proteinY,
        proteinH: H - PAD_B - proteinY,
        barW,
        labelX: colCenter,
      };
    });
  });

  protected readonly ariaLabel = computed(() => {
    const days = this.data();
    if (days.length === 0) return '7-day trends, no data yet';
    const totalK = days.reduce((s, d) => s + d.kcal, 0);
    const totalP = days.reduce((s, d) => s + d.protein, 0);
    const avgK = Math.round(totalK / days.length);
    const avgP = Math.round(totalP / days.length);
    return `7-day trends. Average ${avgK} kcal, ${avgP}g protein per day. Target ${this.kcalTarget()} kcal, ${this.proteinTarget()}g protein.`;
  });

  /** Map a value on a 0..scale axis to a y-pixel inside the chart's
   *  drawable area. Clamps within [PAD_T, H - PAD_B] so absurd values
   *  can't punch through the top of the chart. Non-finite inputs
   *  (NaN, ±Infinity from corrupt firestore records) are treated as 0
   *  so we never emit `NaN` SVG attributes. */
  private toY(value: number, scale: number): number {
    if (scale <= 0) return H - PAD_B;
    const v = Number.isFinite(value) ? value : 0;
    const drawable = H - PAD_T - PAD_B;
    const clipped = Math.max(0, Math.min(scale, v));
    return H - PAD_B - (clipped / scale) * drawable;
  }
}
