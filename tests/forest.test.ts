import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { DEFAULT_PARAMS, Forest } from '../src/sims/forest/colonization';

function grownForest(seed: string, trees: number[], iterations = 200) {
  const rng = createRng(seed);
  const f = new Forest(800, 600, 560);
  f.addAttractors(1200, rng);
  trees.forEach((x, i) => f.plant(x, i * 40));
  for (let i = 0; i < iterations; i++) f.grow();
  return f;
}

describe('空間コロニー化による成長', () => {
  it('幹が伸びて樹冠に届き、枝分かれして光の粒を使い切っていく', () => {
    const f = grownForest('one', [400]);
    expect(f.n).toBeGreaterThan(200);
    expect(f.attractors).toBeLessThan(1200 * 0.5);
    // 枝分かれしている（子が 2 本以上の節がある）
    expect(f.children.subarray(0, f.n).some((c) => c >= 2)).toBe(true);
    // 幹の先端は地面より上
    expect(f.y[f.trees[0]!.tip]).toBeLessThan(560 - 100);
  });

  it('すべての節は親から一定の長さで伸び、地面より下には行かない', () => {
    const f = grownForest('shape', [300, 500]);
    for (let i = 0; i < f.n; i++) {
      expect(f.y[i]).toBeLessThanOrEqual(560);
      const p = f.parent[i]!;
      if (p < 0) continue;
      expect(p).toBeLessThan(i);
      expect(Math.hypot(f.x[i]! - f.x[p]!, f.y[i]! - f.y[p]!)).toBeCloseTo(
        DEFAULT_PARAMS.segment,
        0,
      );
    }
  });

  it('パイプモデル: 親は子より太く、太さ^p は子の和に等しい', () => {
    const f = grownForest('pipe', [400]);
    const p = DEFAULT_PARAMS.pipeExponent;
    const sum = new Float64Array(f.n);
    for (let i = 1; i < f.n; i++) {
      const parent = f.parent[i]!;
      expect(f.radius[parent]!).toBeGreaterThanOrEqual(f.radius[i]! - 1e-6);
      sum[parent]! += Math.pow(f.radius[i]!, p);
    }
    for (let i = 0; i < f.n; i++) {
      if (f.children[i]! > 0) expect(Math.pow(f.radius[i]!, p)).toBeCloseTo(sum[i]!, 3);
    }
  });

  it('枝は自分の木の節からしか伸びない（木どうしは混ざらない）', () => {
    const f = grownForest('trees', [200, 400, 600]);
    for (let i = 0; i < f.n; i++) {
      const p = f.parent[i]!;
      if (p >= 0) expect(f.tree[i]).toBe(f.tree[p]);
    }
    const perTree = [0, 0, 0];
    for (let i = 0; i < f.n; i++) perTree[f.tree[i]!]!++;
    for (const c of perTree) expect(c).toBeGreaterThan(30);
  });

  it('隣に木があると光を奪い合い、1 本だけのときより枝が少ない', () => {
    const alone = grownForest('compete', [400]);
    const crowded = grownForest('compete', [400, 330, 470]);
    const branchesOf = (f: Forest, t: number) => {
      let c = 0;
      for (let i = 0; i < f.n; i++) if (f.tree[i] === t) c++;
      return c;
    };
    expect(branchesOf(crowded, 0)).toBeLessThan(branchesOf(alone, 0) * 0.8);
  });

  it('同じ場所に節が重なって生えない（光の粒の引っ張り合いで同じ枝を生やし続けない）', () => {
    const f = grownForest('dup', [250, 400, 550], 400);
    const min = DEFAULT_PARAMS.segment * 0.3;
    let duplicates = 0;
    for (let i = 0; i < f.n; i++) {
      for (let j = i + 1; j < f.n; j++) {
        if (Math.abs(f.x[i]! - f.x[j]!) < min && Math.abs(f.y[i]! - f.y[j]!) < min) duplicates++;
      }
    }
    expect(duplicates).toBe(0);
    // 太さも暴走しない（根元でも幹として常識的な太さ）
    for (const tree of f.trees) expect(f.radius[tree.root]).toBeLessThan(12);
  });

  it('同じシードなら同じ森になる', () => {
    const a = grownForest('same', [300, 500], 80);
    const b = grownForest('same', [300, 500], 80);
    expect(a.n).toBe(b.n);
    expect([...a.x.subarray(0, a.n)]).toEqual([...b.x.subarray(0, b.n)]);
  });
});
