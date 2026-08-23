// Cold-start starter foods. Mirrors the PWA starter-foods component: ~18
// one-tap common foods shown when the user has zero recents/presets, so a
// first-timer can land a meal without the "what do I type?" friction. Tapping
// one prefills the entry form (editable). EN, a PR-localized es-PR list, and a
// BR-localized pt-BR one.
//
// These lists are LOCALIZED, not translated. Translating "Mofongo" into
// Portuguese would put a dish nobody in São Paulo eats at the top of the
// first screen a Brazilian sees — the point of the list is that the first tap
// is something the user actually ate today. So the pt-BR list is its own set
// of foods, and it is metric: Brazil weighs food in grams, and "6oz" in a
// Portuguese label reads as a translation someone forgot to finish.

export interface StarterFood {
  label: string;
  calories: number;
  protein: number;
}

export const STARTER_FOODS_EN: StarterFood[] = [
  { label: 'Coffee, black', calories: 5, protein: 0 },
  { label: 'Latte, tall (12oz)', calories: 150, protein: 6 },
  { label: 'Oatmeal, 1 cup cooked', calories: 150, protein: 5 },
  { label: 'Eggs, 2 large', calories: 140, protein: 12 },
  { label: 'Greek yogurt, 1 cup', calories: 150, protein: 20 },
  { label: 'Chicken breast, 6oz', calories: 280, protein: 54 },
  { label: 'Salmon, 6oz grilled', calories: 340, protein: 40 },
  { label: 'Ground beef 90/10, 4oz', calories: 220, protein: 24 },
  { label: 'White rice, 1 cup', calories: 205, protein: 4 },
  { label: 'Sweet potato, medium', calories: 105, protein: 2 },
  { label: 'Banana', calories: 105, protein: 1 },
  { label: 'Apple', calories: 95, protein: 0 },
  { label: 'Chipotle chicken bowl', calories: 700, protein: 55 },
  { label: 'Big Mac', calories: 550, protein: 25 },
  { label: 'Cheese pizza, 1 slice', calories: 285, protein: 12 },
  { label: 'Pernil, 3oz', calories: 260, protein: 20 },
  { label: 'Tostones, 2 pieces', calories: 160, protein: 1 },
  { label: 'Mofongo, 1 serving', calories: 380, protein: 4 },
];

export const STARTER_FOODS_ES_PR: StarterFood[] = [
  { label: 'Café negro', calories: 5, protein: 0 },
  { label: 'Café con leche', calories: 120, protein: 6 },
  { label: 'Medalla Light, lata', calories: 95, protein: 1 },
  { label: 'Avena Quaker, 1 taza', calories: 150, protein: 5 },
  { label: 'Huevos, 2 grandes', calories: 140, protein: 12 },
  { label: 'Yogur griego, 1 taza', calories: 150, protein: 20 },
  { label: 'Pechuga de pollo, 6oz', calories: 280, protein: 54 },
  { label: 'Salmón a la plancha, 6oz', calories: 340, protein: 40 },
  { label: 'Carne molida 90/10, 4oz', calories: 220, protein: 24 },
  { label: 'Arroz blanco, 1 taza', calories: 205, protein: 4 },
  { label: 'Batata, mediana', calories: 105, protein: 2 },
  { label: 'Guineo', calories: 105, protein: 1 },
  { label: 'Manzana', calories: 95, protein: 0 },
  { label: 'Pernil, 3oz', calories: 260, protein: 20 },
  { label: 'Tostones, 2 piezas', calories: 160, protein: 1 },
  { label: 'Mofongo, 1 porción', calories: 380, protein: 4 },
  { label: 'Arroz con gandules, 1 taza', calories: 220, protein: 5 },
  { label: 'Sorullitos, 3 piezas', calories: 200, protein: 3 },
];

export const STARTER_FOODS_PT_BR: StarterFood[] = [
  { label: 'Café preto', calories: 5, protein: 0 },
  { label: 'Café com leite, 200 ml', calories: 120, protein: 6 },
  { label: 'Pão de queijo, 2 unidades', calories: 160, protein: 4 },
  { label: 'Pão francês com manteiga', calories: 190, protein: 5 },
  { label: 'Ovos, 2 grandes', calories: 140, protein: 12 },
  { label: 'Iogurte grego, 1 pote', calories: 150, protein: 20 },
  { label: 'Peito de frango, 170 g', calories: 280, protein: 54 },
  { label: 'Salmão grelhado, 170 g', calories: 340, protein: 40 },
  { label: 'Patinho moído, 120 g', calories: 220, protein: 24 },
  { label: 'Arroz branco, 1 xícara', calories: 205, protein: 4 },
  { label: 'Feijão carioca, 1 concha', calories: 130, protein: 8 },
  { label: 'Batata-doce, média', calories: 105, protein: 2 },
  { label: 'Banana', calories: 105, protein: 1 },
  { label: 'Maçã', calories: 95, protein: 0 },
  { label: 'Feijoada, 1 porção', calories: 570, protein: 30 },
  { label: 'Coxinha, 1 unidade', calories: 290, protein: 8 },
  { label: 'Açaí com granola, 300 ml', calories: 420, protein: 5 },
  { label: 'Whey protein, 1 dose', calories: 120, protein: 24 },
];

/** Keyed by the same tags as `src/i18n/registry.ts`. A locale with no entry
 *  falls back to the English list rather than showing nothing — so a new
 *  language works before anyone has picked its eighteen foods. */
const BY_LOCALE: Record<string, StarterFood[]> = {
  en: STARTER_FOODS_EN,
  'es-PR': STARTER_FOODS_ES_PR,
  'pt-BR': STARTER_FOODS_PT_BR,
};

export function starterFoods(locale: string): StarterFood[] {
  return BY_LOCALE[locale] ?? STARTER_FOODS_EN;
}
