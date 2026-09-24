/**
 * WGSL シェーダ。
 * - STEP: 直接総和 N 体計算 + リープフロッグ 1 ステップ（nbody-cpu.ts の leapfrogStep と同じ式）
 * - DRAW: 粒子をガウス型の光る点として HDR テクスチャに加算合成
 * - TONEMAP: HDR → 画面
 */

export const WORKGROUP_SIZE = 128;

/**
 * 1 スレッド = 1 粒子。全粒子を WORKGROUP_SIZE 個ずつの「タイル」に分けて
 * ワークグループ共有メモリに読み込み、タイル内の全粒子との重力を足し合わせる。
 * グローバルメモリの読み出しが 1/WORKGROUP_SIZE になり、演算器を休ませずに回せる。
 */
export const STEP_WGSL = /* wgsl */ `
struct Params {
  n: u32,
  dt: f32,
  eps2: f32,
  kick: f32,
  drift: f32,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> posIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> posOut: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> vel: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> accPhi: array<vec4f>;

const WG = ${WORKGROUP_SIZE}u;
var<workgroup> tile: array<vec4f, WG>;

@compute @workgroup_size(WG)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let i = gid.x;
  let valid = i < P.n;
  var p = vec4f(0.0);
  if (valid) { p = posIn[i]; }

  var a = vec3f(0.0);
  var phi = 0.0;
  for (var base = 0u; base < P.n; base += WG) {
    let j = base + lid;
    // 範囲外は質量 0 の粒子として読み込む（分岐なしで内側ループを回すため）
    tile[lid] = select(vec4f(0.0), posIn[min(j, P.n - 1u)], j < P.n);
    workgroupBarrier();
    for (var k = 0u; k < WG; k += 4u) {
      let q0 = tile[k];
      let q1 = tile[k + 1u];
      let q2 = tile[k + 2u];
      let q3 = tile[k + 3u];
      let d0 = q0.xyz - p.xyz;
      let d1 = q1.xyz - p.xyz;
      let d2 = q2.xyz - p.xyz;
      let d3 = q3.xyz - p.xyz;
      let inv = inverseSqrt(vec4f(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)) + P.eps2);
      let m = vec4f(q0.w, q1.w, q2.w, q3.w) * inv;
      let f = m * inv * inv;
      a += d0 * f.x + d1 * f.y + d2 * f.z + d3 * f.w;
      phi -= m.x + m.y + m.z + m.w;
    }
    workgroupBarrier();
  }
  if (!valid) { return; }

  // 自分自身との項（距離 0 → -m/eps）を取り除く
  phi += p.w * inverseSqrt(P.eps2);
  let v = vel[i];
  let nv = v.xyz + a * (P.dt * P.kick);
  vel[i] = vec4f(nv, v.w);
  posOut[i] = vec4f(p.xyz + nv * (P.dt * P.drift), p.w);
  accPhi[i] = vec4f(a, phi);
}
`;

export const DRAW_WGSL = /* wgsl */ `
struct Camera {
  viewProj: mat4x4f,
  viewport: vec2f,
  /** 焦点距離（ピクセル） */
  focalPx: f32,
  /** 星 1 個のワールド半径 */
  starRadius: f32,
  brightness: f32,
  showDarkMatter: f32,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> C: Camera;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

fn hash(x: u32) -> f32 {
  var h = x * 747796405u + 2891336453u;
  h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
  return f32((h >> 22u) ^ h) / 4294967295.0;
}

const CORNERS = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = pos[ii];
  let kind = u32(vel[ii].w + 0.5);
  let galaxy = kind / 3u;
  let component = kind % 3u;
  let r = hash(ii);

  var color: vec3f;
  var radius = C.starRadius;
  var intensity = 1.0;
  if (component == 0u) {
    // 円盤: 若い星の青白い光。ところどころに明るい星形成領域
    color = mix(vec3f(0.55, 0.7, 1.0), vec3f(1.0, 0.95, 0.9), r * 0.6);
    // 銀河ごとにほんの少し色味を変えて、混ざり合っても見分けがつくようにする
    if (galaxy == 1u) { color = mix(color, vec3f(0.75, 0.85, 1.0), 0.5); }
    if (galaxy == 2u) { color = mix(color, vec3f(1.0, 0.9, 0.75), 0.35); }
    if (galaxy == 3u) { color = mix(color, vec3f(0.7, 1.0, 0.95), 0.35); }
    if (r > 0.97) { color = vec3f(1.0, 0.55, 0.75); intensity = 2.0; }
  } else if (component == 1u) {
    // バルジ: 年老いた星の黄色っぽい光
    color = mix(vec3f(1.0, 0.8, 0.5), vec3f(1.0, 0.65, 0.35), r);
    intensity = 1.2;
  } else {
    // ダークマター: 普段は見えない
    color = vec3f(0.45, 0.3, 1.0);
    intensity = 0.25 * C.showDarkMatter;
    radius *= 2.5;
  }

  let clip = C.viewProj * vec4f(p.xyz, 1.0);
  // 遠くの星は小さく。ただし 2 ピクセルより小さくはせず、そのぶん暗くして明るさの総量を保つ。
  // カメラのすぐ近くの星が巨大な玉にならないよう、6 ピクセルで頭打ちにする
  let worldPx = radius * C.focalPx / max(clip.w, 1e-3);
  let px = clamp(worldPx, 2.0, 6.0);
  intensity *= min(1.0, (worldPx * worldPx) / (px * px)) * C.brightness;

  let corner = CORNERS[vi];
  o.clip = clip + vec4f(corner * px * 2.0 / C.viewport * clip.w, 0.0, 0.0);
  o.uv = corner;
  o.color = color * intensity;
  if (clip.w <= 0.0 || intensity <= 0.0) { o.clip = vec4f(2.0, 2.0, 2.0, 1.0); }
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  if (d2 > 1.0) { discard; }
  let g = exp(-4.0 * d2);
  return vec4f(in.color * g, 1.0);
}
`;

export const TONEMAP_WGSL = /* wgsl */ `
@group(0) @binding(0) var hdr: texture_2d<f32>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // 画面全体を覆う 1 枚の三角形
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.clip = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(xy.x, 1.0 - xy.y);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(hdr));
  let c = textureLoad(hdr, vec2i(in.uv * size), 0).rgb;
  // 露出トーンマップ: 明るいところは飽和せずに白へ寄っていく
  let mapped = vec3f(1.0) - exp(-c);
  return vec4f(pow(mapped, vec3f(1.0 / 1.6)) + vec3f(0.004, 0.006, 0.014), 1.0);
}
`;
