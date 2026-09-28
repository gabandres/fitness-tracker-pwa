/**
 * `CountUpText` is a read-only TextInput (the Reanimated UI-thread text
 * trick), which VoiceOver announced as an EDIT BOX on the Today hero, the
 * Trends maintenance number and the plan numerals (UX_AUDIT S18-5). It must
 * read as static text carrying the landing value, and it must cap font
 * scaling so the 72-pt numerals do not clip.
 */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

import React from 'react';
import { renderWithProviders as render } from '@/test-utils';
import { CountUpText } from '@/lib/motion';

it('is announced as text carrying the formatted target value', async () => {
  const ui = await render(<CountUpText value={1234} suffix=" kcal" testID="n" />);
  const input = ui.getByTestId('n');
  expect(input.props.accessibilityRole).toBe('text');
  expect(input.props.accessibilityLabel).toBe('1,234 kcal');
});

it('takes a caller-supplied label when the numeral is half the sentence', async () => {
  const ui = await render(<CountUpText value={3} accessibilityLabel="3 workouts" testID="n" />);
  expect(ui.getByTestId('n').props.accessibilityLabel).toBe('3 workouts');
});

it('caps font scaling at 1.4 by default, on the input and on the ghost that sizes it', async () => {
  const ui = await render(<CountUpText value={72} testID="n" />);
  expect(ui.getByTestId('n').props.maxFontSizeMultiplier).toBe(1.4);
  // The ghost is the only thing Yoga measures; if it scaled further than the
  // input the box would be wrong in the other direction.
  // Hidden from the a11y tree on purpose, so the query has to say so.
  expect(ui.getByTestId('n-ghost', { includeHiddenElements: true }).props.maxFontSizeMultiplier).toBe(1.4);
});

it('honours an explicit multiplier', async () => {
  const ui = await render(<CountUpText value={1} maxFontSizeMultiplier={2} testID="n" />);
  expect(ui.getByTestId('n').props.maxFontSizeMultiplier).toBe(2);
});
