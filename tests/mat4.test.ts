import { describe, expect, it } from 'vitest';
import { lookAt, mat4, multiply, perspective, transformPoint } from '../src/core/mat4';

describe('mat4', () => {
  it('カメラの注視点は画面中央、near/far は深度 0/1 に写る', () => {
    const proj = perspective(mat4(), Math.PI / 3, 1.5, 1, 100);
    const view = lookAt(mat4(), [0, 0, 10], [0, 0, 0], [0, 1, 0]);
    const vp = multiply(mat4(), proj, view);

    const [x, y, , w] = transformPoint(vp, 0, 0, 0);
    expect(x / w).toBeCloseTo(0);
    expect(y / w).toBeCloseTo(0);

    const near = transformPoint(vp, 0, 0, 9);
    expect(near[2] / near[3]).toBeCloseTo(0);
    const far = transformPoint(vp, 0, 0, -90);
    expect(far[2] / far[3]).toBeCloseTo(1);
  });

  it('右にある点は画面の右、上にある点は画面の上に写る', () => {
    const proj = perspective(mat4(), Math.PI / 2, 1, 0.1, 100);
    const view = lookAt(mat4(), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const vp = multiply(mat4(), proj, view);
    const [x, y, , w] = transformPoint(vp, 1, 2, 0);
    expect(x / w).toBeCloseTo(0.2);
    expect(y / w).toBeCloseTo(0.4);
  });
});
