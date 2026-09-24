/**
 * 三重振り子（同じ長さ l、同じ質量 m の点質量を 3 つつないだもの）の運動方程式。
 *
 * 角度 θ_i は鉛直下向きから測る。ラグランジュ方程式から
 *   Σ_j μ_ij l cos(θ_i − θ_j) θ̈_j = −Σ_j μ_ij l sin(θ_i − θ_j) θ̇_j² − μ_ii g sin θ_i
 * が得られる。μ_ij は「i 番目と j 番目のうち下側の棒より下にある質量の数」= 3 − max(i, j)。
 * これを 3×3 の連立一次方程式として解いて角加速度 θ̈ を求め、4 次のルンゲ＝クッタ法で積分する。
 *
 * GPU 版（shaders.ts）はこれと同じ式を WGSL で書いたもの。
 */

export const G = 9.81;
export const LENGTH = 1;

/** θ1, θ2, θ3, ω1, ω2, ω3 */
export type State = [number, number, number, number, number, number];

const mu = (i: number, j: number) => 3 - Math.max(i, j);

/** 角加速度 θ̈ */
export function acceleration(s: State, g = G, l = LENGTH): [number, number, number] {
  const m: number[][] = [[], [], []];
  const f: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const d = s[i]! - s[j]!;
      m[i]![j] = mu(i, j) * l * Math.cos(d);
      f[i]! -= mu(i, j) * l * Math.sin(d) * s[j + 3]! ** 2;
    }
    f[i]! -= mu(i, i) * g * Math.sin(s[i]!);
  }
  return solve3(m, f);
}

/** 3×3 の連立一次方程式 m x = f（クラメルの公式） */
export function solve3(m: number[][], f: number[]): [number, number, number] {
  const [a, b, c] = m[0]!;
  const [d, e, ff] = m[1]!;
  const [g, h, i] = m[2]!;
  const det = a! * (e! * i! - ff! * h!) - b! * (d! * i! - ff! * g!) + c! * (d! * h! - e! * g!);
  const [p, q, r] = f;
  const x =
    (p! * (e! * i! - ff! * h!) - b! * (q! * i! - ff! * r!) + c! * (q! * h! - e! * r!)) / det;
  const y =
    (a! * (q! * i! - ff! * r!) - p! * (d! * i! - ff! * g!) + c! * (d! * r! - q! * g!)) / det;
  const z = (a! * (e! * r! - q! * h!) - b! * (d! * r! - q! * g!) + p! * (d! * h! - e! * g!)) / det;
  return [x, y, z];
}

function derivative(s: State): State {
  const [a1, a2, a3] = acceleration(s);
  return [s[3], s[4], s[5], a1, a2, a3];
}

/** 4 次のルンゲ＝クッタ法で dt 進める */
export function rk4(s: State, dt: number): State {
  const add = (a: State, b: State, k: number) => a.map((v, i) => v + b[i]! * k) as State;
  const k1 = derivative(s);
  const k2 = derivative(add(s, k1, dt / 2));
  const k3 = derivative(add(s, k2, dt / 2));
  const k4 = derivative(add(s, k3, dt));
  return s.map((v, i) => v + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)) as State;
}

/** 3 つのおもりの位置（支点が原点、y は上向き） */
export function positions(s: State, l = LENGTH): [number, number][] {
  let x = 0;
  let y = 0;
  return [0, 1, 2].map((i) => {
    x += l * Math.sin(s[i]!);
    y -= l * Math.cos(s[i]!);
    return [x, y];
  });
}

/** 全エネルギー（質量 1 あたり 3 個ぶん） */
export function energy(s: State, g = G, l = LENGTH): number {
  let vx = 0;
  let vy = 0;
  let y = 0;
  let e = 0;
  for (let i = 0; i < 3; i++) {
    vx += l * Math.cos(s[i]!) * s[i + 3]!;
    vy += l * Math.sin(s[i]!) * s[i + 3]!;
    y -= l * Math.cos(s[i]!);
    e += 0.5 * (vx * vx + vy * vy) + g * y;
  }
  return e;
}

/** いずれかの棒が真上を越えて一回転したか */
export const flipped = (s: State) =>
  Math.abs(s[0]) > Math.PI || Math.abs(s[1]) > Math.PI || Math.abs(s[2]) > Math.PI;

/** 2 つの状態の角度の差の最大値 */
export const angleGap = (a: State, b: State) =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
