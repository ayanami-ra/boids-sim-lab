/**
 * 一様グリッドによる近傍探索。N 体の相互作用を O(N^2) から概ね O(N) にする。
 * 毎ステップ build() し直す使い方を想定し、内部配列は再利用する。
 */
export class SpatialHash {
  private cellStart: Int32Array = new Int32Array(0);
  private cellCount: Int32Array = new Int32Array(0);
  private sorted: Int32Array = new Int32Array(0);
  private cols = 0;
  private rows = 0;

  constructor(
    public readonly cellSize: number,
    public width: number,
    public height: number,
  ) {
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.cols = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));
    const n = this.cols * this.rows;
    this.cellStart = new Int32Array(n + 1);
    this.cellCount = new Int32Array(n);
  }

  private cellOf(x: number, y: number): number {
    const cx = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const cy = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    return cy * this.cols + cx;
  }

  /** xs[i], ys[i] の点群でグリッドを構築する（計数ソート） */
  build(xs: ArrayLike<number>, ys: ArrayLike<number>, count: number): void {
    if (this.sorted.length < count) this.sorted = new Int32Array(count);
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) this.cellCount[this.cellOf(xs[i]!, ys[i]!)]!++;
    let acc = 0;
    for (let c = 0; c < this.cellCount.length; c++) {
      this.cellStart[c] = acc;
      acc += this.cellCount[c]!;
    }
    this.cellStart[this.cellCount.length] = acc;
    this.cellCount.fill(0);
    for (let i = 0; i < count; i++) {
      const c = this.cellOf(xs[i]!, ys[i]!);
      this.sorted[this.cellStart[c]! + this.cellCount[c]!++] = i;
    }
  }

  /** (x, y) から半径 r 以内の「候補」を visit に渡す。距離判定は呼び出し側で行う */
  query(x: number, y: number, r: number, visit: (index: number) => void): void {
    const s = this.cellSize;
    const x0 = Math.max(0, Math.floor((x - r) / s));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / s));
    const y0 = Math.max(0, Math.floor((y - r) / s));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / s));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const c = cy * this.cols + cx;
        for (let k = this.cellStart[c]!; k < this.cellStart[c + 1]!; k++) visit(this.sorted[k]!);
      }
    }
  }
}
