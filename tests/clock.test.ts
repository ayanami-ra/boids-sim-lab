import { describe, expect, it } from 'vitest';
import { advanceClock } from '../src/core/clock';

const opts = { dt: 0.01, maxSteps: 5 };

describe('advanceClock', () => {
  it('経過時間を dt 単位のステップに分け、端数を持ち越す', () => {
    const s = { accumulator: 0 };
    expect(advanceClock(s, 0.025, opts).steps).toBe(2);
    expect(s.accumulator).toBeCloseTo(0.005);
    expect(advanceClock(s, 0.006, opts).steps).toBe(1);
  });

  it('maxSteps を超えたら打ち切って積算をリセットする', () => {
    const s = { accumulator: 0 };
    expect(advanceClock(s, 1, opts).steps).toBe(5);
    expect(s.accumulator).toBe(0);
  });
});
