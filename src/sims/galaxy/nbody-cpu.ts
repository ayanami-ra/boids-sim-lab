/**
 * CPU 版の直接総和 N 体計算。GPU 版（shaders.ts）と同じ式・同じ積分法で、
 * テストと WebGPU 非対応環境のフォールバックに使う。
 *
 * 積分法はリープフロッグ（速度を半ステップずらして持つ）:
 *   v(n+1/2) = v(n-1/2) + a(x(n)) dt
 *   x(n+1)   = x(n) + v(n+1/2) dt
 * シンプレクティックなので長時間回してもエネルギーが系統的にずれない。
 */
import type { Particles } from './model';

/** 全粒子の加速度とポテンシャルを O(N²) で計算する（プラマー軟化） */
export function computeForces(p: Particles, eps: number, acc: Float32Array): void {
  const { pos, count: n } = p;
  const eps2 = eps * eps;
  for (let i = 0; i < n; i++) {
    const xi = pos[i * 4]!,
      yi = pos[i * 4 + 1]!,
      zi = pos[i * 4 + 2]!;
    let ax = 0,
      ay = 0,
      az = 0,
      phi = 0;
    for (let j = 0; j < n; j++) {
      const dx = pos[j * 4]! - xi,
        dy = pos[j * 4 + 1]! - yi,
        dz = pos[j * 4 + 2]! - zi;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
      const m = pos[j * 4 + 3]!;
      const f = m * inv * inv * inv;
      ax += dx * f;
      ay += dy * f;
      az += dz * f;
      phi -= m * inv;
    }
    // 自分自身との「相互作用」（距離 0 → -m/eps）を取り除く
    phi += pos[i * 4 + 3]! / eps;
    acc[i * 4] = ax;
    acc[i * 4 + 1] = ay;
    acc[i * 4 + 2] = az;
    acc[i * 4 + 3] = phi;
  }
}

/**
 * 速度に kick * dt ぶんの加速度を足し、位置を drift * dt ぶん進める。
 * 通常のステップは kick = drift = 1。開始時に一度だけ kick = 0.5, drift = 0 で呼んで
 * 速度を半ステップずらす。
 */
export function leapfrogStep(
  p: Particles,
  eps: number,
  dt: number,
  acc: Float32Array,
  kick = 1,
  drift = 1,
): void {
  computeForces(p, eps, acc);
  const { pos, vel, count: n } = p;
  for (let i = 0; i < n; i++) {
    for (let d = 0; d < 3; d++) {
      const o = i * 4 + d;
      vel[o] = vel[o]! + acc[o]! * dt * kick;
      pos[o] = pos[o]! + vel[o]! * dt * drift;
    }
  }
}

/**
 * 全エネルギー。acc は直前の leapfrogStep で計算された x(n) での値、
 * vel は v(n+1/2)、pos は x(n+1) を持っている前提で、
 * v(n) = v(n+1/2) - a(n) dt/2 に戻してから運動エネルギーを計算する。
 */
export function energyFromStep(
  vel: Float32Array,
  acc: Float32Array,
  masses: Float32Array,
  dt: number,
): { kinetic: number; potential: number; total: number } {
  let kinetic = 0;
  let potential = 0;
  for (let i = 0; i < masses.length; i++) {
    const m = masses[i]!;
    let v2 = 0;
    for (let d = 0; d < 3; d++) {
      const v = vel[i * 4 + d]! - acc[i * 4 + d]! * dt * 0.5;
      v2 += v * v;
    }
    kinetic += 0.5 * m * v2;
    potential += 0.5 * m * acc[i * 4 + 3]!;
  }
  return { kinetic, potential, total: kinetic + potential };
}
