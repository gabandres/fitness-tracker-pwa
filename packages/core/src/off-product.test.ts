import { describe, expect, it } from 'vitest';
import {
  OffLookupError,
  resolveOffProduct,
  type OffResponse,
} from './off-product';

const BARCODE = '3017620422003';

/** Minimal success payload — spread a `product` over it per case. */
function payload(product: OffResponse['product']): OffResponse {
  return { status: 'success', product };
}

describe('resolveOffProduct — basis precedence', () => {
  it('prefers the per-serving basis when the product declares a serving weight', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Cookies',
        serving_quantity: 30,
        nutriments: {
          'energy-kcal_serving': 150,
          proteins_serving: 2,
          carbohydrates_serving: 20,
          fat_serving: 7,
          'energy-kcal_100g': 500,
          proteins_100g: 6.7,
        },
      }),
      BARCODE,
    );
    expect(r.grams).toBe(30);
    expect(r.calories).toBe(150);
    expect(r.protein).toBe(2);
    expect(r.carbs).toBe(20);
    expect(r.fat).toBe(7);
  });

  it('falls back to per-100g when there is no serving weight', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Spread',
        nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9 },
      }),
      BARCODE,
    );
    expect(r.grams).toBe(100);
    expect(r.calories).toBe(539);
    expect(r.protein).toBe(6);
    expect(r.carbs).toBe(58);
    expect(r.fat).toBe(31);
  });

  it('falls back to per-100g when a serving weight exists but per-serving kcal do not', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Cereal',
        serving_quantity: 40,
        nutriments: { 'energy-kcal_100g': 380, proteins_100g: 8 },
      }),
      BARCODE,
    );
    expect(r.grams).toBe(100);
    expect(r.calories).toBe(380);
  });

  it('reports null grams for per-serving macros with no declared weight', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Protein bar',
        nutriments: { 'energy-kcal_serving': 210, proteins_serving: 20 },
      }),
      BARCODE,
    );
    expect(r.grams).toBeNull();
    expect(r.calories).toBe(210);
    expect(r.protein).toBe(20);
    // grams is omitted from the serving context rather than fabricated.
    expect(r.serving.grams).toBeUndefined();
  });
});

describe('resolveOffProduct — field coercion', () => {
  it('converts kJ to kcal when OFF has no kcal field', () => {
    const r = resolveOffProduct(
      payload({ product_name: 'Juice', nutriments: { energy_100g: 2252 } }),
      BARCODE,
    );
    // 2252 / 4.184 = 538.2…
    expect(r.calories).toBe(538);
  });

  it('parses a numeric-string serving_quantity', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Yogurt',
        serving_quantity: '125',
        nutriments: { 'energy-kcal_serving': 90 },
      }),
      BARCODE,
    );
    expect(r.grams).toBe(125);
  });

  it.each([0, -30, Number.NaN, undefined])(
    'ignores a serving_quantity of %p and uses per-100g',
    (sq) => {
      const r = resolveOffProduct(
        payload({
          product_name: 'Snack',
          serving_quantity: sq as number,
          nutriments: { 'energy-kcal_serving': 150, 'energy-kcal_100g': 400 },
        }),
        BARCODE,
      );
      expect(r.grams).toBe(100);
      expect(r.calories).toBe(400);
    },
  );

  it('rounds every macro to a whole number', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Cake',
        serving_quantity: 31.7,
        nutriments: {
          'energy-kcal_serving': 140.4,
          proteins_serving: 1.58,
          carbohydrates_serving: 19.4,
          fat_serving: 6.34,
        },
      }),
      BARCODE,
    );
    expect(r).toMatchObject({ calories: 140, protein: 2, carbs: 19, fat: 6 });
    // ...but grams stays exact — it is a measured weight, not a macro.
    expect(r.grams).toBe(31.7);
  });
});

describe('resolveOffProduct — naming', () => {
  it('falls back product_name → generic_name → "Unknown product"', () => {
    const n = { 'energy-kcal_100g': 100 };
    expect(resolveOffProduct(payload({ product_name: 'A', generic_name: 'B', nutriments: n }), BARCODE).productName).toBe('A');
    expect(resolveOffProduct(payload({ generic_name: 'B', nutriments: n }), BARCODE).productName).toBe('B');
    expect(resolveOffProduct(payload({ nutriments: n }), BARCODE).productName).toBe('Unknown product');
  });

  it('takes the first brand and omits the field when there is none', () => {
    const n = { 'energy-kcal_100g': 100 };
    expect(resolveOffProduct(payload({ brands: 'Nutella, Ferrero, Yum yum', nutriments: n }), BARCODE).brand).toBe('Nutella');
    expect(resolveOffProduct(payload({ nutriments: n }), BARCODE).brand).toBeUndefined();
    expect(resolveOffProduct(payload({ brands: '   ', nutriments: n }), BARCODE).brand).toBeUndefined();
  });

  it('truncates a long name to 100 chars and a long brand to 80', () => {
    const r = resolveOffProduct(
      payload({ product_name: 'x'.repeat(200), brands: 'y'.repeat(200), nutriments: { 'energy-kcal_100g': 100 } }),
      BARCODE,
    );
    expect(r.productName).toHaveLength(100);
    expect(r.brand).toHaveLength(80);
  });
});

describe('resolveOffProduct — serving context', () => {
  it('assembles the barcode-keyed save context both frontends used to build by hand', () => {
    const r = resolveOffProduct(
      payload({
        product_name: 'Cookies',
        brands: 'Brand',
        serving_quantity: 30,
        nutriments: { 'energy-kcal_serving': 150 },
      }),
      BARCODE,
    );
    expect(r.serving).toEqual({
      grams: 30,
      source: 'barcode',
      barcode: BARCODE,
      brand: 'Brand',
      name: 'Cookies',
    });
  });
});

describe('resolveOffProduct — failures', () => {
  it('throws FOOD_NOT_FOUND on a failure status', () => {
    expect(() => resolveOffProduct({ status: 'failure' }, BARCODE)).toThrow(OffLookupError);
    try {
      resolveOffProduct({ status: 'failure' }, BARCODE);
    } catch (e) {
      expect((e as OffLookupError).code).toBe('FOOD_NOT_FOUND');
    }
  });

  it('throws FOOD_NOT_FOUND when the payload has no product', () => {
    try {
      resolveOffProduct({ status: 'success' }, BARCODE);
      expect.unreachable();
    } catch (e) {
      expect((e as OffLookupError).code).toBe('FOOD_NOT_FOUND');
    }
  });

  it('throws FOOD_NO_NUTRITION, carrying the name, when no basis yields calories', () => {
    try {
      resolveOffProduct(payload({ product_name: 'Mystery', nutriments: { proteins_100g: 5 } }), BARCODE);
      expect.unreachable();
    } catch (e) {
      expect((e as OffLookupError).code).toBe('FOOD_NO_NUTRITION');
      expect((e as OffLookupError).productName).toBe('Mystery');
    }
  });

  it('never puts a user-facing English string on the error', () => {
    try {
      resolveOffProduct({ status: 'failure' }, BARCODE);
      expect.unreachable();
    } catch (e) {
      // The message IS the code — callers translate, this module does not.
      expect((e as Error).message).toBe('FOOD_NOT_FOUND');
    }
  });
});

describe('resolveOffProduct — preserved asymmetry', () => {
  it('reports 0 protein but null carbs/fat when OFF omits them', () => {
    // Deliberately locked in, not endorsed: an unreported protein resolves to
    // a fabricated 0 while carbs/fat resolve to null ("unknown"). Both original
    // per-frontend copies did this. Making all three honest is a product
    // decision with its own commit — this test is what makes it a one-liner.
    const r = resolveOffProduct(
      payload({ product_name: 'Water', nutriments: { 'energy-kcal_100g': 0 } }),
      BARCODE,
    );
    expect(r.protein).toBe(0);
    expect(r.carbs).toBeNull();
    expect(r.fat).toBeNull();
  });
});

/**
 * Real Open Food Facts v3 responses, captured 2026-07-30 from
 * `GET https://world.openfoodfacts.org/api/v3/product/{barcode}` and trimmed to
 * the fields this rule reads. These pin the field NAMES to what OFF actually
 * returns — the hand-built cases above only test the rule against our reading
 * of the API. If OFF renames a nutriment key, these are what break.
 */
describe('resolveOffProduct — real OFF v3 payloads', () => {
  it('resolves Nutella (3017620422003) on the per-100g basis — no serving weight declared', () => {
    const real: OffResponse = {
      status: 'success',
      product: {
        code: '3017620422003',
        product_name: 'Nutella',
        generic_name: 'Pâte à tartiner aux noisettes et au cacao',
        brands: 'Nutella, Ferrero, Yum yum',
        nutriments: {
          'energy-kcal_100g': 539,
          energy_100g: 2252,
          proteins_100g: 6.3,
          carbohydrates_100g: 57.5,
          fat_100g: 30.9,
        },
      },
    };
    expect(resolveOffProduct(real, '3017620422003')).toEqual({
      calories: 539,
      protein: 6,
      carbs: 58,
      fat: 31,
      productName: 'Nutella',
      brand: 'Nutella',
      grams: 100,
      serving: { grams: 100, source: 'barcode', barcode: '3017620422003', brand: 'Nutella', name: 'Nutella' },
    });
  });

  it('resolves Magdalenas Cuadradas (20221126) on the per-serving basis — serving_quantity 31.7', () => {
    const real: OffResponse = {
      status: 'success',
      product: {
        code: '20221126',
        product_name: 'Magdalenas Cuadradas',
        generic_name: 'Producto de pastelería y repostería',
        brands: 'La Cestera',
        serving_size: '31,7 g',
        serving_quantity: 31.7,
        nutriments: {
          'energy-kcal_serving': 140,
          energy_serving: 588,
          'energy-kcal_100g': 442,
          energy_100g: 1855,
          proteins_serving: 1.58,
          carbohydrates_serving: 19,
          fat_serving: 6.34,
          proteins_100g: 5,
          carbohydrates_100g: 60,
          fat_100g: 20,
        },
      },
    };
    const r = resolveOffProduct(real, '20221126');
    // The per-serving basis wins over the per-100g one that is also present.
    expect(r).toMatchObject({ calories: 140, protein: 2, carbs: 19, fat: 6, grams: 31.7 });
    expect(r.brand).toBe('La Cestera');
  });
});
