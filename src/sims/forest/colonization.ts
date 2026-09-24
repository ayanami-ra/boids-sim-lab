/**
 * 空間コロニー化アルゴリズム（Space Colonization, Runions ほか 2007）による樹木の成長。
 *
 * 空間に「光の粒」（まだ枝が来ていない空き空間）をばらまく。
 * 各粒は影響半径 influence 以内でいちばん近い枝の節を 1 つだけ引き寄せ、
 * 引き寄せられた節はその方向（の平均）へ新しい節を伸ばす。
 * 節が kill 距離まで近づいた粒は消える（その空間は埋まった）。
 *
 * 粒は木を区別せず、いちばん近い節を引き寄せるので、隣り合う木は光を奪い合う。
 * その結果、樹冠どうしが少し隙間を空けて伸びる「樹冠の遠慮（crown shyness）」が自然に現れる。
 *
 * 枝の太さはパイプモデル（ダ・ヴィンチの規則）: 親の太さ^p = 子の太さ^p の和。
 */
import { SpatialHash } from '../../core/spatial-hash';
import type { Rng } from '../../core/rng';

export interface ForestParams {
  /** 光の粒が枝を引き寄せる距離 */
  influence: number;
  /** 枝がここまで近づいた粒は消える */
  kill: number;
  /** 1 回の成長で伸びる長さ */
  segment: number;
  /** 上へ伸びようとする強さ（光屈性） */
  tropism: number;
  /** 幹を伸ばす最大の高さ（地面から） */
  maxTrunk: number;
  /** 枝先の太さ */
  tipRadius: number;
  /** パイプモデルの指数（2〜3。ダ・ヴィンチの規則は 2） */
  pipeExponent: number;
}

export const DEFAULT_PARAMS: ForestParams = {
  influence: 70,
  kill: 14,
  segment: 7,
  tropism: 0.25,
  maxTrunk: 260,
  tipRadius: 0.55,
  pipeExponent: 2.4,
};

export interface Tree {
  root: number;
  /** 幹の先端（樹冠に届くまでまっすぐ伸ばす） */
  tip: number;
  trunkGrowing: boolean;
  /** 木ごとの色合い（秋の紅葉の色などに使う） */
  hue: number;
}

export class Forest {
  x = new Float32Array(1024);
  y = new Float32Array(1024);
  parent = new Int32Array(1024);
  tree = new Int32Array(1024);
  radius = new Float32Array(1024);
  children = new Uint16Array(1024);
  /** 生まれた成長回（新しい枝ほど大きい） */
  born = new Int32Array(1024);
  /** 幹として伸びた節（葉を付けない）なら 1 */
  trunk = new Uint8Array(1024);
  n = 0;

  ax = new Float32Array(0);
  ay = new Float32Array(0);
  attractors = 0;

  trees: Tree[] = [];
  iteration = 0;

  private readonly nodeHash: SpatialHash;
  private sumX = new Float32Array(1024);
  private sumY = new Float32Array(1024);
  private hits = new Int32Array(1024);
  /** 光の粒ごとの、いちばん近い節（なければ -1） */
  private nearest = new Int32Array(0);

  constructor(
    readonly width: number,
    readonly height: number,
    readonly groundY: number,
    readonly params: ForestParams = DEFAULT_PARAMS,
  ) {
    this.nodeHash = new SpatialHash(params.influence, width, height);
  }

  /**
   * 樹冠が広がれる空間（地面より上、空の下）に光の粒を count 個加える。
   * x0..x1 で横の範囲を絞れる（種をまいた場所のまわりだけ、など）
   */
  addAttractors(
    count: number,
    rng: Rng,
    x0 = this.width * 0.02,
    x1 = this.width * 0.98,
    top = this.groundY * 0.08,
    bottom = this.groundY * 0.72,
  ) {
    const ax = new Float32Array(this.attractors + count);
    const ay = new Float32Array(this.attractors + count);
    ax.set(this.ax.subarray(0, this.attractors));
    ay.set(this.ay.subarray(0, this.attractors));
    for (let i = 0; i < count; i++) {
      // 上の方ほど光が多い
      const u = Math.pow(rng.next(), 1.3);
      ax[this.attractors + i] = rng.range(x0, x1);
      ay[this.attractors + i] = top + u * (bottom - top);
    }
    this.ax = ax;
    this.ay = ay;
    this.attractors += count;
  }

  /** x の地面に種をまく。木の番号を返す */
  plant(x: number, hue: number): number {
    const root = this.addNode(x, this.groundY, -1, this.trees.length);
    this.trunk[root] = 1;
    this.trees.push({ root, tip: root, trunkGrowing: true, hue });
    return this.trees.length - 1;
  }

  private addNode(x: number, y: number, parent: number, tree: number): number {
    if (this.n === this.x.length) this.grow2x();
    const i = this.n++;
    this.x[i] = x;
    this.y[i] = y;
    this.parent[i] = parent;
    this.tree[i] = tree;
    this.children[i] = 0;
    this.radius[i] = this.params.tipRadius;
    this.born[i] = this.iteration;
    this.trunk[i] = 0;
    if (parent >= 0) this.children[parent]!++;
    return i;
  }

  private grow2x() {
    const size = this.x.length * 2;
    const f = (a: Float32Array) => {
      const b = new Float32Array(size);
      b.set(a);
      return b;
    };
    const g = (a: Int32Array) => {
      const b = new Int32Array(size);
      b.set(a);
      return b;
    };
    this.x = f(this.x);
    this.y = f(this.y);
    this.radius = f(this.radius);
    this.sumX = f(this.sumX);
    this.sumY = f(this.sumY);
    this.parent = g(this.parent);
    this.tree = g(this.tree);
    this.born = g(this.born);
    this.hits = g(this.hits);
    const c = new Uint16Array(size);
    c.set(this.children);
    this.children = c;
    const tr = new Uint8Array(size);
    tr.set(this.trunk);
    this.trunk = tr;
  }

  /** 1 回ぶん成長させる。新しく伸びた節の数を返す */
  grow(): number {
    const { influence, kill, segment, tropism, maxTrunk } = this.params;
    const n = this.n;
    this.iteration++;
    this.nodeHash.build(this.x, this.y, n);
    this.sumX.fill(0, 0, n);
    this.sumY.fill(0, 0, n);
    this.hits.fill(0, 0, n);

    // 光の粒ごとに、いちばん近い節を探す
    if (this.nearest.length < this.attractors) this.nearest = new Int32Array(this.ax.length);
    let alive = 0;
    const influence2 = influence * influence;
    const kill2 = kill * kill;
    for (let a = 0; a < this.attractors; a++) {
      const px = this.ax[a]!;
      const py = this.ay[a]!;
      let best = -1;
      let bestD2 = influence2;
      this.nodeHash.query(px, py, influence, (i) => {
        const dx = px - this.x[i]!;
        const dy = py - this.y[i]!;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      });
      if (best >= 0 && bestD2 < kill2) continue; // 空間が埋まったので消す
      this.ax[alive] = px;
      this.ay[alive] = py;
      this.nearest[alive] = best;
      alive++;
      if (best < 0) continue;
      const d = Math.sqrt(bestD2) || 1;
      this.sumX[best]! += (px - this.x[best]!) / d;
      this.sumY[best]! += (py - this.y[best]!) / d;
      this.hits[best]!++;
    }
    this.attractors = alive;

    // 引き寄せられた節から新しい節を伸ばす
    let added = 0;
    const touched = new Set<number>();
    const blocked = new Uint8Array(n);
    const tooClose = segment * 0.3;
    for (let i = 0; i < n; i++) {
      if (this.hits[i] === 0) continue;
      let dx = this.sumX[i]! / this.hits[i]!;
      let dy = this.sumY[i]! / this.hits[i]! - tropism;
      const len = Math.hypot(dx, dy);
      // 反対向きの粒に引っ張られて打ち消し合ったときは伸ばさない
      if (len < 0.05) {
        blocked[i] = 1;
        continue;
      }
      dx /= len;
      dy /= len;
      const nx = this.x[i]! + dx * segment;
      const ny = Math.min(this.groundY - 2, this.y[i]! + dy * segment);
      // 伸ばす先にもう節があるなら伸ばさない。粒が新しい節より元の節に近いままだと、
      // 毎回同じ場所に節を生やし続けてしまう（空間コロニー化のよく知られた落とし穴）
      let occupied = false;
      this.nodeHash.query(nx, ny, tooClose, (j) => {
        if (Math.abs(this.x[j]! - nx) < tooClose && Math.abs(this.y[j]! - ny) < tooClose)
          occupied = true;
      });
      if (occupied) {
        blocked[i] = 1;
        continue;
      }
      const tree = this.tree[i]!;
      this.addNode(nx, ny, i, tree);
      touched.add(tree);
      added++;
    }

    // 伸ばせなかった節を引っ張っている粒は、もう届かない空間として消す
    let kept = 0;
    for (let a = 0; a < this.attractors; a++) {
      const b = this.nearest[a]!;
      if (b >= 0 && blocked[b]) continue;
      this.ax[kept] = this.ax[a]!;
      this.ay[kept] = this.ay[a]!;
      kept++;
    }
    this.attractors = kept;

    // 樹冠に届くまで、幹はまっすぐ上へ伸ばす
    for (let t = 0; t < this.trees.length; t++) {
      const tree = this.trees[t]!;
      if (!tree.trunkGrowing) continue;
      if (touched.has(t) || this.groundY - this.y[tree.tip]! > maxTrunk) {
        tree.trunkGrowing = false;
        continue;
      }
      const tip = tree.tip;
      tree.tip = this.addNode(this.x[tip]!, this.y[tip]! - segment, tip, t);
      this.trunk[tree.tip] = 1;
      added++;
    }

    this.updateRadii();
    return added;
  }

  /** パイプモデルで全ての枝の太さを計算し直す（子は必ず親より後ろの番号） */
  updateRadii() {
    const { tipRadius, pipeExponent: p } = this.params;
    const acc = new Float64Array(this.n);
    const tip = Math.pow(tipRadius, p);
    for (let i = this.n - 1; i >= 0; i--) {
      if (this.children[i] === 0) acc[i] = tip;
      this.radius[i] = Math.pow(acc[i]!, 1 / p);
      const parent = this.parent[i]!;
      if (parent >= 0) acc[parent]! += acc[i]!;
    }
  }
}
