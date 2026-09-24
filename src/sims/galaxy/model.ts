/**
 * 銀河の初期条件。
 *
 * 単位系: G = 1、長さ 1 = 1 kpc、質量 1 = 1e10 太陽質量。
 * このとき時間 1 ≈ 4.71 Myr、速度 1 ≈ 207 km/s。
 *
 * 1 つの銀河は 3 成分からなる:
 * - 円盤: 指数関数型の面密度 + sech² 型の鉛直分布。回転曲線とトゥームレの Q から速度を決める
 * - バルジ: ヘルンキスト球。ジーンズ方程式から等方的な速度分散を決める
 * - ダークマターハロー: ヘルンキスト球（外側を打ち切り）。バルジと同様
 * どの粒子も質量を持ち、互いに重力を及ぼし合う（ハローも生きているので力学的摩擦で合体する）。
 */
import type { Text } from '../../core/i18n';
import type { Rng } from '../../core/rng';

export const UNIT_TIME_MYR = 4.71;
export const UNIT_VELOCITY_KMS = 207.4;

export const Component = { Disk: 0, Bulge: 1, Halo: 2 } as const;
export type Component = (typeof Component)[keyof typeof Component];

export interface GalaxySpec {
  disk: { mass: number; scaleLength: number; scaleHeight: number } | null;
  bulge: { mass: number; scale: number } | null;
  /** mass は打ち切り半径 cutoff より内側の質量 */
  halo: { mass: number; scale: number; cutoff: number };
  /** トゥームレの安定性パラメータ（大きいほど円盤が「熱く」安定） */
  toomreQ: number;
}

export const MILKY_WAY_LIKE: GalaxySpec = {
  disk: { mass: 4, scaleLength: 2.5, scaleHeight: 0.25 },
  bulge: { mass: 1, scale: 0.45 },
  halo: { mass: 24, scale: 7, cutoff: 45 },
  toomreQ: 1.5,
};

/** 質量を q 倍した相似な銀河。大きさは √q 倍にして中心の密度を同程度に保つ */
export function scaleGalaxy(spec: GalaxySpec, q: number): GalaxySpec {
  const l = Math.sqrt(q);
  return {
    disk: spec.disk && {
      mass: spec.disk.mass * q,
      scaleLength: spec.disk.scaleLength * l,
      scaleHeight: spec.disk.scaleHeight * l,
    },
    bulge: spec.bulge && { mass: spec.bulge.mass * q, scale: spec.bulge.scale * l },
    halo: {
      mass: spec.halo.mass * q,
      scale: spec.halo.scale * l,
      cutoff: spec.halo.cutoff * l,
    },
    toomreQ: spec.toomreQ,
  };
}

export function totalMass(spec: GalaxySpec): number {
  return (spec.disk?.mass ?? 0) + (spec.bulge?.mass ?? 0) + spec.halo.mass;
}

// ---- 質量分布 ----

/** 打ち切りなしのヘルンキスト球の、半径 r 以内の質量割合 */
export const hernquistFraction = (r: number, a: number) => (r * r) / ((r + a) * (r + a));

/** 指数円盤の、円柱半径 R 以内の質量割合 */
export const diskFraction = (r: number, rd: number) => 1 - (1 + r / rd) * Math.exp(-r / rd);

/** 半径 r 以内の質量（円盤は球対称で近似。回転曲線とジーンズ方程式に使う） */
export function enclosedMass(spec: GalaxySpec, r: number): number {
  const { halo, bulge, disk } = spec;
  const haloR = Math.min(r, halo.cutoff);
  let m =
    (halo.mass * hernquistFraction(haloR, halo.scale)) / hernquistFraction(halo.cutoff, halo.scale);
  if (bulge) m += bulge.mass * hernquistFraction(r, bulge.scale);
  if (disk) m += disk.mass * diskFraction(r, disk.scaleLength);
  return m;
}

/** 軟化長 eps を考慮した円運動の速度の 2 乗 */
export function circularVelocity2(spec: GalaxySpec, r: number, eps: number): number {
  const m = enclosedMass(spec, r);
  return (m * r * r) / Math.pow(r * r + eps * eps, 1.5);
}

// ---- サンプリング ----

/** ヘルンキスト球から半径を引く（cutoff で打ち切り） */
export function sampleHernquistRadius(u: number, a: number, cutoff: number): number {
  const s = Math.sqrt(u * hernquistFraction(cutoff, a));
  return (a * s) / (1 - s);
}

/** 指数円盤から円柱半径を引く（二分法、8 スケール長で打ち切り） */
export function sampleDiskRadius(u: number, rd: number): number {
  const target = u * diskFraction(8 * rd, rd);
  let lo = 0;
  let hi = 8 * rd;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (diskFraction(mid, rd) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function randomDirection(rng: Rng): [number, number, number] {
  const z = rng.range(-1, 1);
  const phi = rng.range(0, Math.PI * 2);
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(phi), s * Math.sin(phi), z];
}

/**
 * 球対称成分の速度分散 σ_r(r) を等方ジーンズ方程式で数値的に求める。
 * σ²(r) = (1/ρ(r)) ∫_r^∞ ρ(r') M(r') / r'² dr'
 * あわせて重力ポテンシャル Φ(r) も返す（脱出速度の上限に使う）。
 */
export function jeansProfile(
  spec: GalaxySpec,
  density: (r: number) => number,
  rMax: number,
): { sigma: (r: number) => number; potential: (r: number) => number } {
  const n = 512;
  const rMin = 1e-3;
  const outer = rMax * 4;
  const rs = new Float64Array(n);
  for (let i = 0; i < n; i++) rs[i] = rMin * Math.pow(outer / rMin, i / (n - 1));

  const sigma2 = new Float64Array(n);
  const phi = new Float64Array(n);
  const mTotal = enclosedMass(spec, outer);
  phi[n - 1] = -mTotal / outer;
  let integral = 0;
  for (let i = n - 2; i >= 0; i--) {
    const r0 = rs[i]!;
    const r1 = rs[i + 1]!;
    const f = (r: number) => (density(r) * enclosedMass(spec, r)) / (r * r);
    integral += 0.5 * (f(r0) + f(r1)) * (r1 - r0);
    const rho = density(r0);
    sigma2[i] = rho > 0 ? integral / rho : 0;
    const g = (r: number) => enclosedMass(spec, r) / (r * r);
    phi[i] = phi[i + 1]! - 0.5 * (g(r0) + g(r1)) * (r1 - r0);
  }

  const lookup = (table: Float64Array, r: number) => {
    if (r <= rMin) return table[0]!;
    if (r >= outer) return table[n - 1]!;
    const t = (Math.log(r / rMin) / Math.log(outer / rMin)) * (n - 1);
    const i = Math.floor(t);
    const f = t - i;
    return table[i]! * (1 - f) + table[i + 1]! * f;
  };
  return {
    sigma: (r) => Math.sqrt(Math.max(0, lookup(sigma2, r))),
    potential: (r) => lookup(phi, r),
  };
}

const hernquistDensity = (mass: number, a: number, cutoff: number) => {
  const norm = mass / hernquistFraction(cutoff, a);
  return (r: number) => (r > cutoff ? 0 : (norm * a) / (2 * Math.PI * r * Math.pow(r + a, 3)));
};

export interface Particles {
  /** x, y, z, 質量 */
  pos: Float32Array;
  /** vx, vy, vz, 種別（galaxyIndex * 3 + Component） */
  vel: Float32Array;
  count: number;
}

/**
 * 1 つの銀河を原点に静止した状態で生成し、out の offset 番目から書き込む。
 * 各成分の粒子数は counts で指定する（粒子 1 個の質量 = 成分質量 / 粒子数）。
 */
export function sampleGalaxy(
  spec: GalaxySpec,
  counts: { disk: number; bulge: number; halo: number },
  galaxyIndex: number,
  eps: number,
  rng: Rng,
  out: Particles,
  offset: number,
): number {
  let k = offset;
  const put = (
    x: number,
    y: number,
    z: number,
    m: number,
    vx: number,
    vy: number,
    vz: number,
    c: Component,
  ) => {
    out.pos.set([x, y, z, m], k * 4);
    out.vel.set([vx, vy, vz, galaxyIndex * 3 + c], k * 4);
    k++;
  };

  const spherical = (mass: number, scale: number, cutoff: number, n: number, c: Component) => {
    if (n <= 0) return;
    const density = hernquistDensity(mass, scale, cutoff);
    const { sigma, potential } = jeansProfile(spec, density, cutoff);
    for (let i = 0; i < n; i++) {
      const r = sampleHernquistRadius(rng.next(), scale, cutoff);
      const [dx, dy, dz] = randomDirection(rng);
      const s = sigma(r);
      const vEsc = Math.sqrt(-2 * potential(r));
      let vx = 0,
        vy = 0,
        vz = 0;
      for (let tries = 0; tries < 20; tries++) {
        vx = rng.gaussian() * s;
        vy = rng.gaussian() * s;
        vz = rng.gaussian() * s;
        if (Math.hypot(vx, vy, vz) < 0.95 * vEsc) break;
      }
      put(dx * r, dy * r, dz * r, mass / n, vx, vy, vz, c);
    }
  };

  const { disk, bulge, halo } = spec;
  if (disk && counts.disk > 0) {
    const { mass, scaleLength: rd, scaleHeight: zd } = disk;
    const omega2 = (r: number) => circularVelocity2(spec, r, eps) / (r * r);
    for (let i = 0; i < counts.disk; i++) {
      const r = sampleDiskRadius(rng.next(), rd);
      const phi = rng.range(0, Math.PI * 2);
      const z = zd * Math.atanh(Math.min(0.999, Math.max(-0.999, rng.range(-1, 1))));

      const vc2 = circularVelocity2(spec, r, eps);
      const vc = Math.sqrt(vc2);
      const h = 1e-3 * rd;
      const kappa2 = Math.max(
        1e-8,
        (r * (omega2(r + h) - omega2(Math.max(1e-4, r - h)))) / (2 * h) + 4 * omega2(r),
      );
      const kappa = Math.sqrt(kappa2);
      const surface = (mass / (2 * Math.PI * rd * rd)) * Math.exp(-r / rd);
      const sigmaR = Math.min(0.6 * vc, (spec.toomreQ * 3.36 * surface) / kappa);
      const sigmaPhi = sigmaR * Math.min(1, kappa / (2 * Math.sqrt(omega2(r))));
      const sigmaZ = Math.min(0.5 * vc, Math.sqrt(Math.PI * surface * zd));
      // 非対称ドリフト: 速度分散のぶん平均回転速度は円運動より遅い
      const vPhi2 = vc2 + sigmaR * sigmaR * (1 - kappa2 / (4 * omega2(r)) - (2 * r) / rd);
      const vPhi = Math.sqrt(Math.max(0, vPhi2)) + rng.gaussian() * sigmaPhi;
      const vR = rng.gaussian() * sigmaR;
      const vZ = rng.gaussian() * sigmaZ;

      const c = Math.cos(phi);
      const s = Math.sin(phi);
      put(
        r * c,
        r * s,
        z,
        mass / counts.disk,
        vR * c - vPhi * s,
        vR * s + vPhi * c,
        vZ,
        Component.Disk,
      );
    }
  }
  if (bulge) spherical(bulge.mass, bulge.scale, halo.cutoff, counts.bulge, Component.Bulge);
  spherical(halo.mass, halo.scale, halo.cutoff, counts.halo, Component.Halo);
  return k - offset;
}

// ---- 軌道と配置 ----

/**
 * 質量 m1, m2 の 2 点が放物線軌道（ちょうど束縛の境目）で近づく初期配置。
 * 軌道面は xy 平面、角運動量は +z 向き。重心は原点に静止。
 * pericenter <= 0 なら x 軸上の正面衝突（銀河 2 が -x 側から +x 向きに突っ込む）。
 */
export function parabolicOrbit(m1: number, m2: number, pericenter: number, separation: number) {
  const m = m1 + m2;
  if (pericenter <= 0) {
    // 真正面からの衝突: x 軸に沿って放物線速度（脱出速度）で近づく
    const v = Math.sqrt((2 * m) / separation);
    return {
      pos1: [(m2 / m) * separation, 0, 0],
      vel1: [(-m2 / m) * v, 0, 0],
      pos2: [(-m1 / m) * separation, 0, 0],
      vel2: [(m1 / m) * v, 0, 0],
    };
  }
  const cosNu = Math.min(1, (2 * pericenter) / separation - 1);
  const nu = -Math.acos(cosNu); // 負: 近点に向かって近づいている
  const r = separation;
  const rel = [r * Math.cos(nu), r * Math.sin(nu), 0];
  const k = Math.sqrt(m / (2 * pericenter));
  const vr = k * Math.sin(nu);
  const vt = k * (1 + Math.cos(nu));
  const relV = [vr * Math.cos(nu) - vt * Math.sin(nu), vr * Math.sin(nu) + vt * Math.cos(nu), 0];
  return {
    pos1: rel.map((v) => (-m2 / m) * v),
    vel1: relV.map((v) => (-m2 / m) * v),
    pos2: rel.map((v) => (m1 / m) * v),
    vel2: relV.map((v) => (m1 / m) * v),
  };
}

/** 円盤の自転軸を傾ける: x 軸回りに inclination、続けて z 軸回りに argument（度） */
export function orientation(inclinationDeg: number, argumentDeg: number) {
  const i = (inclinationDeg * Math.PI) / 180;
  const w = (argumentDeg * Math.PI) / 180;
  const ci = Math.cos(i),
    si = Math.sin(i),
    cw = Math.cos(w),
    sw = Math.sin(w);
  return (x: number, y: number, z: number): [number, number, number] => {
    const y1 = y * ci - z * si;
    const z1 = y * si + z * ci;
    return [x * cw - y1 * sw, x * sw + y1 * cw, z1];
  };
}

export interface GalaxyPlacement {
  spec: GalaxySpec;
  inclination: number;
  argument: number;
  /** 銀河群（group）の場合の初期位置（kpc）。重心は自動で原点に合わせる */
  position?: [number, number, number];
}

/** 1 シナリオに登場できる銀河の最大数 */
export const MAX_GALAXIES = 4;

export type Orbit =
  /** 2 つの銀河の放物線軌道（pericenter 0 なら正面衝突） */
  | { type: 'pair'; pericenter: number; separation: number }
  /**
   * 3〜4 個の銀河群。各銀河を点質量とみなし、運動エネルギーを
   * 位置エネルギーの virial 倍にそろえる（0.5 未満ならゆっくり収縮して合体に向かう）。
   * spin は速度の向き: 1 なら z 軸まわりの回転、0 なら中心へまっすぐ落下
   */
  | { type: 'group'; virial: number; spin: number };

export interface Scenario {
  id: string;
  title: Text;
  description: Text;
  galaxies: GalaxyPlacement[];
  orbit: Orbit;
  /** カメラの初期の仰角（度） */
  cameraPitch: number;
  cameraDistance: number;
}

/**
 * 銀河群の初期速度。masses と positions（重心は原点に移す）から、
 * 全体の運動量を 0、運動エネルギーを |位置エネルギー| × virial にした位置と速度を返す。
 */
export function groupOrbits(
  masses: readonly number[],
  positions: readonly (readonly number[])[],
  virial: number,
  spin: number,
): { pos: number[][]; vel: number[][] } {
  const total = masses.reduce((a, b) => a + b, 0);
  const com = [0, 1, 2].map(
    (d) => masses.reduce((s, m, i) => s + m * positions[i]![d]!, 0) / total,
  );
  const pos = positions.map((p) => p.map((v, d) => v - com[d]!));

  let potential = 0;
  for (let i = 0; i < masses.length; i++) {
    for (let j = i + 1; j < masses.length; j++) {
      const r = Math.hypot(...pos[i]!.map((v, d) => v - pos[j]![d]!));
      potential -= (masses[i]! * masses[j]!) / r;
    }
  }

  // 向き: z 軸まわりの接線方向と中心向きを spin で混ぜる。大きさは √(M/r) に比例
  let vel = pos.map((p) => {
    const r = Math.hypot(...p) || 1;
    const rxy = Math.hypot(p[0]!, p[1]!);
    const tangent = rxy > 1e-6 ? [-p[1]! / rxy, p[0]! / rxy, 0] : [1, 0, 0];
    const inward = p.map((v) => -v / r);
    const dir = tangent.map((t, d) => spin * t + (1 - spin) * inward[d]!);
    const len = Math.hypot(...dir) || 1;
    const speed = Math.sqrt(total / r);
    return dir.map((v) => (v / len) * speed);
  });

  // 全体の運動量を 0 にしてから、運動エネルギーを目標値に合わせる
  const mean = [0, 1, 2].map((d) => masses.reduce((s, m, i) => s + m * vel[i]![d]!, 0) / total);
  vel = vel.map((v) => v.map((x, d) => x - mean[d]!));
  const kinetic = masses.reduce((s, m, i) => s + 0.5 * m * Math.hypot(...vel[i]!) ** 2, 0);
  const scale = kinetic > 0 ? Math.sqrt((virial * -potential) / kinetic) : 0;
  vel = vel.map((v) => v.map((x) => x * scale));
  return { pos, vel };
}

const companion = (q: number, noDisk = false): GalaxySpec => {
  const s = scaleGalaxy(MILKY_WAY_LIKE, q);
  return noDisk
    ? { ...s, disk: null, bulge: s.bulge && { ...s.bulge, mass: s.bulge.mass * 3 } }
    : s;
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'antennae',
    title: { ja: 'アンテナ', en: 'Antennae' },
    description: {
      ja: '同じ重さの渦巻銀河が順行ですれ違い、長い潮汐の尾を 2 本引いて合体する',
      en: 'Two equal spirals pass each other prograde, fling out two long tidal tails, and merge',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 20, argument: 0 },
      { spec: MILKY_WAY_LIKE, inclination: 60, argument: 30 },
    ],
    orbit: { type: 'pair', pericenter: 8, separation: 70 },
    cameraPitch: 55,
    cameraDistance: 130,
  },
  {
    id: 'mice',
    title: { ja: 'ねずみ', en: 'Mice' },
    description: {
      ja: '片方は順行、片方は大きく傾いた出会い。尾の長さがはっきり違う',
      en: 'One disk prograde, the other steeply tilted — their tails grow to very different lengths',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 10, argument: 0 },
      { spec: MILKY_WAY_LIKE, inclination: 110, argument: 60 },
    ],
    orbit: { type: 'pair', pericenter: 10, separation: 70 },
    cameraPitch: 40,
    cameraDistance: 130,
  },
  {
    id: 'whirlpool',
    title: { ja: '子持ち銀河', en: 'Whirlpool' },
    description: {
      ja: '小さな伴銀河の接近で、主銀河に大きな 2 本の渦巻腕が立ち上がる（M51 風）',
      en: 'A small companion swings by and raises two grand spiral arms in the main galaxy (like M51)',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 0, argument: 0 },
      { spec: companion(0.3), inclination: 30, argument: 0 },
    ],
    orbit: { type: 'pair', pericenter: 14, separation: 55 },
    cameraPitch: 80,
    cameraDistance: 90,
  },
  {
    id: 'cartwheel',
    title: { ja: '車輪', en: 'Cartwheel' },
    description: {
      ja: '小さな銀河が円盤の中心を垂直に突き抜け、波紋のようなリングが広がる',
      en: 'A small galaxy plunges straight through the disk center, sending out a ripple-like ring',
    },
    galaxies: [
      // 自転軸を x 軸（衝突の向き）から少しだけ傾け、リングを少し非対称にする
      { spec: MILKY_WAY_LIKE, inclination: 90, argument: 80 },
      { spec: companion(0.35, true), inclination: 0, argument: 0 },
    ],
    orbit: { type: 'pair', pericenter: 0, separation: 45 },
    cameraPitch: 35,
    cameraDistance: 90,
  },
  {
    id: 'triple',
    title: { ja: '三つ巴', en: 'Triple' },
    description: {
      ja: '同じ重さの 3 つの渦巻銀河が回りながら引き寄せ合い、次々にぶつかって 1 つになる',
      en: 'Three equal spirals swirl inward, collide one after another, and end as a single galaxy',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 20, argument: 0, position: [48, 0, 4] },
      { spec: MILKY_WAY_LIKE, inclination: 75, argument: 40, position: [-26, 44, -6] },
      { spec: MILKY_WAY_LIKE, inclination: 130, argument: 110, position: [-22, -40, 3] },
    ],
    orbit: { type: 'group', virial: 0.3, spin: 0.6 },
    cameraPitch: 55,
    cameraDistance: 170,
  },
  {
    id: 'satellites',
    title: { ja: '2 つの伴銀河', en: 'Two satellites' },
    description: {
      ja: '大きな銀河のまわりを大小 2 つの伴銀河が回り、少しずつ引き裂かれて呑み込まれていく',
      en: 'Two small satellites orbit a large spiral and are slowly torn apart and swallowed',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 0, argument: 0, position: [0, 0, 0] },
      { spec: companion(0.2), inclination: 40, argument: 0, position: [38, 0, 6] },
      { spec: companion(0.12), inclination: 100, argument: 60, position: [-20, -45, -12] },
    ],
    orbit: { type: 'group', virial: 0.4, spin: 0.9 },
    cameraPitch: 60,
    cameraDistance: 140,
  },
  {
    id: 'compact-group',
    title: { ja: 'コンパクト銀河群', en: 'Compact group' },
    description: {
      ja: '大きさも向きもばらばらな 4 つの銀河が狭い空間に集まり、尾を絡ませながら巨大な楕円銀河へ',
      en: 'Four galaxies of mixed sizes and tilts crowd together, tangle their tails, and build a giant elliptical',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 30, argument: 0, position: [-18, -8, 4] },
      { spec: companion(0.6), inclination: 110, argument: 50, position: [34, -18, -10] },
      { spec: companion(0.4), inclination: 60, argument: 150, position: [6, 36, 12] },
      { spec: companion(0.25), inclination: 160, argument: 250, position: [-14, 10, -34] },
    ],
    orbit: { type: 'group', virial: 0.35, spin: 0.4 },
    cameraPitch: 45,
    cameraDistance: 160,
  },
  {
    id: 'pinwheel',
    title: { ja: '風車', en: 'Pinwheel' },
    description: {
      ja: '同じ重さの 4 つの渦巻銀河が風車のように回りながら落ち込み、中心で一斉にぶつかる',
      en: 'Four equal spirals swirl in like a pinwheel and crash together at the center',
    },
    galaxies: [
      { spec: MILKY_WAY_LIKE, inclination: 15, argument: 0, position: [44, 0, 0] },
      { spec: MILKY_WAY_LIKE, inclination: 50, argument: 90, position: [0, 48, 5] },
      { spec: MILKY_WAY_LIKE, inclination: 25, argument: 180, position: [-42, 0, -4] },
      { spec: MILKY_WAY_LIKE, inclination: 70, argument: 270, position: [0, -46, 2] },
    ],
    orbit: { type: 'group', virial: 0.25, spin: 0.55 },
    cameraPitch: 70,
    cameraDistance: 170,
  },
];

/** 各銀河の重心の位置と速度 */
export function galaxyOrbits(scenario: Scenario): { pos: number[][]; vel: number[][] } {
  const masses = scenario.galaxies.map((g) => totalMass(g.spec));
  const { orbit } = scenario;
  if (orbit.type === 'pair') {
    if (masses.length !== 2) throw new Error(`${scenario.id}: pair orbit needs 2 galaxies`);
    const o = parabolicOrbit(masses[0]!, masses[1]!, orbit.pericenter, orbit.separation);
    return { pos: [o.pos1, o.pos2], vel: [o.vel1, o.vel2] };
  }
  const positions = scenario.galaxies.map((g) => g.position ?? [0, 0, 0]);
  return groupOrbits(masses, positions, orbit.virial, orbit.spin);
}

/**
 * シナリオの全粒子を生成する。粒子の質量は「星（円盤・バルジ）」と「ハロー」の 2 種類にそろえ、
 * 全体の haloShare をハロー粒子に割り当てる。
 */
export function buildScenario(
  scenario: Scenario,
  n: number,
  eps: number,
  rng: Rng,
  haloShare = 0.4,
): Particles {
  const specs = scenario.galaxies.map((g) => g.spec);
  const starMass = (s: GalaxySpec) => (s.disk?.mass ?? 0) + (s.bulge?.mass ?? 0);
  const stars = specs.reduce((a, s) => a + starMass(s), 0);
  const halos = specs.reduce((a, s) => a + s.halo.mass, 0);
  const nHalo = Math.round(n * haloShare);
  const nStar = n - nHalo;

  const counts = specs.map((s) => ({
    disk: Math.round((nStar * (s.disk?.mass ?? 0)) / stars),
    bulge: Math.round((nStar * (s.bulge?.mass ?? 0)) / stars),
    halo: Math.round((nHalo * s.halo.mass) / halos),
  }));
  // 丸め誤差は最初の銀河のハローで吸収して、合計をちょうど n にする
  const assigned = counts.reduce((a, c) => a + c.disk + c.bulge + c.halo, 0);
  counts[0]!.halo += n - assigned;

  const out: Particles = { pos: new Float32Array(n * 4), vel: new Float32Array(n * 4), count: n };
  const orbits = galaxyOrbits(scenario);

  let offset = 0;
  scenario.galaxies.forEach((g, gi) => {
    const p = orbits.pos[gi]!;
    const v = orbits.vel[gi]!;
    const start = offset;
    offset += sampleGalaxy(g.spec, counts[gi]!, gi, eps, rng, out, offset);
    const rotate = orientation(g.inclination, g.argument);
    recenter(out, start, offset);
    for (let i = start; i < offset; i++) {
      const o = i * 4;
      const [x, y, z] = rotate(out.pos[o]!, out.pos[o + 1]!, out.pos[o + 2]!);
      const [vx, vy, vz] = rotate(out.vel[o]!, out.vel[o + 1]!, out.vel[o + 2]!);
      out.pos[o] = x + p[0]!;
      out.pos[o + 1] = y + p[1]!;
      out.pos[o + 2] = z + p[2]!;
      out.vel[o] = vx + v[0]!;
      out.vel[o + 1] = vy + v[1]!;
      out.vel[o + 2] = vz + v[2]!;
    }
  });
  return out;
}

/** [start, end) の粒子の重心位置と重心速度を 0 にする */
export function recenter(p: Particles, start: number, end: number) {
  let m = 0;
  const c = [0, 0, 0, 0, 0, 0];
  for (let i = start; i < end; i++) {
    const o = i * 4;
    const w = p.pos[o + 3]!;
    m += w;
    for (let d = 0; d < 3; d++) {
      c[d]! += w * p.pos[o + d]!;
      c[d + 3]! += w * p.vel[o + d]!;
    }
  }
  if (m === 0) return;
  for (let i = start; i < end; i++) {
    const o = i * 4;
    for (let d = 0; d < 3; d++) {
      p.pos[o + d]! -= c[d]! / m;
      p.vel[o + d]! -= c[d + 3]! / m;
    }
  }
}
