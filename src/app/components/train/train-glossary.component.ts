import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiSheet } from '../ui/sheet.component';

/** One term → definition pair. `key` is the i18n leaf under `train.glossary`;
 *  its body is the same leaf + `Body`, so the template stays a flat loop and a
 *  new term is one line in each locale file plus one entry here. */
interface GlossaryTerm {
  key: string;
}

/**
 * Plain-language definitions for every piece of training vocabulary the Train
 * tab puts on screen — RIR, set types, clusters, auto-progression, est. 1RM,
 * volume, plate math.
 *
 * It exists because the logger is dense with lifting jargon that is only
 * obvious to people who already lift that way: a user asked what RIR was, and
 * RIR was one of ten undefined terms on the same screen. Reachable from the
 * session sheet, the template editor and the Train header, so the answer is
 * never more than one tap from the word that prompted the question.
 */
@Component({
  selector: 'app-train-glossary',
  standalone: true,
  imports: [TranslocoDirective, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <ui-sheet [labelledBy]="'train-glossary-title'" (close)="closed.emit()">
        <header class="mb-3">
          <h2 id="train-glossary-title" class="v2-h2">{{ t('train.glossary.title') }}</h2>
          <p class="v2-caption mt-1" style="color: var(--v2-ink-muted);">
            {{ t('train.glossary.intro') }}
          </p>
        </header>

        @for (section of sections; track section.title) {
          <section class="mb-4">
            <h3
              class="v2-caption mb-2"
              style="font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--v2-ink-muted);">
              {{ t('train.glossary.' + section.title) }}
            </h3>
            <dl class="m-0">
              @for (term of section.terms; track term.key) {
                <div class="mb-3">
                  <dt class="v2-body" style="font-weight: 600;">
                    {{ t('train.glossary.' + term.key) }}
                  </dt>
                  <dd class="v2-caption m-0 mt-0.5" style="color: var(--v2-ink-muted);">
                    {{ t('train.glossary.' + term.key + 'Body') }}
                  </dd>
                </div>
              }
            </dl>
          </section>
        }
      </ui-sheet>
    </ng-container>
  `,
})
export class TrainGlossaryComponent {
  readonly closed = output<void>();

  /** Ordered as the terms are met: logging a set first (every workout), then
   *  the progress machinery, then the barbell tools panel. */
  protected readonly sections: { title: string; terms: GlossaryTerm[] }[] = [
    {
      title: 'sectionLogging',
      terms: [{ key: 'rir' }, { key: 'setTypes' }, { key: 'cluster' }, { key: 'rest' }],
    },
    {
      title: 'sectionProgress',
      terms: [
        { key: 'progression' },
        { key: 'suggest' },
        { key: 'last' },
        { key: 'pr' },
        { key: 'e1rm' },
        { key: 'volume' },
        { key: 'topSet' },
      ],
    },
    {
      title: 'sectionPlates',
      terms: [{ key: 'perSide' }, { key: 'short' }, { key: 'warmupPct' }],
    },
  ];
}
