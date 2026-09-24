import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  MILKY_WAY_LIKE,
  SCENARIOS,
  buildScenario,
  circularVelocity2,
  parabolicOrbit,
  sampleDiskRadius,
  sampleGalaxy,
  sampleHernquistRadius,
  totalMass,
  type Particles,
} from '../src/sims/galaxy/model';
import { computeForces, energyFromStep, leapfrogStep } from '../src/sims/galaxy/nbody-cpu';

const masses = (p: Particles) => p.pos.filter((_, i) => i % 4 === 3);

describe('質量分布のサンプリング', () => {
  it('ヘルンキスト球の半質量半径は a(1+√2)', () => {
    // 打ち切りなし（cutoff 無限大）なら u = 0.5 が半質量半径
    expect(sampleHernquistRadius(0.5, 2, 1e12)).toBeCloseTo(2 * (1 + Math.SQRT2), 3);
  });

  it('指数円盤の半質量半径はおよそ 1.678 Rd', () => {
    // 打ち切り（8Rd）の影響はごくわずか
    expect(sampleDiskRadius(0.5, 1)).toBeCloseTo(1.678, 2);
  });

  it('回転曲線は中心から立ち上がり、円盤の外側でほぼ平坦になる', () => {
    const v = (r: number) => Math.sqrt(circularVelocity2(MILKY_WAY_LIKE, r, 0.2));
    expect(v(0.01)).toBeLessThan(v(2));
    expect(Math.abs(v(15) - v(8)) / v(8)).toBeLessThan(0.15);
    // 天の川程度: 200 km/s 前後（速度 1 ≈ 207 km/s）
    expect(v(8) * 207).toBeGreaterThan(150);
    expect(v(8) * 207).toBeLessThan(300);
  });
});

describe('放物線軌道', () => {
  it('重心は原点に静止し、相対運動のエネルギーは 0', () => {
    const o = parabolicOrbit(3, 1, 5, 40);
    for (let d = 0; d < 3; d++) {
      expect(3 * o.pos1[d]! + 1 * o.pos2[d]!).toBeCloseTo(0);
      expect(3 * o.vel1[d]! + 1 * o.vel2[d]!).toBeCloseTo(0);
    }
    const r = Math.hypot(...o.pos2.map((v, d) => v - o.pos1[d]!));
    const v = Math.hypot(...o.vel2.map((u, d) => u - o.vel1[d]!));
    expect(r).toBeCloseTo(40);
    expect(0.5 * v * v - 4 / r).toBeCloseTo(0, 6);
  });

  it('近点距離 0 なら x 軸上の正面衝突になる', () => {
    const o = parabolicOrbit(3, 1, 0, 40);
    expect(o.pos2[1]).toBe(0);
    expect(o.vel2[1]).toBe(0);
    expect(o.pos2[0]).toBeLessThan(0);
    expect(o.vel2[0]).toBeGreaterThan(0);
    const r = o.pos1[0]! - o.pos2[0]!;
    const v = o.vel2[0]! - o.vel1[0]!;
    expect(0.5 * v * v - 4 / r).toBeCloseTo(0, 6);
  });

  it('2 点を積分すると指定した近点距離まで近づく', () => {
    const o = parabolicOrbit(3, 1, 5, 40);
    const p: Particles = {
      pos: new Float32Array([...o.pos1, 3, ...o.pos2, 1]),
      vel: new Float32Array([...o.vel1, 0, ...o.vel2, 0]),
      count: 2,
    };
    const acc = new Float32Array(8);
    const dt = 0.002;
    leapfrogStep(p, 1e-6, dt, acc, 0.5, 0);
    let minR = Infinity;
    for (let i = 0; i < 40000; i++) {
      leapfrogStep(p, 1e-6, dt, acc);
      minR = Math.min(minR, Math.hypot(p.pos[4]! - p.pos[0]!, p.pos[5]! - p.pos[1]!));
    }
    expect(minR).toBeGreaterThan(4.9);
    expect(minR).toBeLessThan(5.1);
  });
});

describe('リープフロッグ積分', () => {
  it('ケプラー運動を 20 周してもエネルギー誤差は 0.1% 未満', () => {
    // 円軌道の少しずれた楕円軌道
    const p: Particles = {
      pos: new Float32Array([0, 0, 0, 1, 1, 0, 0, 1e-6]),
      vel: new Float32Array([0, 0, 0, 0, 0, 0.8, 0, 0]),
      count: 2,
    };
    const acc = new Float32Array(8);
    const dt = 0.005;
    const m = masses(p);
    leapfrogStep(p, 1e-4, dt, acc, 0.5, 0);
    leapfrogStep(p, 1e-4, dt, acc);
    const e0 = energyFromStep(p.vel, acc, m, dt).total;
    for (let i = 0; i < 20 * Math.round((2 * Math.PI) / dt); i++) leapfrogStep(p, 1e-4, dt, acc);
    const e1 = energyFromStep(p.vel, acc, m, dt).total;
    expect(Math.abs((e1 - e0) / e0)).toBeLessThan(1e-3);
  });

  it('computeForces は自己相互作用を含まない', () => {
    const p: Particles = {
      pos: new Float32Array([0, 0, 0, 2]),
      vel: new Float32Array(4),
      count: 1,
    };
    const acc = new Float32Array(4);
    computeForces(p, 0.1, acc);
    expect([...acc]).toEqual([0, 0, 0, 0]);
  });
});

describe('銀河モデル', () => {
  it('孤立した銀河はほぼビリアル平衡（2K/|W| ≈ 1）', () => {
    const n = 1500;
    const p: Particles = { pos: new Float32Array(n * 4), vel: new Float32Array(n * 4), count: n };
    sampleGalaxy(
      MILKY_WAY_LIKE,
      { disk: 600, bulge: 150, halo: 750 },
      0,
      0.2,
      createRng('virial'),
      p,
      0,
    );
    const acc = new Float32Array(n * 4);
    computeForces(p, 0.2, acc);
    // dt = 0 なら速度はそのまま
    const e = energyFromStep(p.vel, acc, masses(p), 0);
    const ratio = (2 * e.kinetic) / Math.abs(e.potential);
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  it.each(SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: 粒子数がちょうど n、総質量が保存、重心は静止',
    (_, scenario) => {
      const n = 3000;
      const p = buildScenario(scenario, n, 0.2, createRng(scenario.id));
      const m = masses(p);
      expect(m.length).toBe(n);
      expect(m.every((x) => x > 0)).toBe(true);
      const total = m.reduce((a, b) => a + b, 0);
      const expected = totalMass(scenario.galaxies[0].spec) + totalMass(scenario.galaxies[1].spec);
      expect(total / expected).toBeCloseTo(1, 4);

      const momentum = [0, 0, 0];
      for (let i = 0; i < n; i++)
        for (let d = 0; d < 3; d++) momentum[d]! += m[i]! * p.vel[i * 4 + d]!;
      for (const v of momentum) expect(Math.abs(v) / total).toBeLessThan(1e-4);

      expect(p.pos.every(Number.isFinite) && p.vel.every(Number.isFinite)).toBe(true);
    },
  );
});
