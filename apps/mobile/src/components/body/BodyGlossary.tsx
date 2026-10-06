import { Glossary, type GlossarySection } from '@/components/Glossary';

/**
 * What Body's numbers mean, behind the same "?" Today, Trends and Train carry
 * (review 2026-10-06). Body leads with two weights — the latest weigh-in and,
 * under it, "Trend" — and nothing in the app said what a trend weight is or
 * why it disagrees with the scale. Same sheet component, same place in the
 * header; the terms are in the order the hero shows them.
 */
const SECTIONS: GlossarySection[] = [
  {
    title: 'body.glossary.title',
    terms: ['weighIn', 'trend', 'why', 'weekAvg', 'pace', 'chart'],
  },
];

export function BodyGlossary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Glossary
      visible={visible}
      onClose={onClose}
      titleKey="body.glossary.title"
      introKey="body.glossary.intro"
      prefix="body.glossary"
      sections={SECTIONS}
      testID="body-glossary-title"
    />
  );
}
