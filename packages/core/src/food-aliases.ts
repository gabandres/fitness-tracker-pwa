/**
 * Spanish and Portuguese food names → the English term the food database
 * actually indexes.
 *
 * ## Why this exists
 *
 * The parser has been bilingual since ADR-0013 and now speaks three languages,
 * but the bundled USDA index carries **English descriptions only**. So
 * `2 cucharadas de mantequilla de maní` parsed perfectly and then matched
 * nothing at all — the two halves of the feature were built to different
 * assumptions, and a Spanish or Portuguese speaker got a blank row for every
 * food they named in their own language (issue #106).
 *
 * ## Why a router rather than a translated index
 *
 * Translating the 13,272 descriptions is the correct fix and the expensive one:
 * the index is already **+2.0 MB / +18%** of the Android bundle, and a second
 * and third language of descriptions would be paid by every user on every OTA
 * download and every cold start.
 *
 * This is the same shape `restaurant-chains.data.ts` uses for ADR-0027 — ship
 * the *names* as a router (~6 KB) and leave the corpus where it is. It is a
 * deliberately BOUNDED list of staples, not a dictionary: it covers what people
 * actually log, and anything it misses behaves exactly as it does today.
 *
 * ## Rules for editing
 *
 * - Keys are lowercase and **accent-free**. {@link translateFoodTerm} strips
 *   diacritics before lookup, so `maní` and `mani` both hit `mani`.
 *   Adding an accented key is harmless but will never be reached.
 * - Longest phrase wins, so `mantequilla de mani` must beat `mantequilla`.
 *   {@link translateFoodTerm} sorts by length; do not rely on insertion order.
 * - Values are English SEARCH TERMS, not translations. Pick what the USDA
 *   index actually calls the thing — "peanut butter", not "peanut paste".
 * - One concept per line, es and pt together, because the two languages share
 *   many words and splitting them would duplicate half the table.
 */

/** Non-English food phrase → the English term to search for. */
const ALIASES: Record<string, string> = {
  // ── proteins ──
  pollo: 'chicken', frango: 'chicken',
  'pechuga de pollo': 'chicken breast', 'peito de frango': 'chicken breast',
  carne: 'beef', 'carne de res': 'beef', 'carne moida': 'ground beef',
  'carne molida': 'ground beef', 'carne de vaca': 'beef',
  bistec: 'steak', bife: 'steak',
  cerdo: 'pork', porco: 'pork', puerco: 'pork',
  tocino: 'bacon', bacon: 'bacon',
  jamon: 'ham', presunto: 'ham',
  pavo: 'turkey', peru: 'turkey',
  pescado: 'fish', peixe: 'fish',
  atun: 'tuna', atum: 'tuna',
  salmon: 'salmon', salmao: 'salmon',
  camaron: 'shrimp', camarones: 'shrimp', camarao: 'shrimp',
  bacalao: 'cod', bacalhau: 'cod',
  huevo: 'egg', huevos: 'egg', ovo: 'egg', ovos: 'egg',
  'clara de huevo': 'egg white', 'clara de ovo': 'egg white',
  salchicha: 'sausage', chorizo: 'sausage', linguica: 'sausage',
  // ── dairy ──
  leche: 'milk', leite: 'milk',
  queso: 'cheese', queijo: 'cheese',
  yogur: 'yogurt', yogurt: 'yogurt', iogurte: 'yogurt',
  mantequilla: 'butter', manteiga: 'butter',
  crema: 'cream', creme: 'cream', nata: 'cream',
  requeson: 'cottage cheese', 'queso fresco': 'cheese',
  // ── grains and starches ──
  arroz: 'rice', 'arroz blanco': 'white rice', 'arroz branco': 'white rice',
  'arroz integral': 'brown rice',
  pan: 'bread', pao: 'bread',
  'pan integral': 'whole wheat bread', 'pao integral': 'whole wheat bread',
  tortilla: 'tortilla',
  pasta: 'pasta', fideos: 'pasta', macarrao: 'pasta', espagueti: 'spaghetti',
  avena: 'oats', aveia: 'oats',
  harina: 'flour', farinha: 'flour',
  papa: 'potato', papas: 'potato', patata: 'potato', batata: 'potato',
  'batata doce': 'sweet potato', 'papa dulce': 'sweet potato', boniato: 'sweet potato',
  yuca: 'cassava', mandioca: 'cassava',
  platano: 'plantain', platanos: 'plantain', banana: 'banana',
  quinua: 'quinoa', quinoa: 'quinoa',
  cereal: 'cereal',
  galleta: 'cracker', galletas: 'cracker', bolacha: 'cracker', biscoito: 'cookie',
  // ── legumes and nuts ──
  frijoles: 'beans', 'frijoles negros': 'black beans',
  feijao: 'beans', 'feijao preto': 'black beans',
  habichuelas: 'beans', 'habichuelas rosadas': 'pink beans',
  lentejas: 'lentils', lentilha: 'lentils', lentilhas: 'lentils',
  garbanzos: 'chickpeas', 'grao de bico': 'chickpeas',
  mani: 'peanuts', amendoim: 'peanuts', cacahuate: 'peanuts',
  'mantequilla de mani': 'peanut butter', 'pasta de amendoim': 'peanut butter',
  'manteiga de amendoim': 'peanut butter', 'crema de cacahuate': 'peanut butter',
  almendra: 'almonds', almendras: 'almonds', amendoa: 'almonds', amendoas: 'almonds',
  nuez: 'walnuts', nueces: 'walnuts', noz: 'walnuts', nozes: 'walnuts',
  // ── vegetables ──
  lechuga: 'lettuce', alface: 'lettuce',
  tomate: 'tomato', tomates: 'tomato',
  cebolla: 'onion', cebola: 'onion',
  ajo: 'garlic', alho: 'garlic',
  zanahoria: 'carrot', cenoura: 'carrot',
  brocoli: 'broccoli', brocolis: 'broccoli',
  espinaca: 'spinach', espinacas: 'spinach', espinafre: 'spinach',
  pimiento: 'pepper', pimenta: 'pepper', pimentao: 'pepper',
  pepino: 'cucumber',
  calabaza: 'squash', abobora: 'squash', calabacin: 'zucchini', abobrinha: 'zucchini',
  maiz: 'corn', milho: 'corn', elote: 'corn',
  aguacate: 'avocado', abacate: 'avocado',
  champinones: 'mushrooms', hongos: 'mushrooms', cogumelos: 'mushrooms',
  repollo: 'cabbage', col: 'cabbage', couve: 'cabbage',
  // ── fruit ──
  manzana: 'apple', maca: 'apple',
  naranja: 'orange', laranja: 'orange',
  fresa: 'strawberry', fresas: 'strawberry', morango: 'strawberry',
  uva: 'grapes', uvas: 'grapes',
  pina: 'pineapple', abacaxi: 'pineapple',
  mango: 'mango', manga: 'mango',
  sandia: 'watermelon', melancia: 'watermelon',
  melon: 'melon', melao: 'melon',
  pera: 'pear', durazno: 'peach', melocoton: 'peach', pessego: 'peach',
  limon: 'lemon', limao: 'lemon',
  papaya: 'papaya', lechosa: 'papaya', mamao: 'papaya',
  // ── fats, sweeteners, drinks ──
  aceite: 'oil', oleo: 'oil', 'aceite de oliva': 'olive oil',
  'azeite de oliva': 'olive oil', azeite: 'olive oil',
  azucar: 'sugar', acucar: 'sugar',
  miel: 'honey', mel: 'honey',
  sal: 'salt',
  agua: 'water',
  cafe: 'coffee',
  te: 'tea', cha: 'tea',
  jugo: 'juice', suco: 'juice', zumo: 'juice',
  'jugo de naranja': 'orange juice', 'suco de laranja': 'orange juice',
  refresco: 'soda', gaseosa: 'soda', refrigerante: 'soda',
  cerveza: 'beer', cerveja: 'beer',
  vino: 'wine', vinho: 'wine',
  chocolate: 'chocolate',
  helado: 'ice cream', sorvete: 'ice cream',
  // ── prepared ──
  sopa: 'soup', caldo: 'broth',
  ensalada: 'salad', salada: 'salad',
  sandwich: 'sandwich', sanduiche: 'sandwich', emparedado: 'sandwich',
  pizza: 'pizza',
  hamburguesa: 'hamburger', hamburguer: 'hamburger',
};

/** Longest-first, so a multi-word alias wins over its own first word. */
const ORDERED = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

/**
 * Strip diacritics so `maní`, `mani`, `pão` and `pao` all reach one key.
 *
 * `normalize('NFD')` splits a letter from its accent and the range below drops
 * the accents. It is the whole reason the table can hold one spelling per food
 * instead of the two or four people actually type.
 */
export function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Rewrite a Spanish or Portuguese food term into the English one the database
 * indexes, or return it unchanged.
 *
 * Whole-phrase first, then phrase-wise inside the term, so both
 * `mantequilla de maní` and `2 de mantequilla de maní tostada` reach
 * `peanut butter`. Returns the input untouched when nothing matches, which is
 * what keeps every English query — and the golden fixture — unaffected.
 */
export function translateFoodTerm(term: string): string {
  const folded = foldDiacritics(term.toLowerCase().trim()).replace(/\s+/g, ' ');
  if (!folded) return term;
  const whole = ALIASES[folded];
  if (whole) return whole;

  let out = folded;
  let hit = false;
  for (const key of ORDERED) {
    // Word-bounded so "col" cannot rewrite the middle of "coliflor".
    const re = new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`);
    if (re.test(out)) {
      out = out.replace(re, `$1${ALIASES[key]}$2`);
      hit = true;
    }
  }
  return hit ? out.trim() : term;
}

/** Exposed for the parity test; not part of the resolution path. */
export const FOOD_ALIAS_COUNT = ORDERED.length;
