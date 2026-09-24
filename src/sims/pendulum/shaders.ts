/**
 * 三重振り子の WGSL。
 * - STEP: 1 スレッド = 1 本の振り子。physics.ts と同じ運動方程式を RK4 で積分する
 * - LINES: 振り子を線で描き、HDR テクスチャに加算合成
 * - FADE: 前のフレームを少し暗くして、残像（軌跡）を残す
 * - MAP: 一回転までの時間のマップ
 * - TONEMAP: HDR → 画面
 */

export const WORKGROUP = 64;

export const STEP_WGSL = /* wgsl */ `
struct Params {
  n: u32,
  substeps: u32,
  dt: f32,
  g: f32,
  time: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
/** θ1, θ2, θ3, 未使用 */
@group(0) @binding(1) var<storage, read_write> angles: array<vec4f>;
/** ω1, ω2, ω3, 一回転した時刻（まだなら 0） */
@group(0) @binding(2) var<storage, read_write> vels: array<vec4f>;

const PI = 3.14159265;

/** μ_ij = 3 − max(i, j)（i, j 番目の棒の下側にある質量の数） */
fn accel(t: vec3f, w: vec3f) -> vec3f {
  let w2 = w * w;
  let c01 = cos(t.x - t.y);
  let c02 = cos(t.x - t.z);
  let c12 = cos(t.y - t.z);
  let s01 = sin(t.x - t.y);
  let s02 = sin(t.x - t.z);
  let s12 = sin(t.y - t.z);
  // M a = f
  let a = 3.0;       let b = 2.0 * c01; let c = c02;
  let d = 2.0 * c01; let e = 2.0;       let f = c12;
  let g = c02;       let h = c12;       let i = 1.0;
  let p = -2.0 * s01 * w2.y - s02 * w2.z - 3.0 * P.g * sin(t.x);
  let q = 2.0 * s01 * w2.x - s12 * w2.z - 2.0 * P.g * sin(t.y);
  let r = s02 * w2.x + s12 * w2.y - P.g * sin(t.z);
  let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  let x = (p * (e * i - f * h) - b * (q * i - f * r) + c * (q * h - e * r)) / det;
  let y = (a * (q * i - f * r) - p * (d * i - f * g) + c * (d * r - q * g)) / det;
  let z = (a * (e * r - q * h) - b * (d * r - q * g) + p * (d * h - e * g)) / det;
  return vec3f(x, y, z);
}

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= P.n) { return; }
  var t = angles[idx].xyz;
  var w = vels[idx].xyz;
  var flip = vels[idx].w;
  var time = P.time;
  let dt = P.dt;
  for (var s = 0u; s < P.substeps; s++) {
    let k1t = w;
    let k1w = accel(t, w);
    let k2t = w + k1w * (dt * 0.5);
    let k2w = accel(t + k1t * (dt * 0.5), k2t);
    let k3t = w + k2w * (dt * 0.5);
    let k3w = accel(t + k2t * (dt * 0.5), k3t);
    let k4t = w + k3w * dt;
    let k4w = accel(t + k3t * dt, k4t);
    t += (k1t + 2.0 * k2t + 2.0 * k3t + k4t) * (dt / 6.0);
    w += (k1w + 2.0 * k2w + 2.0 * k3w + k4w) * (dt / 6.0);
    time += dt;
    if (flip == 0.0 && any(abs(t) > vec3f(PI))) { flip = time; }
  }
  angles[idx] = vec4f(t, 0.0);
  vels[idx] = vec4f(w, flip);
}
`;

export const LINES_WGSL = /* wgsl */ `
struct View {
  /** 支点の位置（ピクセル）と 1 m のピクセル数 */
  pivot: vec2f,
  scale: f32,
  n: f32,
  viewport: vec2f,
  intensity: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> angles: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) color: vec3f,
}

/** 振り子の番号（初期値のずれ）に沿って シアン → 紫 → 橙 と色を変える */
fn tint(u: f32) -> vec3f {
  let a = vec3f(0.25, 0.85, 1.0);
  let b = vec3f(0.75, 0.35, 1.0);
  let c = vec3f(1.0, 0.6, 0.2);
  return select(mix(b, c, (u - 0.5) * 2.0), mix(a, b, u * 2.0), u < 0.5);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let t = angles[ii].xyz;
  // 線分 k（0〜2）の始点（end = 0）か終点（end = 1）
  let k = vi / 2u;
  let joint = k + (vi % 2u);
  var p = vec2f(0.0);
  if (joint >= 1u) { p += vec2f(sin(t.x), cos(t.x)); }
  if (joint >= 2u) { p += vec2f(sin(t.y), cos(t.y)); }
  if (joint >= 3u) { p += vec2f(sin(t.z), cos(t.z)); }
  let px = V.pivot + p * V.scale;
  var o: VOut;
  o.clip = vec4f(px.x / V.viewport.x * 2.0 - 1.0, 1.0 - px.y / V.viewport.y * 2.0, 0.0, 1.0);
  // 先の棒ほど明るく（いちばん動きの激しい所を目立たせる）
  let weight = 0.12 + 0.44 * f32(k);
  o.color = tint(f32(ii) / max(1.0, V.n - 1.0)) * V.intensity * weight;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  return vec4f(in.color, 1.0);
}
`;

/** 画面全体を覆う三角形（FADE・MAP・TONEMAP で共通） */
const FULLSCREEN = /* wgsl */ `
struct Full {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Full {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: Full;
  o.clip = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}
`;

export const FADE_WGSL = /* wgsl */ `
${FULLSCREEN}
@fragment
fn fs() -> @location(0) vec4f {
  // 合成は dst × 定数（setBlendConstant）なので、出力の値は使われない
  return vec4f(0.0);
}
`;

export const MAP_WGSL = /* wgsl */ `
${FULLSCREEN}
struct MapView {
  /** マップの左上（ピクセル）と一辺の長さ */
  origin: vec2f,
  size: f32,
  res: f32,
  viewport: vec2f,
  maxTime: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> M: MapView;
@group(0) @binding(1) var<storage, read> vels: array<vec4f>;

/** 青の単色の段階色（データ可視化の既定パレットの 700 → 100）。明るいほど早く一回転 */
fn ramp(u: f32) -> vec3f {
  let dark = vec3f(0.051, 0.212, 0.420);
  let mid = vec3f(0.165, 0.471, 0.839);
  let light = vec3f(0.804, 0.886, 0.984);
  return select(mix(mid, light, (u - 0.5) * 2.0), mix(dark, mid, u * 2.0), u < 0.5);
}

@fragment
fn fs(in: Full) -> @location(0) vec4f {
  let px = in.uv * M.viewport;
  let local = (px - M.origin) / M.size;
  if (any(local < vec2f(0.0)) || any(local >= vec2f(1.0))) { discard; }
  let cell = vec2u(local * M.res);
  let flip = vels[cell.y * u32(M.res) + cell.x].w;
  if (flip == 0.0) { return vec4f(0.02, 0.025, 0.045, 1.0); }
  // 対数の目盛り: 0.3 秒以内に一回転なら最も明るく、maxTime 秒なら最も暗い
  let u = clamp(1.0 - log(flip / 0.3) / log(M.maxTime / 0.3), 0.0, 1.0);
  return vec4f(ramp(u), 1.0);
}
`;

export const TONEMAP_WGSL = /* wgsl */ `
${FULLSCREEN}
@group(0) @binding(0) var hdr: texture_2d<f32>;

@fragment
fn fs(in: Full) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(hdr));
  let c = textureLoad(hdr, vec2i(in.uv * size), 0).rgb;
  let mapped = vec3f(1.0) - exp(-c);
  return vec4f(pow(mapped, vec3f(1.0 / 1.5)) + vec3f(0.01, 0.012, 0.024), 1.0);
}
`;
