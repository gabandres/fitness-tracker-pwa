import { describe, expect, it } from 'vitest';
import { extractJsonLdBlocks, parseRecipeFromHtml } from './recipe-import';

function page(jsonLd: string): string {
  return `<!doctype html><html><head><title>x</title>
    <script type="application/ld+json">${jsonLd}</script>
    </head><body>...</body></html>`;
}

const FULL_RECIPE = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Protein Pancakes',
  recipeYield: '4 servings',
  recipeIngredient: ['2 cups oats', '4 eggs', '1 scoop whey'],
  nutrition: {
    '@type': 'NutritionInformation',
    calories: '312 kcal',
    proteinContent: '24 g',
    carbohydrateContent: '30 g',
    fatContent: '9 g',
  },
  url: 'https://example.com/protein-pancakes',
});

describe('extractJsonLdBlocks', () => {
  it('pulls and parses every ld+json script block', () => {
    const html = page('{"@type":"WebSite"}').replace(
      '</head>',
      '<script type="application/ld+json">{"@type":"Recipe","name":"X"}</script></head>',
    );
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(2);
  });

  it('skips malformed blocks without throwing', () => {
    const html = page('{ this is not json ]');
    expect(extractJsonLdBlocks(html)).toEqual([]);
  });

  it('unwraps CDATA-wrapped JSON', () => {
    const html = page('<![CDATA[{"@type":"Recipe","name":"Y"}]]>');
    expect(extractJsonLdBlocks(html)).toHaveLength(1);
  });
});

describe('parseRecipeFromHtml', () => {
  it('parses a complete Recipe node', () => {
    const r = parseRecipeFromHtml(page(FULL_RECIPE));
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Protein Pancakes');
    expect(r!.servings).toBe(4);
    expect(r!.ingredients).toEqual(['2 cups oats', '4 eggs', '1 scoop whey']);
    expect(r!.perServing).toEqual({ calories: 312, protein: 24, carbs: 30, fat: 9 });
    expect(r!.sourceUrl).toBe('https://example.com/protein-pancakes');
  });

  it('finds the Recipe inside an @graph container', () => {
    const graph = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Blog' },
        { '@type': ['Recipe', 'Thing'], name: 'Graph Stew', recipeYield: 6 },
      ],
    });
    const r = parseRecipeFromHtml(page(graph));
    expect(r!.name).toBe('Graph Stew');
    expect(r!.servings).toBe(6);
  });

  it('finds the Recipe inside a top-level array', () => {
    const arr = JSON.stringify([
      { '@type': 'Organization', name: 'Org' },
      { '@type': 'Recipe', name: 'Array Soup' },
    ]);
    const r = parseRecipeFromHtml(page(arr));
    expect(r!.name).toBe('Array Soup');
  });

  it('handles a numeric recipeYield and array yield', () => {
    expect(parseRecipeFromHtml(page(JSON.stringify({ '@type': 'Recipe', recipeYield: 8 })))!.servings).toBe(8);
    expect(
      parseRecipeFromHtml(page(JSON.stringify({ '@type': 'Recipe', recipeYield: ['12 cookies', '12'] })))!.servings,
    ).toBe(12);
  });

  it('returns perServing null when there is no nutrition block', () => {
    const r = parseRecipeFromHtml(page(JSON.stringify({ '@type': 'Recipe', name: 'Bare' })));
    expect(r!.perServing).toBeNull();
    expect(r!.servings).toBeNull();
    expect(r!.ingredients).toEqual([]);
  });

  it('keeps partial nutrition (calories only, protein missing)', () => {
    const r = parseRecipeFromHtml(page(JSON.stringify({
      '@type': 'Recipe', name: 'Cals only', nutrition: { calories: '150 calories' },
    })));
    expect(r!.perServing).toEqual({ calories: 150, protein: null, carbs: null, fat: null });
  });

  it('parses a decimal protein value with a comma decimal separator', () => {
    const r = parseRecipeFromHtml(page(JSON.stringify({
      '@type': 'Recipe', name: 'Comma', nutrition: { proteinContent: '12,5 g' },
    })));
    expect(r!.perServing!.protein).toBe(13); // 12.5 → rounded
  });

  it('returns null when the page has no Recipe JSON-LD', () => {
    expect(parseRecipeFromHtml(page(JSON.stringify({ '@type': 'Article', name: 'Not a recipe' })))).toBeNull();
    expect(parseRecipeFromHtml('<html><body>no ld+json here</body></html>')).toBeNull();
  });

  it('takes the first Recipe when several are present', () => {
    const html =
      page(JSON.stringify({ '@type': 'Recipe', name: 'First' })).replace(
        '</head>',
        `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Second' })}</script></head>`,
      );
    expect(parseRecipeFromHtml(html)!.name).toBe('First');
  });
});
