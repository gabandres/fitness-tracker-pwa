import { Glossary, type GlossarySection } from './Glossary';

/**
 * What the numbers on Today and Trends actually mean (UX_AUDIT F6).
 *
 * Today's hero reads `0 / 2,323 kcal` above `maintenance 2,723`; Trends leads
 * with a **MEASURED** badge, *Maintenance estimate* and *73% logging
 * completeness*. Those are the two most-viewed panels in the app and none of
 * those words was defined anywhere in it. "kcal" appears in 20+ strings where
 * most people would read "calories"; "maintenance" is a word someone who has
 * dieted before knows and nobody else does; and a first-run user has no way to
 * tell whether 73% completeness is good.
 *
 * One list, not two, even though it is opened from two screens: the terms
 * overlap heavily (maintenance appears on both) and splitting them would mean
 * deciding which screen owns a word, then keeping two definitions of it in
 * step. Ordered by where a reader meets them — the hero first, then Trends.
 */
const SECTIONS: GlossarySection[] = [
  {
    title: 'numbers.glossary.sectionToday',
    terms: ['kcal', 'target', 'maintenance', 'protein', 'streak'],
  },
  {
    title: 'numbers.glossary.sectionTrends',
    terms: ['measured', 'estimate', 'completeness', 'trend'],
  },
];

export function NumbersGlossary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Glossary
      visible={visible}
      onClose={onClose}
      titleKey="numbers.glossary.title"
      introKey="numbers.glossary.intro"
      prefix="numbers.glossary"
      sections={SECTIONS}
      testID="numbers-glossary-title"
    />
  );
}
