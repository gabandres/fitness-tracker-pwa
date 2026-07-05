import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type UiSparklineTone = 'accent' | 'sage' | 'ink' | 'ring';

/**
 * Hand-rolled sparkline. Catmull-Rom-smoothed path through the values
 * with a marker dot at the latest point. `nulls` are filtered out so
 * sparse weight series (a missed day) don't put a hole in the line.
 *
 * Empty / single-point series render a muted dashed baseline so the
 * caller surface keeps the same vertical footprint regardless of data.
 *
 * An optional [projection] series continues past the solid line as a
 * dashed segment in the same tone (e.g. a weight-trend forecast). It
 * shares the main series' y-scale so the two read as one line, and the
 * x-axis stretches to fit both — so a sparkline with no projection is
 * pixel-identical to before.
 *
 * Animates `stroke-dashoffset` from full → 0 once on mount via the CSS
 * keyframe in styles-v2.css; honours prefers-reduced-motion through
 * the same shared rule.
 */
@Component({
  selector: 'ui-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="width()"
      [attr.height]="height()"
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      role="img"
      [attr.aria-label]="ariaLabel()"
      style="display:block">
      @if (hasData()) {
        <path
          [attr.d]="pathD()"
          fill="none"
          [attr.stroke]="strokeColor()"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          [attr.stroke-dasharray]="pathLen()"
          [attr.stroke-dashoffset]="pathLen()"
          style="animation: v2-sparkline-draw 400ms var(--v2-ease) forwards;" />
        @if (projectionD()) {
          <path
            [attr.d]="projectionD()"
            fill="none"
            [attr.stroke]="strokeColor()"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-dasharray="3 3"
            opacity="0.5" />
        }
        <circle
          [attr.cx]="lastPoint().x"
          [attr.cy]="lastPoint().y"
          r="2.5"
          [attr.fill]="strokeColor()" />
      } @else {
        <line
          [attr.x1]="2"
          [attr.x2]="width() - 2"
          [attr.y1]="height() / 2"
          [attr.y2]="height() / 2"
          stroke="var(--v2-rule)"
          stroke-width="1"
          stroke-dasharray="3 3" />
      }
    </svg>
  `,
})
export class UiSparkline {
  readonly values = input<readonly (number | null | undefined)[]>([]);
  /** Optional forecast continuing past the solid line, drawn dashed. */
  readonly projection = input<readonly (number | null | undefined)[]>([]);
  readonly width = input<number>(200);
  readonly height = input<number>(48);
  readonly tone = input<UiSparklineTone>('ink');
  readonly ariaLabel = input<string>('trend');

  protected readonly cleaned = computed<number[]>(() =>
    (this.values() ?? []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)),
  );

  protected readonly cleanedProjection = computed<number[]>(() =>
    (this.projection() ?? []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)),
  );

  protected readonly hasData = computed(() => this.cleaned().length >= 2);

  protected readonly strokeColor = computed(() => {
    const t = this.tone();
    if (t === 'accent') return 'var(--v2-accent)';
    if (t === 'sage') return 'var(--v2-sage)';
    if (t === 'ring') return '#ff6a3d';
    return 'var(--v2-ink)';
  });

  /**
   * Lay out the solid (main) and dashed (projection) points on ONE
   * shared scale: y normalised over both series so they read as a
   * single line, x stretched across their combined length. With no
   * projection the layout is identical to the values-only version.
   */
  private readonly layout = computed<{ main: { x: number; y: number }[]; proj: { x: number; y: number }[] }>(() => {
    const vs = this.cleaned();
    if (vs.length < 2) return { main: [], proj: [] };
    const ps = this.cleanedProjection();
    const w = this.width();
    const h = this.height();
    const pad = 4;
    const all = ps.length ? vs.concat(ps) : vs;
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const total = vs.length + ps.length;
    const stepX = (w - pad * 2) / (total - 1);
    const toPoint = (v: number, i: number) => ({
      x: pad + i * stepX,
      y: h - pad - ((v - min) / span) * (h - pad * 2),
    });
    return {
      main: vs.map((v, i) => toPoint(v, i)),
      proj: ps.map((v, k) => toPoint(v, vs.length + k)),
    };
  });

  protected readonly points = computed(() => this.layout().main);

  protected readonly lastPoint = computed(() => {
    const p = this.points();
    return p[p.length - 1] ?? { x: 0, y: 0 };
  });

  protected readonly projectionD = computed(() => {
    const proj = this.layout().proj;
    const main = this.layout().main;
    if (proj.length === 0 || main.length < 2) return '';
    // Anchor the dashed segment at the last solid point so the two
    // lines join without a visible gap.
    const pts = [main[main.length - 1], ...proj];
    let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cx = (prev.x + curr.x) / 2;
      d += ` Q ${cx.toFixed(2)} ${prev.y.toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    }
    return d;
  });

  protected readonly pathD = computed(() => {
    const p = this.points();
    if (p.length < 2) return '';
    let d = `M ${p[0].x.toFixed(2)} ${p[0].y.toFixed(2)}`;
    for (let i = 1; i < p.length; i++) {
      const prev = p[i - 1];
      const curr = p[i];
      const cx = (prev.x + curr.x) / 2;
      d += ` Q ${cx.toFixed(2)} ${prev.y.toFixed(2)} ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
    }
    return d;
  });

  protected readonly pathLen = computed(() => {
    const p = this.points();
    if (p.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < p.length; i++) {
      const dx = p[i].x - p[i - 1].x;
      const dy = p[i].y - p[i - 1].y;
      len += Math.hypot(dx, dy);
    }
    return Math.ceil(len);
  });
}
