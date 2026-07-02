import { describe, it, expect } from 'vitest';
import {
  parseNutritionLabel,
  nutritionLabelToServing,
  nutritionLabelToCustomFoodDraft,
} from './nutrition-label';

// Real-world panel text as an OCR engine tends to emit it: mostly line-broken,
// sometimes with the %DV column, sometimes value split from label. The parser
// normalises newlines to spaces, so fixtures use \n freely.

// The canonical modern US FDA vertical panel.
const FDA_STANDARD = `Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g
Vitamin D 2mcg 10%`;

describe('parseNutritionLabel — standard FDA panel', () => {
  const d = parseNutritionLabel(FDA_STANDARD);

  it('reads serving grams from the (NNg) weight, not the household measure', () => {
    expect(d.servingGrams?.value).toBe(55);
  });

  it('reads servings per container', () => {
    expect(d.servingsPerContainer?.value).toBe(8);
  });

  it('reads calories', () => {
    expect(d.calories?.value).toBe(230);
  });

  it('reads Total Fat, not Saturated/Trans Fat', () => {
    expect(d.fat?.value).toBe(8);
  });

  it('reads Total Carbohydrate, not Fiber / Sugars / Added Sugars', () => {
    expect(d.carbs?.value).toBe(37);
  });

  it('reads Protein', () => {
    expect(d.protein?.value).toBe(3);
  });

  it('flags a confident panel', () => {
    expect(d.isLikelyPanel).toBe(true);
  });

  it('keeps the raw matched snippet for transparency', () => {
    expect(d.calories?.raw.toLowerCase()).toContain('calories');
  });
});

describe('parseNutritionLabel — sub-nutrient disambiguation', () => {
  it('does not read Added Sugars grams as carbs', () => {
    const d = parseNutritionLabel(
      'Total Carbohydrate 45g\nDietary Fiber 7g\nAdded Sugars 22g\nProtein 9g',
    );
    expect(d.carbs?.value).toBe(45);
  });

  it('does not read Saturated Fat as Total Fat', () => {
    const d = parseNutritionLabel('Total Fat 12g\nSaturated Fat 3g\nTrans Fat 0g');
    expect(d.fat?.value).toBe(12);
  });

  it('skips the legacy "Calories from Fat" number', () => {
    const d = parseNutritionLabel('Calories 250 Calories from Fat 110');
    expect(d.calories?.value).toBe(250);
  });
});

describe('parseNutritionLabel — formatting robustness', () => {
  it('handles decimals', () => {
    const d = parseNutritionLabel('Total Fat 0.5g\nProtein 1.5g\nTotal Carbohydrate 2.5g');
    expect(d.fat?.value).toBe(0.5);
    expect(d.protein?.value).toBe(1.5);
    expect(d.carbs?.value).toBe(2.5);
  });

  it('handles a space between the number and the "g" unit', () => {
    const d = parseNutritionLabel('Protein 20 g\nTotal Fat 5 g');
    expect(d.protein?.value).toBe(20);
    expect(d.fat?.value).toBe(5);
  });

  it('handles label and value on separate OCR lines', () => {
    const d = parseNutritionLabel('Calories\n180\nProtein\n7g');
    expect(d.calories?.value).toBe(180);
    expect(d.protein?.value).toBe(7);
  });

  it('handles a bare "Serving Size: 30g" without parens', () => {
    const d = parseNutritionLabel('Serving Size: 30g\nCalories 120');
    expect(d.servingGrams?.value).toBe(30);
  });

  it('tolerates "Servings Per Container About 8"', () => {
    const d = parseNutritionLabel('Servings Per Container About 8');
    expect(d.servingsPerContainer?.value).toBe(8);
  });

  it('reads a 0g value (present, not absent)', () => {
    const d = parseNutritionLabel('Total Fat 0g\nProtein 5g');
    expect(d.fat?.value).toBe(0);
    expect(d.fat).toBeDefined();
  });
});

describe('parseNutritionLabel — honest absence', () => {
  it('omits a macro the panel does not state (never a fake zero)', () => {
    const d = parseNutritionLabel('Calories 100\nProtein 5g');
    expect(d.carbs).toBeUndefined();
    expect(d.fat).toBeUndefined();
  });

  it('does not treat random text as a panel', () => {
    const d = parseNutritionLabel('Organic rolled oats, water, sea salt. Best by 2027.');
    expect(d.isLikelyPanel).toBe(false);
    expect(d.calories).toBeUndefined();
  });

  it('flags a panel from the header even with a single macro', () => {
    const d = parseNutritionLabel('Nutrition Facts\nCalories 90');
    expect(d.isLikelyPanel).toBe(true);
  });

  it('flags a panel from ≥2 macros with no header', () => {
    const d = parseNutritionLabel('Protein 8g\nTotal Fat 2g');
    expect(d.isLikelyPanel).toBe(true);
  });
});

describe('nutritionLabelToServing', () => {
  it('collapses a full panel into a grams-first serving snapshot', () => {
    const serving = nutritionLabelToServing(parseNutritionLabel(FDA_STANDARD));
    expect(serving).toEqual({ grams: 55, calories: 230, protein: 3, carbs: 37, fat: 8 });
  });

  it('returns null without serving grams (no honest grams-first serving)', () => {
    const d = parseNutritionLabel('Calories 200\nProtein 10g');
    expect(nutritionLabelToServing(d)).toBeNull();
  });

  it('returns null without calories', () => {
    const d = parseNutritionLabel('Serving size (40g)\nProtein 10g');
    expect(nutritionLabelToServing(d)).toBeNull();
  });

  it('omits optional macros that were absent on the panel', () => {
    const d = parseNutritionLabel('Serving size (40g)\nCalories 150\nProtein 12g');
    expect(nutritionLabelToServing(d)).toEqual({ grams: 40, calories: 150, protein: 12 });
  });
});

describe('nutritionLabelToCustomFoodDraft', () => {
  it('maps a panel to a save-ready label-sourced draft', () => {
    const d = parseNutritionLabel(FDA_STANDARD);
    const draft = nutritionLabelToCustomFoodDraft(d, { name: 'Granola', brand: 'Acme' });
    expect(draft).toEqual({
      name: 'Granola',
      brand: 'Acme',
      source: 'label',
      serving: { grams: 55, calories: 230, protein: 3, carbs: 37, fat: 8 },
    });
  });

  it('rides a scanned barcode along for dedup (source becomes barcode)', () => {
    const d = parseNutritionLabel(FDA_STANDARD);
    const draft = nutritionLabelToCustomFoodDraft(d, { name: 'Granola', barcode: '0123456789012' });
    expect(draft?.source).toBe('barcode');
    expect(draft?.barcode).toBe('0123456789012');
  });

  it('returns null when the panel cannot form a grams-first serving', () => {
    const d = parseNutritionLabel('Calories 100\nProtein 5g'); // no serving grams
    expect(nutritionLabelToCustomFoodDraft(d, { name: 'Mystery' })).toBeNull();
  });
});
