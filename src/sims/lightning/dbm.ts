/**
 * 絶縁破壊モデル（Dielectric Breakdown Model, Niemeyer–Pietronero–Wiesmann 1984）。
 *
 * 空間を格子に分け、電位 φ をラプラス方程式 ∇²φ = 0 で解く。
 * 放電路（すでに電離した道）は φ = 0、地面や避雷針は φ = 1。
 * 放電路に隣接するセルのどれかが、確率 ∝ φ^η で次に電離する。
 * 電場の強いところ（尖った先端の前など）ほど伸びやすいので、枝分かれしながら地面へ向かう。
 * η が大きいほど枝分かれが少なく、まっすぐな稲妻になる。
 */
import type { Rng } from '../../core/rng';

export const Cell = { Free: 0, Channel: 1, Ground: 2 } as const;

export type Mode = 'lightning' | 'lichtenberg';

export class Discharge {
  readonly phi: Float32Array;
  readonly state: Uint8Array;
  /** 放電路の各セルが、どのセルから伸びたか（根は -1） */
  readonly parent: Int32Array;
  /** 放電路に加わった順のセル番号 */
  readonly order: Int32Array;
  length = 0;
  /** 地面に届いたセル（届いていなければ -1） */
  struck = -1;

  private readonly candidates: Int32Array;
  private readonly candidateIndex: Int32Array;
  private candidateCount = 0;
  private readonly weights: Float64Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly mode: Mode,
  ) {
    const n = w * h;
    this.phi = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.parent = new Int32Array(n).fill(-1);
    this.order = new Int32Array(n);
    this.candidates = new Int32Array(n);
    this.candidateIndex = new Int32Array(n).fill(-1);
    this.weights = new Float64Array(n);
    this.initPotential();
  }

  /** 解きはじめの電位（収束を速くするための初期値） */
  private initPotential() {
    const { w, h } = this;
    if (this.mode === 'lightning') {
      // 雲（上端、φ=0）から地面（下端、φ=1）へ一様に上がる
      for (let y = 0; y < h; y++) this.phi.fill(y / (h - 1), y * w, (y + 1) * w);
      for (let x = 0; x < w; x++) this.state[(h - 1) * w + x] = Cell.Ground;
    } else {
      // 円形の電極の外側を地面にする
      const cx = (w - 1) / 2;
      const cy = (h - 1) / 2;
      const r = Math.min(w, h) / 2 - 1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = Math.hypot(x - cx, y - cy);
          const i = y * w + x;
          if (d >= r) this.state[i] = Cell.Ground;
          this.phi[i] = Math.min(1, Math.log(1 + d) / Math.log(1 + r));
        }
      }
    }
    for (let i = 0; i < this.state.length; i++) if (this.state[i] === Cell.Ground) this.phi[i] = 1;
  }

  /** 地面（φ=1）のセルを追加する。避雷針や山など */
  addGround(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.state[i] === Cell.Channel) return;
    this.state[i] = Cell.Ground;
    this.phi[i] = 1;
    this.removeCandidate(i);
  }

  /** 放電の起点を置く */
  seed(x: number, y: number) {
    this.addChannel(y * this.w + x, -1);
  }

  private addChannel(i: number, from: number) {
    this.state[i] = Cell.Channel;
    this.phi[i] = 0;
    this.parent[i] = from;
    this.order[this.length++] = i;
    this.removeCandidate(i);
    const { w, h } = this;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (this.state[j] === Cell.Free && this.candidateIndex[j] === -1) {
          this.candidateIndex[j] = this.candidateCount;
          this.candidates[this.candidateCount++] = j;
        }
      }
    }
  }

  private removeCandidate(i: number) {
    const k = this.candidateIndex[i]!;
    if (k === -1) return;
    const last = this.candidates[--this.candidateCount]!;
    this.candidates[k] = last;
    this.candidateIndex[last] = k;
    this.candidateIndex[i] = -1;
  }

  /**
   * 赤黒 SOR 法で電位を緩和する。x0..x1, y0..y1（含む）の範囲だけを解くこともできる。
   * 左右の端は鏡映（電場が横に漏れない）、雷モードの上端は雲として φ=0。
   */
  relax(sweeps: number, x0 = 0, y0 = 0, x1 = this.w - 1, y1 = this.h - 1, omega = 1.85) {
    const { w, h, phi, state } = this;
    const top = this.mode === 'lightning' ? 0 : -1;
    for (let s = 0; s < sweeps * 2; s++) {
      const color = s & 1;
      for (let y = y0; y <= y1; y++) {
        const row = y * w;
        for (let x = x0 + ((x0 + y + color) & 1); x <= x1; x += 2) {
          const i = row + x;
          if (state[i] !== Cell.Free) continue;
          const left = x > 0 ? phi[i - 1]! : phi[i + 1]!;
          const right = x < w - 1 ? phi[i + 1]! : phi[i - 1]!;
          const up = y > 0 ? phi[i - w]! : top >= 0 ? top : phi[i + w]!;
          const down = y < h - 1 ? phi[i + w]! : phi[i - w]!;
          const next = 0.25 * (left + right + up + down);
          phi[i] = phi[i]! + omega * (next - phi[i]!);
        }
      }
    }
  }

  /**
   * 放電路を 1 セル伸ばす。電位を少し解き直してから、候補を φ^η の重みで選ぶ。
   * 地面に届いたら true。
   */
  grow(eta: number, rng: Rng): boolean {
    if (this.struck >= 0 || this.candidateCount === 0) return this.struck >= 0;
    let total = 0;
    for (let k = 0; k < this.candidateCount; k++) {
      const p = Math.max(0, this.phi[this.candidates[k]!]!);
      const wgt = eta === 1 ? p : Math.pow(p, eta);
      this.weights[k] = wgt;
      total += wgt;
    }
    let k = 0;
    if (total > 0) {
      let r = rng.next() * total;
      for (; k < this.candidateCount - 1; k++) {
        r -= this.weights[k]!;
        if (r <= 0) break;
      }
    } else {
      k = rng.int(this.candidateCount);
    }
    const i = this.candidates[k]!;
    this.addChannel(i, this.nearestChannelNeighbor(i));

    // 新しいセルのまわりだけ念入りに解き直し、全体は軽く 1 回
    const x = i % this.w;
    const y = (i - x) / this.w;
    const r = 6;
    this.relax(
      4,
      Math.max(0, x - r),
      Math.max(0, y - r),
      Math.min(this.w - 1, x + r),
      Math.min(this.h - 1, y + r),
    );

    if (this.touchesGround(i)) this.struck = i;
    return this.struck >= 0;
  }

  /** i に隣接する放電路のセル（まっすぐの隣を優先） */
  private nearestChannelNeighbor(i: number): number {
    const { w, h } = this;
    const x = i % w;
    const y = (i - x) / w;
    let best = -1;
    let bestDist = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        const d = dx * dx + dy * dy;
        if (this.state[j] === Cell.Channel && d < bestDist) {
          best = j;
          bestDist = d;
        }
      }
    }
    return best;
  }

  private touchesGround(i: number): boolean {
    const { w, h } = this;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (this.state[ny * w + nx] === Cell.Ground) return true;
      }
    }
    return false;
  }

  /** 地面に届いたセルから起点までの道（主放電路）。届いていなければ空 */
  mainPath(): number[] {
    const path: number[] = [];
    for (let i = this.struck; i >= 0; i = this.parent[i]!) path.push(i);
    return path;
  }

  /** 各セルより先に伸びた枝のセル数（その枝を流れる電流の目安）。order の添字で返す */
  subtreeSizes(): Float32Array {
    const sizes = new Float32Array(this.w * this.h);
    for (let k = this.length - 1; k >= 0; k--) {
      const i = this.order[k]!;
      sizes[i]! += 1;
      const p = this.parent[i]!;
      if (p >= 0) sizes[p]! += sizes[i]!;
    }
    return sizes;
  }
}
