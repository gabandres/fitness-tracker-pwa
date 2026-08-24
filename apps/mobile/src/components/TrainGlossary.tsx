import { Glossary, type GlossarySection } from './Glossary';

/** Term keys under `train.glossary.*`; each has a matching `…Body` entry, so
 *  adding a term is one line here and two per locale. */
const SECTIONS: GlossarySection[] = [
  { title: 'train.glossary.sectionLogging', terms: ['rir', 'setTypes', 'cluster', 'rest'] },
  {
    title: 'train.glossary.sectionProgress',
    terms: ['progression', 'suggest', 'last', 'pr', 'e1rm', 'volume', 'topSet'],
  },
  { title: 'train.glossary.sectionPlates', terms: ['perSide', 'short', 'warmupPct'] },
  // ADR-0025. Last, because it is the newest vocabulary and the smallest — but
  // `ringKcal` is the one entry here that answers a question the UI otherwise
  // raises and never resolves: the block shows a calorie number and the day's
  // budget never moves. Leaving that unexplained reads as a bug.
  { title: 'train.glossary.sectionCardio', terms: ['cardioBlock', 'modality', 'rpe', 'ringKcal'] },
];

/**
 * Plain-language definitions for the Train tab's vocabulary — RIR, set types,
 * clusters, auto-progression, e1RM, volume, plate math, and (ADR-0025) the
 * cardio terms.
 *
 * The logger is dense with terms that only read as obvious to someone who
 * already trains that way: a user asked what RIR meant, and RIR was one of ten
 * undefined words on the same screen. Opened from the "?" on the Train header
 * and from the active session, so the answer is one tap from the question.
 *
 * The rendering moved to `./Glossary` when Today and Trends needed the same
 * thing (UX_AUDIT F6). This file is now just the Train word list — which is
 * all it ever should have been.
 */
export function TrainGlossary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Glossary
      visible={visible}
      onClose={onClose}
      titleKey="train.glossary.title"
      introKey="train.glossary.intro"
      prefix="train.glossary"
      sections={SECTIONS}
      testID="train-glossary-title"
    />
  );
}
