import { fireEvent, renderWithProviders as render } from '@/test-utils';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { trendsAnswer } from '@/components/charts/trend-copy';
import { TrendsAnswerCard } from '@/components/TrendsAnswerCard';
import { en } from '@/i18n/en';
import type { TFn } from '@/i18n';

/**
 * UX_AUDIT S24-5 (2026-11-19): Trends says the answer first — which way the
 * weight is going and how the eating compares with the target — or, below the
 * insight gate, the two things that produce that answer.
 */

const t = ((key: keyof typeof en, vars?: Record<string, string | number>) =>
  String(en[key]).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''))) as unknown as TFn;

const base = { loggedThisWeek: 5, weighIns: 4, hasTarget: true, unitSystem: 'imperial' as const, t, locale: 'en' as const };
const plain = (s: string) => s.replace(/ /g, ' ');

describe('trendsAnswer', () => {
  it('says losing and under target in two plain sentences', () => {
    const a = trendsAnswer({ ...base, insights: { avgUnderTarget: 148, weightSlopeLbPerWeek: -0.52 } });
    if (a.kind !== 'sentence') throw new Error('expected a sentence');
    expect(plain(a.weight!)).toBe("You're losing about 0.5 lb a week.");
    expect(plain(a.eating!)).toBe("You're eating about 150 kcal a day under your target.");
    expect(a.needsWeighIns).toBe(false);
  });

  it('shows the rate in kilograms to a metric user', () => {
    const a = trendsAnswer({ ...base, unitSystem: 'metric', insights: { avgUnderTarget: -210, weightSlopeLbPerWeek: 1.1 } });
    if (a.kind !== 'sentence') throw new Error('expected a sentence');
    expect(plain(a.weight!)).toBe("You're gaining about 0.5 kg a week.");
    expect(plain(a.eating!)).toBe("You're eating about 210 kcal a day over your target.");
  });

  it('calls a flat trend steady and a gap inside the dead band on target', () => {
    const a = trendsAnswer({ ...base, insights: { avgUnderTarget: 12, weightSlopeLbPerWeek: 0.04 } });
    if (a.kind !== 'sentence') throw new Error('expected a sentence');
    expect(a.weight).toBe('Your weight is holding steady.');
    expect(a.eating).toBe("You're eating right at your target.");
  });

  it('asks for weigh-ins instead of inventing a direction', () => {
    const a = trendsAnswer({ ...base, weighIns: 1, insights: { avgUnderTarget: 300, weightSlopeLbPerWeek: null } });
    if (a.kind !== 'sentence') throw new Error('expected a sentence');
    expect(a.weight).toBeNull();
    expect(a.needsWeighIns).toBe(true);
  });

  it('says nothing about eating without a target', () => {
    const a = trendsAnswer({ ...base, hasTarget: false, insights: { avgUnderTarget: 300, weightSlopeLbPerWeek: -1 } });
    if (a.kind !== 'sentence') throw new Error('expected a sentence');
    expect(a.eating).toBeNull();
  });

  it('is a checklist below the insight gate, with counts capped at what is needed', () => {
    expect(trendsAnswer({ ...base, insights: null, loggedThisWeek: 1, weighIns: 5 })).toEqual({
      kind: 'checklist',
      foodDays: 1,
      foodNeeded: 3,
      weighIns: 2,
      weighInsNeeded: 2,
    });
  });
});

describe('TrendsAnswerCard', () => {
  it('opens the add sheet and the weigh-in sheet from the two open steps', async () => {
    const onLogFood = jest.fn();
    const onLogWeight = jest.fn();
    const ui = await render(
      <TrendsAnswerCard
        answer={{ kind: 'checklist', foodDays: 1, foodNeeded: 3, weighIns: 0, weighInsNeeded: 2 }}
        onLogFood={onLogFood}
        onLogWeight={onLogWeight}
      />,
    );
    expect(ui.getByText(en['trends.answer.checklistTitle'])).toBeTruthy();
    await fireEvent.press(ui.getByTestId('trends-step-food'));
    await fireEvent.press(ui.getByTestId('trends-step-weigh'));
    expect(onLogFood).toHaveBeenCalledTimes(1);
    expect(onLogWeight).toHaveBeenCalledTimes(1);
  });

  it('a finished step is a statement, not a button', async () => {
    const ui = await render(
      <TrendsAnswerCard
        answer={{ kind: 'checklist', foodDays: 1, foodNeeded: 3, weighIns: 2, weighInsNeeded: 2 }}
        onLogFood={jest.fn()}
        onLogWeight={jest.fn()}
      />,
    );
    expect(ui.getByTestId('trends-step-weigh').props.accessibilityRole).toBeUndefined();
    expect(ui.getByTestId('trends-step-food').props.accessibilityRole).toBe('button');
  });

  it('draws the sentences and offers the weigh-in when the direction is unknown', async () => {
    const onLogWeight = jest.fn();
    const ui = await render(
      <TrendsAnswerCard
        answer={{ kind: 'sentence', weight: null, eating: "You're eating right at your target.", needsWeighIns: true }}
        onLogFood={jest.fn()}
        onLogWeight={onLogWeight}
      />,
    );
    expect(ui.getByTestId('trends-answer-eating')).toHaveTextContent("You're eating right at your target.");
    await fireEvent.press(ui.getByTestId('trends-answer-weigh'));
    expect(onLogWeight).toHaveBeenCalledTimes(1);
  });
});
