import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { Cell, Discharge } from '../src/sims/lightning/dbm';

/** 放電路が起点までつながっているか（各セルの親が隣のセルで、放電路に含まれる） */
function isConnected(d: Discharge): boolean {
  for (let k = 1; k < d.length; k++) {
    const i = d.order[k]!;
    const p = d.parent[i]!;
    if (p < 0 || d.state[p] !== Cell.Channel) return false;
    const dx = Math.abs((i % d.w) - (p % d.w));
    const dy = Math.abs(Math.floor(i / d.w) - Math.floor(p / d.w));
    if (dx > 1 || dy > 1) return false;
  }
  return true;
}

function strikeUntilDone(d: Discharge, eta: number, seed: string) {
  const rng = createRng(seed);
  for (let i = 0; i < d.w * d.h && !d.grow(eta, rng); i++);
}

describe('電位の計算', () => {
  it('放電路がなければ、雲（φ=0）から地面（φ=1）へまっすぐに上がる', () => {
    const d = new Discharge(20, 30, 'lightning');
    // 初期値を崩してから解き直しても、線形の解に戻る
    d.phi.fill(0.5);
    for (let x = 0; x < 20; x++) d.phi[29 * 20 + x] = 1;
    d.relax(2000);
    for (let y = 0; y < 29; y++) {
      // 上端の外側（y = -1）が φ=0、下端（y = 29）が φ=1
      expect(d.phi[y * 20 + 7]).toBeCloseTo((y + 1) / 30, 3);
    }
  });

  it('尖った導体（避雷針）の先端では、平地より電場がずっと強い', () => {
    const w = 81;
    const d = new Discharge(w, 60, 'lightning');
    for (let y = 40; y < 59; y++) d.addGround(40, y);
    d.relax(4000);
    // 電場 ≈ 導体（φ=1）との電位差 / 距離
    const tipField = (1 - d.phi[37 * w + 40]!) / 3;
    const flatField = (1 - d.phi[56 * w + 5]!) / 3;
    expect(tipField).toBeGreaterThan(2 * flatField);
  });
});

describe('放電の成長', () => {
  it('放電路は起点から途切れずにつながり、やがて地面に届く', () => {
    const d = new Discharge(40, 50, 'lightning');
    d.relax(500);
    d.seed(20, 1);
    strikeUntilDone(d, 2, 'grow');
    expect(d.struck).toBeGreaterThanOrEqual(0);
    expect(isConnected(d)).toBe(true);

    const path = d.mainPath();
    expect(path[path.length - 1]).toBe(20 + 1 * 40);
    // 地面の 1 つ上の行まで届いている
    expect(Math.floor(path[0]! / 40)).toBe(48);
  });

  it('η が大きいほど枝分かれが少ない（地面に届くまでのセル数が少ない）', () => {
    const cells = (eta: number) => {
      let total = 0;
      for (const seed of ['a', 'b', 'c']) {
        const d = new Discharge(40, 50, 'lightning');
        d.relax(500);
        d.seed(20, 1);
        strikeUntilDone(d, eta, seed);
        total += d.length;
      }
      return total;
    };
    expect(cells(4)).toBeLessThan(cells(1));
  });

  it('背の高い避雷針には、遠くの平地より雷が落ちやすい', () => {
    let onRod = 0;
    const seeds = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
    for (const seed of seeds) {
      const d = new Discharge(60, 60, 'lightning');
      // 右寄りに避雷針。雷は左寄りの上空から始まる
      for (let y = 30; y < 59; y++) d.addGround(40, y);
      d.relax(1500);
      d.seed(20, 1);
      strikeUntilDone(d, 2, seed);
      const x = d.struck % 60;
      const y = Math.floor(d.struck / 60);
      if (Math.abs(x - 40) <= 1 && y < 58) onRod++;
    }
    expect(onRod).toBeGreaterThan(seeds.length / 2);
  });

  it('リヒテンベルク図形は中心から広がり、外周の電極に届いて止まる', () => {
    const d = new Discharge(41, 41, 'lichtenberg');
    d.relax(500);
    d.seed(20, 20);
    strikeUntilDone(d, 1, 'lich');
    expect(d.struck).toBeGreaterThanOrEqual(0);
    expect(isConnected(d)).toBe(true);
    const x = d.struck % 41;
    const y = Math.floor(d.struck / 41);
    expect(Math.hypot(x - 20, y - 20)).toBeGreaterThan(15);
  });

  it('枝の大きさ: 起点には全セルがぶら下がっている', () => {
    const d = new Discharge(30, 40, 'lightning');
    d.relax(300);
    d.seed(15, 1);
    strikeUntilDone(d, 2, 'size');
    const sizes = d.subtreeSizes();
    expect(sizes[15 + 40 * 0 + 30]).toBe(d.length);
  });
});

describe('複数の雷', () => {
  function field() {
    const d = new Discharge(60, 50, 'lightning');
    d.relax(800);
    return d;
  }

  it('2 本のリーダーを同時に伸ばすと、どちらも地面に届き、放電路は混ざらない', () => {
    const d = field();
    const a = d.seed(15, 1);
    const b = d.seed(45, 1);
    const rng = createRng('two');
    for (let k = 0; k < 6000 && (d.struckCell(a) < 0 || d.struckCell(b) < 0); k++) {
      d.grow(2, rng, a);
      d.grow(2, rng, b);
      d.relax(1);
    }
    expect(d.struckCell(a)).toBeGreaterThanOrEqual(0);
    expect(d.struckCell(b)).toBeGreaterThanOrEqual(0);
    for (let k = 0; k < d.length; k++) {
      const i = d.order[k]!;
      const p = d.parent[i]!;
      if (p >= 0) expect(d.owner[p]).toBe(d.owner[i]);
    }
    expect(d.mainPath(a).every((i) => d.owner[i] === a)).toBe(true);
    expect(d.mainPath(b).every((i) => d.owner[i] === b)).toBe(true);
  });

  it('光り終わった雷を片付けると、そのセルは空き、もう 1 本はそのまま残る', () => {
    const d = field();
    const base = d.phi.slice();
    const a = d.seed(15, 1);
    const b = d.seed(45, 1);
    const rng = createRng('remove');
    for (let k = 0; k < 40; k++) {
      d.grow(2, rng, a);
      d.grow(2, rng, b);
    }
    const bCells = [...d.order.subarray(0, d.length)].filter((i) => d.owner[i] === b);
    d.removeLeader(a, base);
    expect(d.leaderIds()).toEqual([b]);
    expect(d.length).toBe(bCells.length);
    for (let i = 0; i < d.state.length; i++) {
      if (d.state[i] === Cell.Channel) expect(d.owner[i]).toBe(b);
    }
    // 残ったリーダーは伸び続けられる
    const before = d.length;
    d.grow(2, rng, b);
    expect(d.length).toBe(before + 1);
  });

  it('リーダーは同じ電場を共有する: 放電路のそばは電位が下がり、他の雷が近寄りにくくなる', () => {
    const empty = field();
    const d = field();
    const a = d.seed(30, 1);
    const rng = createRng('shield');
    for (let k = 0; k < 120; k++) d.grow(3, rng, a);
    d.relax(300);
    // 放電路の先端から横に 3 マスの電位は、何もない場より低い
    const tip = d.order[d.length - 1]!;
    const x = tip % 60;
    const y = Math.floor(tip / 60);
    const side = y * 60 + Math.min(59, x + 3);
    expect(d.phi[side]!).toBeLessThan(empty.phi[side]! - 0.05);
  });
});
