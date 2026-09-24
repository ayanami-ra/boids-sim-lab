import { describe, expect, it } from 'vitest';
import {
  G,
  acceleration,
  angleGap,
  energy,
  flipped,
  positions,
  rk4,
  solve3,
  type State,
} from '../src/sims/pendulum/physics';

function run(s: State, seconds: number, dt = 0.001, each?: (s: State, t: number) => void): State {
  let state = s;
  const steps = Math.round(seconds / dt);
  for (let k = 1; k <= steps; k++) {
    state = rk4(state, dt);
    each?.(state, k * dt);
  }
  return state;
}

describe('三重振り子の運動方程式', () => {
  it('連立一次方程式を正しく解く', () => {
    const m = [
      [3, 2, 1],
      [2, 2, 1],
      [1, 1, 1],
    ];
    const [x, y, z] = solve3(m, [10, 7, 4]);
    expect(3 * x + 2 * y + z).toBeCloseTo(10);
    expect(2 * x + 2 * y + z).toBeCloseTo(7);
    expect(x + y + z).toBeCloseTo(4);
  });

  it('真下にぶら下がって静止していれば、動かない', () => {
    expect(acceleration([0, 0, 0, 0, 0, 0])).toEqual([0, 0, 0].map(() => expect.closeTo(0)));
  });

  it('棒の長さは常に保たれる（おもりどうしの距離が 1）', () => {
    run([2, 2.3, 2.6, 0, 0, 0], 3, 0.002, (s) => {
      const p = [[0, 0] as [number, number], ...positions(s)];
      for (let i = 0; i < 3; i++) {
        expect(Math.hypot(p[i + 1]![0] - p[i]![0], p[i + 1]![1] - p[i]![1])).toBeCloseTo(1, 9);
      }
    });
  });

  it('カオス的に動いても 20 秒間エネルギーが保たれる（誤差 0.01% 未満）', () => {
    const s0: State = [2, 2.3, 2.6, 0, 0, 0];
    const e0 = energy(s0);
    let worst = 0;
    run(s0, 20, 0.001, (s) => {
      worst = Math.max(worst, Math.abs((energy(s) - e0) / e0));
    });
    expect(worst).toBeLessThan(1e-4);
  });

  it('小さな振れ幅では、最も遅い固有振動の周期が理論値 2π/√(0.41577 g/l) に一致する', () => {
    // 固有ベクトル (1, 1.2921, 1.6312) の形に小さく傾けて放す
    const a = 0.01;
    const s0: State = [a, a * 1.2921127, a * 1.6312233, 0, 0, 0];
    const crossings: number[] = [];
    let prev = s0[0];
    run(s0, 12, 0.0005, (s, t) => {
      if (prev > 0 && s[0] <= 0) crossings.push(t);
      prev = s[0];
    });
    const period = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    const theory = (2 * Math.PI) / Math.sqrt(0.4157745568 * G);
    expect(period).toBeCloseTo(theory, 2);
    // 固有振動なので、形を保ったまま揺れ続ける（他のモードが混ざらない）
    const end = run(s0, 12 + theory / 4, 0.0005);
    expect(Math.abs(end[1] / end[0] - 1.2921127)).toBeLessThan(0.05);
  });
});

describe('初期値への鋭敏な依存（カオス）', () => {
  it('大きく振ると、10⁻⁹ rad の違いが数秒で目に見える差に広がる', () => {
    const a: State = [2, 2.3, 2.6, 0, 0, 0];
    const b: State = [2 + 1e-9, 2.3, 2.6, 0, 0, 0];
    let sa = a;
    let sb = b;
    let divergedAt = Infinity;
    for (let k = 1; k <= 20000 && divergedAt === Infinity; k++) {
      sa = rk4(sa, 0.001);
      sb = rk4(sb, 0.001);
      if (angleGap(sa, sb) > 0.1) divergedAt = k * 0.001;
    }
    expect(divergedAt).toBeLessThan(20);
  });

  it('小さく振っただけなら、同じ違いはいつまでも小さいまま（カオスではない）', () => {
    const a = run([0.1, 0.1, 0.1, 0, 0, 0], 20);
    const b = run([0.1 + 1e-9, 0.1, 0.1, 0, 0, 0], 20);
    expect(angleGap(a, b)).toBeLessThan(1e-6);
  });

  it('一回転の判定: 棒が真上を越えたら flipped', () => {
    expect(flipped([0, 0, 3.2, 0, 0, 0])).toBe(true);
    expect(flipped([3, -3, 0.5, 0, 0, 0])).toBe(false);
  });

  it('静止から放すとき、エネルギーが足りなければ決して一回転しない', () => {
    // 一番下のおもりが真上に来るのに必要なエネルギーより低い初期状態
    const s0: State = [0.8, 0.8, 0.8, 0, 0, 0];
    let ever = false;
    run(s0, 10, 0.002, (s) => {
      if (flipped(s)) ever = true;
    });
    expect(ever).toBe(false);
  });
});
