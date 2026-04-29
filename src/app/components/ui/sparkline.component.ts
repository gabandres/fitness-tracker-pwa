import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type V2SparklineTone = 'accent' | 'sage' | 'ink';

/**
 * Hand-rolled sparkline. Catmull-Rom-smoothed path through the values
 * with a marker dot at the latest point. `nulls` are filtered out so
 * sparse weight series (a missed day) don't put a hole in the line.
 *
 * Empty / single-point series render a muted dashed baseline so the
 * caller surface keeps the same vertical footprint regardless of data.
 *
 * Animates `stroke-dashoffset` from full → 0 once on mount via the CSS
 * keyframe in styles-v2.css; honours prefers-reduced-motion through
 * the same shared rule.
 */
@Component({
  selector: 'v2-sparkline',
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
export class V2Sparkline {
  readonly values = input<readonly (number | null | undefined)[]>([]);
  readonly width = input<number>(200);
  readonly height = input<number>(48);
  readonly tone = input<V2SparklineTone>('ink');
  readonly ariaLabel = input<string>('trend');

  protected readonly cleaned = computed<number[]>(() =>
    (this.values() ?? []).filter((v): v is number => typeof v === 'number' && !Number.isNaN(v)),
  );

  protected readonly hasData = computed(() => this.cleaned().length >= 2);

  protected readonly strokeColor = computed(() => {
    const t = this.tone();
    if (t === 'accent') return 'var(--v2-accent)';
    if (t === 'sage') return 'var(--v2-sage)';
    return 'var(--v2-ink)';
  });

  protected readonly points = computed<{ x: number; y: number }[]>(() => {
    const vs = this.cleaned();
    if (vs.length < 2) return [];
    const w = this.width();
    const h = this.height();
    const pad = 4;
    const min = Math.min(...vs);
    const max = Math.max(...vs);
    const span = max - min || 1;
    const stepX = (w - pad * 2) / (vs.length - 1);
    return vs.map((v, i) => ({
      x: pad + i * stepX,
      y: h - pad - ((v - min) / span) * (h - pad * 2),
    }));
  });

  protected readonly lastPoint = computed(() => {
    const p = this.points();
    return p[p.length - 1] ?? { x: 0, y: 0 };
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
