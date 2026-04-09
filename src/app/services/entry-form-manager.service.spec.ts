import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { signal } from '@angular/core';
import { EntryFormManager } from './entry-form-manager.service';
import { FitnessStore } from './fitness-store.service';
import { DailyLog } from './firebase.service';

describe('EntryFormManager', () => {
  let form: EntryFormManager;
  let mockStore: {
    addLog: ReturnType<typeof vi.fn>;
    updateLog: ReturnType<typeof vi.fn>;
    deleteLog: ReturnType<typeof vi.fn>;
    addPreset: ReturnType<typeof vi.fn>;
    deletePreset: ReturnType<typeof vi.fn>;
    presets: ReturnType<typeof signal>;
  };

  beforeEach(() => {
    mockStore = {
      addLog: vi.fn().mockResolvedValue(undefined),
      updateLog: vi.fn().mockResolvedValue(undefined),
      deleteLog: vi.fn().mockResolvedValue(undefined),
      addPreset: vi.fn().mockResolvedValue(undefined),
      deletePreset: vi.fn().mockResolvedValue(undefined),
      presets: signal([]),
    };

    TestBed.configureTestingModule({
      providers: [
        EntryFormManager,
        { provide: FitnessStore, useValue: mockStore },
      ],
    });

    form = TestBed.inject(EntryFormManager);
  });

  const makeMeal = (overrides?: Partial<DailyLog>): DailyLog => ({
    id: 'meal-1',
    calories: 500,
    date: new Date(2026, 3, 7, 12, 0, 0),
    protein: 30,
    weight: 180,
    liftCompleted: true,
    cardioCompleted: false,
    mealLabel: 'Lunch',
    ...overrides,
  });

  // ── Initial state ───────────────────────────────────────────

  it('should have default state', () => {
    expect(form.mode()).toBe('view');
    expect(form.status()).toBe('idle');
    expect(form.editTarget()).toBeNull();
    expect(form.addingForDay()).toBeNull();
    expect(form.calories()).toBeNull();
    expect(form.protein()).toBeNull();
    expect(form.liftDone()).toBe(false);
    expect(form.cardioDone()).toBe(false);
    expect(form.mealLabel()).toBe('');
    expect(form.savingPreset()).toBe(false);
  });

  // ── startAdd ────────────────────────────────────────────────

  it('should enter add mode', () => {
    form.startAdd();
    expect(form.mode()).toBe('add');
    expect(form.addingForDay()).toBeNull();
    expect(form.editTarget()).toBeNull();
    expect(form.status()).toBe('idle');
  });

  it('should enter add mode for a specific day', () => {
    form.startAdd('2026-04-05');
    expect(form.mode()).toBe('add');
    expect(form.addingForDay()).toBe('2026-04-05');
    expect(form.entryDate()).toBe('2026-04-05');
  });

  it('should reset form fields on startAdd', () => {
    form.calories.set(500);
    form.protein.set(30);
    form.liftDone.set(true);
    form.startAdd();
    expect(form.calories()).toBeNull();
    expect(form.protein()).toBeNull();
    expect(form.liftDone()).toBe(false);
  });

  // ── onTapMeal ───────────────────────────────────────────────

  it('should enter edit mode and populate fields', () => {
    const meal = makeMeal();
    form.onTapMeal(meal);
    expect(form.mode()).toBe('edit');
    expect(form.editTarget()).toBe(meal);
    expect(form.calories()).toBe(500);
    expect(form.protein()).toBe(30);
    expect(form.liftDone()).toBe(true);
    expect(form.cardioDone()).toBe(false);
    expect(form.mealLabel()).toBe('Lunch');
  });

  it('should toggle off when tapping same meal', () => {
    const meal = makeMeal();
    form.onTapMeal(meal);
    expect(form.mode()).toBe('edit');
    form.onTapMeal(meal);
    expect(form.mode()).toBe('view');
    expect(form.editTarget()).toBeNull();
  });

  it('should switch to different meal', () => {
    form.onTapMeal(makeMeal({ id: 'meal-1' }));
    form.onTapMeal(makeMeal({ id: 'meal-2', calories: 700 }));
    expect(form.editTarget()?.id).toBe('meal-2');
    expect(form.calories()).toBe(700);
  });

  // ── cancel ──────────────────────────────────────────────────

  it('should reset everything on cancel', () => {
    form.startAdd('2026-04-05');
    form.calories.set(300);
    form.cancel();
    expect(form.mode()).toBe('view');
    expect(form.editTarget()).toBeNull();
    expect(form.addingForDay()).toBeNull();
    expect(form.calories()).toBeNull();
    expect(form.status()).toBe('idle');
  });

  // ── applyEstimate ───────────────────────────────────────────

  it('should prefill form from estimate', () => {
    form.applyEstimate({ calories: 450, protein: 25, label: 'Chicken salad' });
    expect(form.calories()).toBe(450);
    expect(form.protein()).toBe(25);
    expect(form.mealLabel()).toBe('Chicken salad');
    expect(form.activePresetName()).toBe('Chicken salad');
  });

  it('should not overwrite protein when estimate has null', () => {
    form.protein.set(40);
    form.applyEstimate({ calories: 300, protein: null, label: 'Snack' });
    expect(form.protein()).toBe(40);
    expect(form.calories()).toBe(300);
  });

  // ── submit ──────────────────────────────────────────────────

  it('should reject when calories is null', async () => {
    form.startAdd();
    await form.submit();
    expect(form.status()).toBe('error');
    expect(form.errorMsg()).toBe('Calories are required.');
    expect(mockStore.addLog).not.toHaveBeenCalled();
  });

  it('should call addLog in add mode', async () => {
    form.startAdd();
    form.calories.set(600);
    form.protein.set(35);
    form.liftDone.set(true);
    await form.submit();
    expect(mockStore.addLog).toHaveBeenCalledTimes(1);
    const entry = mockStore.addLog.mock.calls[0][0];
    expect(entry.calories).toBe(600);
    expect(entry.protein).toBe(35);
    expect(entry.liftCompleted).toBe(true);
    expect(form.status()).toBe('saved');
  });

  it('should call updateLog in edit mode', async () => {
    const meal = makeMeal();
    form.onTapMeal(meal);
    form.calories.set(700);
    await form.submit();
    expect(mockStore.updateLog).toHaveBeenCalledWith('meal-1', expect.objectContaining({ calories: 700 }));
    expect(form.status()).toBe('saved');
  });

  it('should clear protein when removed in edit mode', async () => {
    const meal = makeMeal({ protein: 30 });
    form.onTapMeal(meal);
    form.protein.set(null); // user clears protein
    await form.submit();
    const entry = mockStore.updateLog.mock.calls[0][1];
    expect(entry.protein).toBeUndefined();
    expect(entry.calories).toBe(500);
  });

  it('should clear mealLabel when removed in edit mode', async () => {
    const meal = makeMeal({ mealLabel: 'Lunch' });
    form.onTapMeal(meal);
    form.mealLabel.set(''); // user clears label
    form.activePresetName.set(null);
    await form.submit();
    const entry = mockStore.updateLog.mock.calls[0][1];
    expect(entry.mealLabel).toBeUndefined();
  });

  it('should set error on submit failure', async () => {
    mockStore.addLog.mockRejectedValueOnce(new Error('Network error'));
    form.startAdd();
    form.calories.set(400);
    await form.submit();
    expect(form.status()).toBe('error');
    expect(form.errorMsg()).toBe('Network error');
  });

  it('should parse entryDate to noon-local timestamp', async () => {
    form.startAdd();
    form.calories.set(500);
    form.entryDate.set('2026-04-07');
    await form.submit();
    const entry = mockStore.addLog.mock.calls[0][0];
    expect(entry.timestamp.getFullYear()).toBe(2026);
    expect(entry.timestamp.getMonth()).toBe(3); // April = 3
    expect(entry.timestamp.getDate()).toBe(7);
    expect(entry.timestamp.getHours()).toBe(12);
  });

  it('should use mealLabel from form, fallback to activePresetName', async () => {
    form.startAdd();
    form.calories.set(500);
    form.activePresetName.set('Preset Name');
    await form.submit();
    expect(mockStore.addLog.mock.calls[0][0].mealLabel).toBe('Preset Name');

    mockStore.addLog.mockClear();
    form.startAdd();
    form.calories.set(500);
    form.mealLabel.set('Custom Label');
    form.activePresetName.set('Preset Name');
    await form.submit();
    expect(mockStore.addLog.mock.calls[0][0].mealLabel).toBe('Custom Label');
  });

  // ── deleteEntry ─────────────────────────────────────────────

  it('should delete and cancel', async () => {
    form.onTapMeal(makeMeal());
    await form.deleteEntry();
    expect(mockStore.deleteLog).toHaveBeenCalledWith('meal-1');
    expect(form.mode()).toBe('view');
  });

  it('should do nothing if no editTarget', async () => {
    await form.deleteEntry();
    expect(mockStore.deleteLog).not.toHaveBeenCalled();
  });

  it('should set error on delete failure', async () => {
    mockStore.deleteLog.mockRejectedValueOnce(new Error('Delete failed'));
    form.onTapMeal(makeMeal());
    await form.deleteEntry();
    expect(form.status()).toBe('error');
    expect(form.errorMsg()).toBe('Delete failed');
  });

  // ── Preset save flow ────────────────────────────────────────

  it('should enter preset save flow', () => {
    form.promptSavePreset();
    expect(form.savingPreset()).toBe(true);
    expect(form.presetName()).toBe('');
  });

  it('should save preset with current values', async () => {
    form.calories.set(500);
    form.protein.set(30);
    form.presetName.set('My Preset');
    await form.confirmSavePreset();
    expect(mockStore.addPreset).toHaveBeenCalledWith({
      name: 'My Preset',
      calories: 500,
      protein: 30,
    });
    expect(form.savingPreset()).toBe(false);
  });

  it('should not save preset with empty name', async () => {
    form.calories.set(500);
    form.presetName.set('   ');
    await form.confirmSavePreset();
    expect(mockStore.addPreset).not.toHaveBeenCalled();
  });

  it('should not save preset with null calories', async () => {
    form.presetName.set('Test');
    await form.confirmSavePreset();
    expect(mockStore.addPreset).not.toHaveBeenCalled();
  });
});
