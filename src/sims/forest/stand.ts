/**
 * 森林動態の「ギャップモデル」（JABOWA, FORET, SORTIE の系譜）を簡略化した個体ベースモデル。
 *
 * 林分（横 width m × 奥行き depth m）の木を 1 本ずつ扱い、1 年ごとに次を計算する。
 * 1. 光: 背の高い木から順に、樹冠の下の 1 m 格子の光を葉の量に応じて減らす（ベールの法則）
 * 2. 成長: 受け取った光に応じて幹の太さ（胸高直径 D）が増え、樹高と樹冠は D から決まる
 * 3. 枯死: 寿命による背景死亡 + 光不足で育たない木の被圧枯死
 * 4. 更新: 成熟した木が種を散布し、落ちた場所の林床の明るさに応じて芽生える
 *
 * 種ごとに「明るい所で速く育つが日陰に弱い（先駆種）」「日陰でも耐えるが遅い（極相種）」
 * というトレードオフを持たせると、裸地から始めたとき先駆種 → 極相種への遷移が自然に現れる。
 */
import type { Rng } from '../../core/rng';
import type { Text } from '../../core/i18n';

export type SpeciesId = 'birch' | 'pine' | 'oak' | 'beech';

export interface Species {
  id: SpeciesId;
  name: Text;
  /** 最大樹高 m */
  hMax: number;
  /** 最大胸高直径 cm */
  dMax: number;
  /** 最大寿命（年）。背景死亡率はこの年齢で 1% が生き残るように決める */
  maxAge: number;
  /** 全天の光での直径成長 cm/年 */
  growth: number;
  /** 光への反応の半飽和点。小さいほど暗い所でも成長できる（耐陰性） */
  lightHalf: number;
  /** これより暗いと被圧枯死しやすい */
  lightMin: number;
  /** 芽生えに必要な林床の明るさ */
  establish: number;
  /** 樹冠半径 m = crown × D^0.6 */
  crown: number;
  /** 葉面積指数。大きいほど下が暗くなる */
  lai: number;
  /** 種子散布の平均距離 m */
  dispersal: number;
  /** 1 年に作る（芽生えを試みる）種子の数（成熟木 1 本、樹冠 10 m² あたり） */
  fecundity: number;
  /** 種子を作り始める直径 cm */
  dMature: number;
  /** 大径木が山火事を生き延びる確率 */
  fireSurvival: number;
  evergreen: boolean;
}

export const SPECIES: Species[] = [
  {
    id: 'birch',
    name: { ja: 'シラカバ', en: 'Birch' },
    hMax: 22,
    dMax: 45,
    maxAge: 90,
    growth: 1.6,
    lightHalf: 0.45,
    lightMin: 0.3,
    establish: 0.45,
    crown: 0.32,
    lai: 2,
    dispersal: 35,
    fecundity: 2.2,
    dMature: 10,
    fireSurvival: 0.1,
    evergreen: false,
  },
  {
    id: 'pine',
    name: { ja: 'アカマツ', en: 'Pine' },
    hMax: 28,
    dMax: 65,
    maxAge: 220,
    growth: 1.05,
    lightHalf: 0.4,
    lightMin: 0.28,
    establish: 0.5,
    crown: 0.36,
    lai: 2.6,
    dispersal: 22,
    fecundity: 1.3,
    dMature: 14,
    fireSurvival: 0.75,
    evergreen: true,
  },
  {
    id: 'oak',
    name: { ja: 'ミズナラ', en: 'Oak' },
    hMax: 27,
    dMax: 95,
    maxAge: 350,
    growth: 0.75,
    lightHalf: 0.2,
    lightMin: 0.1,
    establish: 0.12,
    crown: 0.5,
    lai: 4,
    dispersal: 9,
    fecundity: 0.8,
    dMature: 22,
    fireSurvival: 0.35,
    evergreen: false,
  },
  {
    id: 'beech',
    name: { ja: 'ブナ', en: 'Beech' },
    hMax: 31,
    dMax: 105,
    maxAge: 400,
    growth: 0.6,
    lightHalf: 0.08,
    lightMin: 0.025,
    establish: 0.02,
    crown: 0.55,
    lai: 6,
    dispersal: 11,
    fecundity: 1.0,
    dMature: 25,
    fireSurvival: 0.04,
    evergreen: false,
  },
];

/** 光の減衰係数（ベール–ランバートの法則の k） */
const EXTINCTION = 0.5;
/** 芽生えたばかりの木の直径 cm */
const SEEDLING_D = 0.4;

export interface TreeState {
  id: number;
  species: number;
  x: number;
  z: number;
  /** 胸高直径 cm */
  d: number;
  /** 前の年の直径（描画で 1 年の間をなめらかにつなぐ） */
  dPrev: number;
  age: number;
  /** 最後に計算した樹冠の上の明るさ（0〜1） */
  light: number;
  /** 見た目の個体差に使う乱数の種 */
  look: number;
}

export interface Snag {
  x: number;
  z: number;
  height: number;
  d: number;
  species: number;
  /** 立ち枯れ（0）か倒木（1）か */
  fallen: boolean;
  /** 倒れた向き（-1 / 1） */
  side: number;
  years: number;
}

/** 樹高 m。直径 1 cm でおよそ 1 m、太くなるほど最大樹高に近づく */
export function height(sp: Species, d: number): number {
  return sp.hMax * (1 - Math.exp((-1.15 * d) / sp.hMax));
}

export function crownRadius(sp: Species, d: number): number {
  return Math.max(0.25, sp.crown * Math.pow(d, 0.6));
}

/** 光 L のもとでの直径成長（cm/年）。L = 1 で sp.growth、半飽和点 lightHalf の飽和曲線 */
export function diameterGrowth(sp: Species, d: number, light: number): number {
  const response = (light * (1 + sp.lightHalf)) / (light + sp.lightHalf);
  // 大きくなるほど成長は鈍る
  return sp.growth * response * Math.max(0.05, 1 - d / sp.dMax);
}

export interface StandOptions {
  width: number;
  depth: number;
  /** 林分の外から毎年飛んでくる種子の数（種ごと、相対値） */
  seedRain: Record<SpeciesId, number>;
  /** 木の最大本数（処理を軽く保つ） */
  maxTrees: number;
}

export const DEFAULT_STAND: StandOptions = {
  width: 100,
  depth: 30,
  seedRain: { birch: 7, pine: 3, oak: 1, beech: 0.6 },
  maxTrees: 900,
};

export class Stand {
  trees: TreeState[] = [];
  snags: Snag[] = [];
  year = 0;
  /** 林床（地面の高さ）の明るさ。1 m 格子、x 優先 */
  readonly floorLight: Float32Array;
  readonly gw: number;
  readonly gd: number;
  private nextId = 1;
  /** 各年の種ごとの胸高断面積合計（m²/ha） */
  readonly history: Float32Array[] = [];

  constructor(
    readonly rng: Rng,
    readonly options: StandOptions = DEFAULT_STAND,
  ) {
    this.gw = Math.ceil(options.width);
    this.gd = Math.ceil(options.depth);
    this.floorLight = new Float32Array(this.gw * this.gd).fill(1);
  }

  addTree(species: number, x: number, z: number, d = SEEDLING_D, age = 0): TreeState {
    const t: TreeState = {
      id: this.nextId++,
      species,
      x,
      z,
      d,
      dPrev: d,
      age,
      light: 1,
      look: this.rng.next(),
    };
    this.trees.push(t);
    return t;
  }

  /**
   * 光の計算。背の高い木から順に、樹冠が覆う格子の光を exp(-k·LAI) 倍する。
   * 各木の明るさは、自分より高い木を通り抜けてきた光の、樹冠の下の平均。
   */
  computeLight() {
    const grid = this.floorLight;
    grid.fill(1);
    const order = [...this.trees].sort(
      (a, b) => height(SPECIES[b.species]!, b.d) - height(SPECIES[a.species]!, a.d),
    );
    for (const t of order) {
      const sp = SPECIES[t.species]!;
      const r = crownRadius(sp, t.d);
      const cells = this.crownCells(t.x, t.z, r);
      let sum = 0;
      for (const c of cells) sum += grid[c]!;
      t.light = cells.length ? sum / cells.length : 1;
      // 小さな苗は樹冠が格子 1 マスより小さいので、そのマスの一部だけを暗くする
      const cover = Math.min(1, Math.PI * r * r);
      const transmit = 1 - cover * (1 - Math.exp(-EXTINCTION * sp.lai));
      for (const c of cells) grid[c]! *= transmit;
    }
  }

  private crownCells(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.gw - 1, Math.floor(x + r));
    const z0 = Math.max(0, Math.floor(z - r));
    const z1 = Math.min(this.gd - 1, Math.floor(z + r));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const dx = gx + 0.5 - x;
        const dz = gz + 0.5 - z;
        if (dx * dx + dz * dz <= Math.max(r * r, 0.5)) out.push(gz * this.gw + gx);
      }
    }
    if (out.length === 0) {
      const gx = Math.min(this.gw - 1, Math.max(0, Math.floor(x)));
      const gz = Math.min(this.gd - 1, Math.max(0, Math.floor(z)));
      out.push(gz * this.gw + gx);
    }
    return out;
  }

  lightAt(x: number, z: number): number {
    const gx = Math.floor(x);
    const gz = Math.floor(z);
    if (gx < 0 || gz < 0 || gx >= this.gw || gz >= this.gd) return 1;
    return this.floorLight[gz * this.gw + gx]!;
  }

  /** 1 年進める */
  step() {
    const { rng } = this;
    this.year++;
    this.computeLight();

    // 成長と枯死
    const survivors: TreeState[] = [];
    for (const t of this.trees) {
      const sp = SPECIES[t.species]!;
      t.dPrev = t.d;
      t.age++;
      const grow = diameterGrowth(sp, t.d, t.light);
      t.d = Math.min(sp.dMax, t.d + grow);
      const background = 1 - Math.exp(-4.6 / sp.maxAge);
      // 光が足りず、ほとんど太れない木は枯れやすい（被圧枯死）
      const suppressed = t.light < sp.lightMin ? 0.12 + 0.25 * (1 - t.light / sp.lightMin) : 0;
      const old = t.age > sp.maxAge ? 0.15 : 0;
      if (rng.next() < background + suppressed + old) {
        this.kill(t, false);
      } else {
        survivors.push(t);
      }
    }
    this.trees = survivors;

    // 種子散布と芽生え
    const room = this.options.maxTrees - this.trees.length;
    if (room > 0) {
      const attempts: { species: number; x: number; z: number }[] = [];
      for (const t of this.trees) {
        const sp = SPECIES[t.species]!;
        if (t.d < sp.dMature) continue;
        const area = Math.PI * crownRadius(sp, t.d) ** 2;
        const count = poisson(rng, (sp.fecundity * area) / 10);
        for (let k = 0; k < count; k++) {
          const dist = -Math.log(1 - rng.next()) * sp.dispersal;
          const a = rng.range(0, Math.PI * 2);
          attempts.push({
            species: t.species,
            x: t.x + Math.cos(a) * dist,
            z: t.z + Math.sin(a) * dist,
          });
        }
      }
      // 林分の外から飛んでくる種子
      SPECIES.forEach((sp, s) => {
        const count = poisson(rng, this.options.seedRain[sp.id] * (this.options.width / 100));
        for (let k = 0; k < count; k++) {
          attempts.push({
            species: s,
            x: rng.range(0, this.options.width),
            z: rng.range(0, this.options.depth),
          });
        }
      });
      // 並び順の偏りをなくしてから、入れる数だけ試す
      shuffle(attempts, rng);
      let added = 0;
      for (const a of attempts) {
        if (added >= room) break;
        if (a.x < 0 || a.z < 0 || a.x >= this.options.width || a.z >= this.options.depth) continue;
        const sp = SPECIES[a.species]!;
        const light = this.lightAt(a.x, a.z);
        // 暗すぎると芽生えない。明るいほど定着しやすい
        const p =
          light < sp.establish
            ? 0
            : 0.35 * Math.min(1, (light - sp.establish) / (1 - sp.establish) + 0.3);
        if (rng.next() < p) {
          this.addTree(a.species, a.x, a.z);
          added++;
        }
      }
    }

    // 枯れ木: 立ち枯れはやがて倒れ、倒木は朽ちて消える
    for (const s of this.snags) {
      s.years++;
      if (!s.fallen && rng.next() < 0.15) s.fallen = true;
    }
    this.snags = this.snags.filter((s) => s.years < (s.fallen ? 25 : 40));

    this.history.push(this.basalAreaBySpecies());
  }

  /** 木を枯らす。倒れたかどうか（台風・伐採）を指定できる */
  kill(t: TreeState, fallen: boolean, side = this.rng.next() < 0.5 ? -1 : 1) {
    const sp = SPECIES[t.species]!;
    if (t.d > 4) {
      this.snags.push({
        x: t.x,
        z: t.z,
        height: height(sp, t.d),
        d: t.d,
        species: t.species,
        fallen,
        side,
        years: 0,
      });
    }
  }

  /** 種ごとの胸高断面積合計 m²/ha（森の「量」の標準的な指標） */
  basalAreaBySpecies(): Float32Array {
    const out = new Float32Array(SPECIES.length);
    const ha = (this.options.width * this.options.depth) / 10000;
    for (const t of this.trees) out[t.species]! += (Math.PI * (t.d / 200) ** 2) / ha;
    return out;
  }

  /** 台風: 背の高い木ほど倒れやすい。倒れた本数を返す */
  typhoon(direction = 1): number {
    let fallen = 0;
    this.trees = this.trees.filter((t) => {
      const sp = SPECIES[t.species]!;
      const h = height(sp, t.d);
      if (h < 8) return true;
      // 常緑の針葉樹は冬も葉があり風を受けやすい
      const p = 0.55 * Math.pow(h / 30, 2.5) * (sp.evergreen ? 1.3 : 1);
      if (this.rng.next() < p) {
        this.kill(t, true, direction);
        fallen++;
        return false;
      }
      return true;
    });
    this.computeLight();
    return fallen;
  }

  /** 山火事: 若い木はほぼ全滅。厚い樹皮を持つ大径木は種によって生き残る */
  fire(): number {
    let burned = 0;
    this.trees = this.trees.filter((t) => {
      const sp = SPECIES[t.species]!;
      const survive = t.d > 20 ? sp.fireSurvival : t.d > 8 ? sp.fireSurvival * 0.3 : 0;
      if (this.rng.next() < survive) return true;
      this.kill(t, false);
      burned++;
      return false;
    });
    // 燃えた枯れ木は残るが、倒木は燃え尽きる
    this.snags = this.snags.filter((s) => !s.fallen);
    this.computeLight();
    return burned;
  }

  /** 伐採: 指定した木を倒す */
  fell(t: TreeState) {
    this.trees = this.trees.filter((u) => u !== t);
    this.kill(t, true);
    this.computeLight();
  }
}

function poisson(rng: Rng, mean: number): number {
  if (mean <= 0) return 0;
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * rng.gaussian()));
  const limit = Math.exp(-mean);
  let k = 0;
  let p = rng.next();
  while (p > limit) {
    k++;
    p *= rng.next();
  }
  return k;
}

function shuffle<T>(a: T[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
}
