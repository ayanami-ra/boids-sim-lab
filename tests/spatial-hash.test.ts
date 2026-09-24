import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { SpatialHash } from '../src/core/spatial-hash';

describe('SpatialHash', () => {
  it('総当たりと同じ近傍を見つける', () => {
    const rng = createRng('grid');
    const n = 500;
    const xs = Float32Array.from({ length: n }, () => rng.range(0, 400));
    const ys = Float32Array.from({ length: n }, () => rng.range(0, 300));
    const grid = new SpatialHash(20, 400, 300);
    grid.build(xs, ys, n);

    const r = 20;
    for (let i = 0; i < n; i += 37) {
      const found = new Set<number>();
      grid.query(xs[i]!, ys[i]!, r, (j) => {
        if (Math.hypot(xs[j]! - xs[i]!, ys[j]! - ys[i]!) <= r) found.add(j);
      });
      const brute = new Set<number>();
      for (let j = 0; j < n; j++) {
        if (Math.hypot(xs[j]! - xs[i]!, ys[j]! - ys[i]!) <= r) brute.add(j);
      }
      expect(found).toEqual(brute);
    }
  });
});
