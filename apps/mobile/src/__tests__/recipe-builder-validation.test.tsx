import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { RecipeBuilder } from '@/components/RecipeBuilder';
import { RecipeImport } from '@/components/RecipeImport';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

/**
 * Audit 2026-10-15 #19: the recipe builder dropped garbage and negative
 * numbers from its sum without a word, and enabled "Use this" on a per-serving
 * total that rounds to 0 kcal; the importer's Fetch was under-sized and said
 * nothing while busy.
 */
it('marks a typo invalid and holds "Use this" rather than summing around it', async () => {
  const onApply = jest.fn();
  const view = await render(<RecipeBuilder onApply={onApply} onCancel={jest.fn()} />);
  await act(async () => { fireEvent.changeText(view.getByTestId('recipe-ing-kcal-0'), '300'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('recipe-ing-kcal-1'), '-50'); });
  expect(view.getByTestId('recipe-invalid')).toBeTruthy();
  expect(view.getByTestId('recipe-apply').props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => { fireEvent.press(view.getByTestId('recipe-apply')); });
  expect(onApply).not.toHaveBeenCalled();
});

it('does not enable "Use this" for a serving that rounds to 0 kcal', async () => {
  const view = await render(<RecipeBuilder onApply={jest.fn()} onCancel={jest.fn()} />);
  await act(async () => { fireEvent.changeText(view.getByTestId('recipe-ing-kcal-0'), '1'); });
  await act(async () => { fireEvent.changeText(view.getByTestId('recipe-servings'), '4'); });
  expect(view.getByTestId('recipe-apply').props.accessibilityState).toMatchObject({ disabled: true });
  expect(view.getByTestId('recipe-invalid')).toBeTruthy();
});

it('gives Fetch a full target and a busy state', async () => {
  const view = await render(<RecipeImport onApply={jest.fn()} onCancel={jest.fn()} />);
  const btn = view.getByTestId('recipe-import-fetch');
  expect(btn.props.accessibilityState).toMatchObject({ busy: false });
});
