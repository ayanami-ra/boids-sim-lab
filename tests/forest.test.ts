import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  SPECIES,
  Stand,
  crownRadius,
  diameterGrowth,
  height,
  type SpeciesId,
} from '../src/sims/forest/stand';

const index = (id: SpeciesId) => SPECIES.findIndex((s) => s.id === id);
const sp = (id: SpeciesId) => SPECIES[index(id)]!;

/** 胸高断面積の、先駆種（シラカバ・アカマツ）と後期種（ミズナラ・ブナ）の割合 */
function shares(stand: Stand) {
  const ba = stand.basalAreaBySpecies();
  const total = ba.reduce((a, b) => a + b, 0) || 1;
  return {
    pioneer: (ba[index('birch')]! + ba[index('pine')]!) / total,
    late: (ba[index('oak')]! + ba[index('beech')]!) / total,
    total,
  };
}

describe('樹木の形', () => {
  it('樹高と樹冠は太さとともに大きくなり、樹高は最大樹高を超えない', () => {
    for (const s of SPECIES) {
      let h = 0;
      let r = 0;
      for (let d = 0.5; d <= s.dMax; d += 0.5) {
        expect(height(s, d)).toBeGreaterThan(h);
        expect(crownRadius(s, d)).toBeGreaterThanOrEqual(r);
        h = height(s, d);
        r = crownRadius(s, d);
      }
      expect(h).toBeLessThanOrEqual(s.hMax);
      expect(h).toBeGreaterThan(s.hMax * 0.85);
    }
  });
});

describe('成長の光への反応（耐陰性のトレードオフ）', () => {
  it('明るい所ではシラカバがブナより速く、暗い所ではブナがシラカバより速く育つ', () => {
    expect(diameterGrowth(sp('birch'), 5, 1)).toBeGreaterThan(diameterGrowth(sp('beech'), 5, 1));
    expect(diameterGrowth(sp('beech'), 5, 0.05)).toBeGreaterThan(
      diameterGrowth(sp('birch'), 5, 0.05),
    );
  });

  it('どの種も光が多いほど速く育つ', () => {
    for (const s of SPECIES) {
      expect(diameterGrowth(s, 10, 0.8)).toBeGreaterThan(diameterGrowth(s, 10, 0.3));
    }
  });
});

describe('光の計算', () => {
  it('樹冠の真下は葉の量に応じて暗くなり、樹冠の外は明るいまま', () => {
    const stand = new Stand(createRng('light'));
    stand.addTree(index('beech'), 50, 15, 60);
    stand.computeLight();
    expect(stand.lightAt(50, 15)).toBeCloseTo(Math.exp(-0.5 * sp('beech').lai), 3);
    expect(stand.lightAt(5, 5)).toBe(1);
  });

  it('背の低い木は、上に高い木があると暗い。高い木は全天の光を受ける', () => {
    const stand = new Stand(createRng('layers'));
    const tall = stand.addTree(index('oak'), 50, 15, 70);
    const small = stand.addTree(index('beech'), 51, 15, 5);
    stand.computeLight();
    expect(tall.light).toBe(1);
    expect(small.light).toBeLessThan(0.2);
  });

  it('葉の量が少ないシラカバの下は、ブナの下より明るい', () => {
    const stand = new Stand(createRng('lai'));
    stand.addTree(index('birch'), 20, 15, 30);
    stand.addTree(index('beech'), 80, 15, 30);
    stand.computeLight();
    expect(stand.lightAt(20, 15)).toBeGreaterThan(stand.lightAt(80, 15) * 3);
  });
});

describe('遷移（裸地から森へ）', () => {
  for (const seed of ['s1', 's2', 's3']) {
    it(`[${seed}] 初めは先駆種が、数百年後は耐陰性の強い種が森の大部分を占める`, () => {
      const stand = new Stand(createRng(seed));
      for (let y = 0; y < 50; y++) stand.step();
      expect(shares(stand).pioneer).toBeGreaterThan(0.6);
      for (let y = 50; y < 350; y++) stand.step();
      const late = shares(stand);
      expect(late.late).toBeGreaterThan(0.75);
      // 成熟した温帯林らしい量（胸高断面積 20〜60 m²/ha）
      expect(late.total).toBeGreaterThan(20);
      expect(late.total).toBeLessThan(60);
      // 閉じた森の林床は暗い
      const floor = stand.floorLight.reduce((a, b) => a + b, 0) / stand.floorLight.length;
      expect(floor).toBeLessThan(0.2);
    }, 30000);
  }

  it('寿命を大きく超えて生きる木はいない', () => {
    const stand = new Stand(createRng('age'));
    for (let y = 0; y < 300; y++) stand.step();
    for (const t of stand.trees) expect(t.age).toBeLessThan(SPECIES[t.species]!.maxAge * 1.5);
  }, 30000);
});

describe('攪乱', () => {
  function matureStand(seed: string) {
    const stand = new Stand(createRng(seed));
    for (let y = 0; y < 150; y++) stand.step();
    return stand;
  }

  it('台風では背の高い木ほど倒れ、倒れたところの林床が明るくなる', () => {
    const stand = matureStand('wind');
    const before = stand.floorLight.reduce((a, b) => a + b, 0);
    const tallBefore = stand.trees.filter((t) => height(SPECIES[t.species]!, t.d) > 20).length;
    const smallBefore = stand.trees.filter((t) => height(SPECIES[t.species]!, t.d) < 8).length;
    stand.typhoon();
    const tallAfter = stand.trees.filter((t) => height(SPECIES[t.species]!, t.d) > 20).length;
    const smallAfter = stand.trees.filter((t) => height(SPECIES[t.species]!, t.d) < 8).length;
    expect(tallAfter).toBeLessThan(tallBefore);
    expect(smallAfter).toBe(smallBefore);
    expect(stand.floorLight.reduce((a, b) => a + b, 0)).toBeGreaterThan(before);
    expect(stand.snags.some((s) => s.fallen)).toBe(true);
  });

  it('山火事のあと、生き残る大径木はアカマツが多い', () => {
    const survived: Record<string, [number, number]> = {};
    for (const seed of ['f1', 'f2', 'f3', 'f4']) {
      const stand = matureStand(seed);
      const big = stand.trees.filter((t) => t.d > 20);
      stand.fire();
      for (const s of SPECIES) {
        const b = big.filter((t) => t.species === index(s.id)).length;
        const a = stand.trees.filter((t) => t.d > 20 && t.species === index(s.id)).length;
        const prev = survived[s.id] ?? [0, 0];
        survived[s.id] = [prev[0] + a, prev[1] + b];
      }
    }
    const rate = (id: SpeciesId) => survived[id]![0] / Math.max(1, survived[id]![1]);
    expect(rate('pine')).toBeGreaterThan(rate('beech'));
    expect(rate('pine')).toBeGreaterThan(0.5);
  }, 30000);

  it('山火事で若い木はすべて焼ける', () => {
    const stand = matureStand('young');
    stand.fire();
    expect(stand.trees.every((t) => t.d > 8)).toBe(true);
  });

  it('同じシードなら同じ森になる', () => {
    const a = new Stand(createRng('same'));
    const b = new Stand(createRng('same'));
    for (let y = 0; y < 60; y++) {
      a.step();
      b.step();
    }
    expect(a.trees.map((t) => t.d)).toEqual(b.trees.map((t) => t.d));
  });
});
