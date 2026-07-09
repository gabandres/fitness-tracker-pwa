import { describe, expect, it } from 'vitest';
import {
  makeFoodSearch,
  normalizeHit,
  normalizeDetail,
  sortServings,
  type FoodSearchTransport,
  type ServingOption,
} from './food-search';

/** In-memory transport adapter — the test-side twin of the prod callable seam
 *  (CallableGateway / httpsCallable). Records calls so we can assert the wire
 *  payload, and returns canned responses. */
function fakeTransport(responses: Record<string, unknown>) {
  const calls: { name: string; payload: Record<string, unknown> }[] = [];
  const call: FoodSearchTransport = async <Res>(name: string, payload: Record<string, unknown>) => {
    calls.push({ name, payload });
    return responses[name] as Res;
  };
  return { call, calls };
}

const per100: ServingOption = { label: '100 g', grams: 100, kcal: 52, protein: 0.3, kind: 'per100g' };
const cup: ServingOption = { label: '1 cup', grams: 125, kcal: 65, protein: 0.4, kind: 'portion' };

describe('normalizeHit', () => {
  it('passes through a new source/id hit unchanged', () => {
    const h = { source: 'off' as const, id: '737628064502', description: 'Ramen' };
    expect(normalizeHit(h)).toBe(h);
  });

  it('upgrades a legacy fdcId-only hit to source/id', () => {
    expect(normalizeHit({ fdcId: 1102653, description: 'Apple', dataType: 'Foundation' } as never)).toEqual({
      source: 'fdc',
      id: '1102653',
      description: 'Apple',
      brand: undefined,
      dataType: 'Foundation',
    });
  });
});

describe('normalizeDetail', () => {
  it('upgrades a legacy fdcId-only detail', () => {
    const d = normalizeDetail({ fdcId: 42, description: 'Rice', servings: [per100] } as never);
    expect(d).toEqual({ source: 'fdc', id: '42', description: 'Rice', brand: undefined, servings: [per100] });
  });
});

describe('sortServings', () => {
  it("'us' puts household measures first, per-100g last", () => {
    expect(sortServings([per100, cup], 'us').map((s) => s.kind)).toEqual(['portion', 'per100g']);
  });

  it("'metric' puts per-100g first", () => {
    expect(sortServings([cup, per100], 'metric').map((s) => s.kind)).toEqual(['per100g', 'portion']);
  });

  it('does not mutate the input', () => {
    const input = [per100, cup];
    sortServings(input, 'us');
    expect(input).toEqual([per100, cup]);
  });
});

describe('makeFoodSearch', () => {
  it('search: calls searchFoods with the query + normalizes hits', async () => {
    const { call, calls } = fakeTransport({
      searchFoods: { hits: [{ fdcId: 7, description: 'Oats' }], cached: false },
    });
    const client = makeFoodSearch(call);
    const hits = await client.search('oat', 5);

    expect(calls[0]).toEqual({ name: 'searchFoods', payload: { query: 'oat', pageSize: 5 } });
    expect(hits).toEqual([{ source: 'fdc', id: '7', description: 'Oats', brand: undefined, dataType: undefined }]);
  });

  it('search: tolerates a missing hits array', async () => {
    const { call } = fakeTransport({ searchFoods: { cached: true } });
    expect(await makeFoodSearch(call).search('x')).toEqual([]);
  });

  it('getDetail: sends fdcId alongside source/id for FDC items', async () => {
    const { call, calls } = fakeTransport({
      getFoodDetail: { detail: { source: 'fdc', id: '42', description: 'Rice', servings: [per100] }, cached: false },
    });
    await makeFoodSearch(call).getDetail('fdc', '42');
    expect(calls[0]).toEqual({ name: 'getFoodDetail', payload: { source: 'fdc', id: '42', fdcId: 42 } });
  });

  it('getDetail: omits fdcId for OFF (barcode) items', async () => {
    const { call, calls } = fakeTransport({
      getFoodDetail: { detail: { source: 'off', id: '737628064502', description: 'Ramen', servings: [] }, cached: false },
    });
    await makeFoodSearch(call).getDetail('off', '737628064502');
    expect(calls[0]).toEqual({ name: 'getFoodDetail', payload: { source: 'off', id: '737628064502' } });
  });
});
