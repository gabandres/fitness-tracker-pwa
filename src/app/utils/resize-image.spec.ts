import { scaledDimensions } from './resize-image';

describe('scaledDimensions', () => {
  it('leaves an already-small image unchanged', () => {
    expect(scaledDimensions(800, 600, 1080)).toEqual({ width: 800, height: 600 });
    expect(scaledDimensions(1080, 1080, 1080)).toEqual({ width: 1080, height: 1080 });
  });

  it('never upscales', () => {
    expect(scaledDimensions(400, 300, 1080)).toEqual({ width: 400, height: 300 });
  });

  it('scales a landscape image to the long edge, preserving ratio', () => {
    // 4000×3000 → long edge 1080 → 1080×810.
    expect(scaledDimensions(4000, 3000, 1080)).toEqual({ width: 1080, height: 810 });
  });

  it('scales a portrait image to the long edge', () => {
    // 3000×4000 → 810×1080.
    expect(scaledDimensions(3000, 4000, 1080)).toEqual({ width: 810, height: 1080 });
  });

  it('rounds to whole pixels', () => {
    const r = scaledDimensions(1999, 1000, 1080);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
    expect(r.width).toBe(1080);
    expect(r.height).toBe(540); // 1000 * (1080/1999) = 540.27 → 540
  });
});
