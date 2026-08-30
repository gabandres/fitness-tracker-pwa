import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Presentational primitives for the admin console. All colour comes from the
 * `--adm-*` tokens declared in admin.css, which derive from the app's own
 * `--v2-*` palette (ADR-0014: the same coral, sage, teal, amber and violet the
 * mobile app draws its rings and macros with) — so a chart here and a chart
 * on a phone read as one product.
 */

@Component({
  selector: 'adm-spark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" [attr.width]="w" [attr.height]="h" preserveAspectRatio="none" aria-hidden="true" class="adm-spark">
      @if (area(); as a) { <path [attr.d]="a" [attr.fill]="'var(--adm-' + tone() + ')'" fill-opacity="0.12" /> }
      @if (line(); as l) { <path [attr.d]="l" fill="none" [attr.stroke]="'var(--adm-' + tone() + ')'" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" /> }
      @if (last(); as p) { <circle [attr.cx]="p.x" [attr.cy]="p.y" r="2.25" [attr.fill]="'var(--adm-' + tone() + ')'" /> }
    </svg>
  `,
})
export class AdmSpark {
  readonly values = input.required<readonly number[]>();
  readonly tone = input<'accent' | 'teal' | 'good' | 'warn' | 'violet' | 'info' | 'ink-muted'>('accent');
  readonly w = 120;
  readonly h = 36;

  private readonly points = computed(() => {
    const v = this.values();
    if (v.length === 0) return [] as Array<{ x: number; y: number }>;
    const max = Math.max(1, ...v);
    const stepX = v.length > 1 ? this.w / (v.length - 1) : 0;
    return v.map((n, i) => ({ x: i * stepX, y: this.h - 3 - (n / max) * (this.h - 6) }));
  });
  readonly line = computed(() => {
    const p = this.points();
    return p.length ? p.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ') : '';
  });
  readonly area = computed(() => {
    const p = this.points();
    if (!p.length) return '';
    return `${this.line()} L${p[p.length - 1].x.toFixed(1)} ${this.h} L0 ${this.h} Z`;
  });
  readonly last = computed(() => { const p = this.points(); return p.length ? p[p.length - 1] : null; });
}

@Component({
  selector: 'adm-kpi',
  standalone: true,
  imports: [AdmSpark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-kpi">
      <div class="adm-kpi-head">
        <span class="adm-label">{{ label() }}</span>
        @if (delta() !== null && delta() !== undefined) {
          <span class="adm-delta" [class.up]="delta()! > 0" [class.down]="delta()! < 0">
            {{ delta()! > 0 ? '▲' : delta()! < 0 ? '▼' : '—' }} {{ delta() === 0 ? '0' : abs(delta()!) }}%
          </span>
        }
      </div>
      <div class="adm-kpi-value" [class.adm-kpi-value--sm]="String(value()).length > 8">{{ value() }}</div>
      @if (hint()) { <div class="adm-kpi-hint">{{ hint() }}</div> }
      @if (series(); as s) {
        @if (s.length > 1) { <div class="adm-kpi-spark"><adm-spark [values]="s" [tone]="tone()" /></div> }
      }
    </div>
  `,
})
export class AdmKpi {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly hint = input<string>('');
  readonly delta = input<number | null | undefined>(undefined);
  readonly series = input<readonly number[] | null>(null);
  readonly tone = input<'accent' | 'teal' | 'good' | 'warn' | 'violet' | 'info' | 'ink-muted'>('accent');
  readonly String = String;
  abs(n: number): number { return Math.abs(n); }
}

/** Horizontal proportion bars — platform split, provider split, funnel steps. */
@Component({
  selector: 'adm-bars',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="adm-bars">
      @for (r of rows(); track r.label) {
        <li>
          <div class="adm-bars-row">
            <span class="adm-bars-label">{{ r.label }}</span>
            <span class="adm-bars-value">{{ r.value }}{{ suffix() }} <span class="adm-bars-pct">{{ pctOf(r.value) }}%</span></span>
          </div>
          <div class="adm-bars-track"><div class="adm-bars-fill" [style.width.%]="widthOf(r.value)" [style.background]="'var(--adm-' + (r.tone ?? 'accent') + ')'"></div></div>
        </li>
      }
    </ul>
  `,
})
export class AdmBars {
  readonly rows = input.required<ReadonlyArray<{ label: string; value: number; tone?: string }>>();
  /** When `relativeTo` is 'max' each bar is scaled to the largest row; when
   *  'total' to the sum (a true share). Funnels want 'max'; splits want 'total'. */
  readonly relativeTo = input<'max' | 'total'>('total');
  readonly suffix = input<string>('');
  private total(): number { return this.rows().reduce((a, r) => a + r.value, 0); }
  private max(): number { return Math.max(1, ...this.rows().map((r) => r.value)); }
  pctOf(v: number): number { const t = this.total(); return t ? Math.round((v / t) * 100) : 0; }
  widthOf(v: number): number {
    const base = this.relativeTo() === 'max' ? this.max() : this.total();
    return base ? Math.max(1.5, (v / base) * 100) : 0;
  }
}

/** Big-number + label used for retention checkpoints and ceilings. */
@Component({
  selector: 'adm-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-meter">
      <div class="adm-meter-head"><span class="adm-label">{{ label() }}</span><span class="adm-meter-value">{{ display() }}</span></div>
      <div class="adm-bars-track"><div class="adm-bars-fill" [style.width.%]="ratio() * 100" [style.background]="'var(--adm-' + tone() + ')'"></div></div>
      @if (hint()) { <div class="adm-kpi-hint">{{ hint() }}</div> }
    </div>
  `,
})
export class AdmMeter {
  readonly label = input.required<string>();
  readonly ratio = input.required<number>();
  readonly display = input.required<string>();
  readonly hint = input<string>('');
  readonly tone = input<string>('accent');
}
