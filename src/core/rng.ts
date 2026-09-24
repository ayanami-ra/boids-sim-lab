/**
 * シード付き乱数（sfc32）。同じシードなら毎回同じ結果になるので、
 * バグ再現・スクリーンショット比較・テストで使う。Math.random() は使わない。
 */
export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, max) の一様乱数 */
  range(min: number, max: number): number;
  /** [0, n) の整数 */
  int(n: number): number;
  /** 標準正規分布（Box–Muller） */
  gaussian(): number;
}

export function hashSeed(seed: string | number): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let a = hashSeed(seed);
  let b = hashSeed(`${seed}:b`);
  let c = hashSeed(`${seed}:c`);
  let d = 1;
  const next = (): number => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  // 立ち上がり直後の偏りを捨てる
  for (let i = 0; i < 12; i++) next();

  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (n) => Math.floor(next() * n),
    gaussian: () => {
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
