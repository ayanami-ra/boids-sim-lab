/**
 * 林分の描画。斜め上から見た遠近法で、奥の木から手前の木へ重ねて描く。
 * 遠くの木ほど小さく、空の色にかすむ（空気遠近法）。
 *
 * 描画を速くするため、奥行きをいくつかの帯に分け、帯ごと・種ごとに
 * 樹冠の丸をまとめて 1 回で塗る（数百本の木 × 十数個の丸を 1 個ずつ塗らない）。
 */
import { SPECIES, crownRadius, height, type Snag, type Stand, type TreeState } from './stand';

export interface View {
  /** 画面の幅・地面の手前の端の y（CSS px） */
  width: number;
  groundFront: number;
  /** 1 m あたりのピクセル（手前） */
  ppm: number;
  /** 林分の大きさ m */
  standWidth: number;
  standDepth: number;
  /** 奥行き方向の遠近の強さ（m） */
  perspective: number;
  /** 地面の帯の高さ（手前の端から奥の端まで、px） */
  floorHeight: number;
}

export const scaleAt = (v: View, z: number) => 1 / (1 + z / v.perspective);

export function project(v: View, x: number, z: number): [number, number, number] {
  const s = scaleAt(v, z);
  const far = scaleAt(v, v.standDepth);
  const t = (1 - s) / (1 - far);
  return [v.width / 2 + (x - v.standWidth / 2) * v.ppm * s, v.groundFront - t * v.floorHeight, s];
}

/** 画面の y から地面の奥行き z を逆算する（地面の帯の外なら null） */
export function unprojectZ(v: View, y: number): number | null {
  const t = (v.groundFront - y) / v.floorHeight;
  if (t < 0 || t > 1) return null;
  const far = scaleAt(v, v.standDepth);
  const s = 1 - t * (1 - far);
  return v.perspective * (1 / s - 1);
}

export interface Season {
  /** 0 春, 1 夏, 2 秋, 3 冬（小数で季節の途中） */
  phase: number;
  /** 季節を表示するか（速く進めているときは夏のまま） */
  visible: boolean;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)) as RGB;
const mix = (a: RGB, b: RGB, f: number): RGB =>
  [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * f) as RGB;
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
const shade = (c: RGB, f: number): RGB => c.map((v) => v * f) as RGB;

const LEAF_SUMMER: Record<string, RGB> = {
  birch: hex('#8fbf4a'),
  pine: hex('#2f5a3a'),
  oak: hex('#3e7a2e'),
  beech: hex('#5a9a3a'),
};
const LEAF_SPRING: Record<string, RGB> = {
  birch: hex('#b8e070'),
  pine: hex('#3d6e45'),
  oak: hex('#8cc860'),
  beech: hex('#a6dc6a'),
};
const LEAF_AUTUMN: Record<string, RGB> = {
  birch: hex('#e8c547'),
  pine: hex('#2f5a3a'),
  oak: hex('#a8612a'),
  beech: hex('#c8702a'),
};
const BARK: Record<string, RGB> = {
  birch: hex('#e6e2d6'),
  pine: hex('#8a4b2e'),
  oak: hex('#4a3a2c'),
  beech: hex('#8c8c86'),
};

export interface Palette {
  skyTop: RGB;
  skyBottom: RGB;
  haze: RGB;
  floorShade: RGB;
  floorSun: RGB;
}

/** 季節ごとの空と林床の色 */
export function palette(season: Season): Palette {
  const summer: Palette = {
    skyTop: hex('#5f9fe0'),
    skyBottom: hex('#d6e9f7'),
    haze: hex('#b9d3e6'),
    floorShade: hex('#23361f'),
    floorSun: hex('#9cc25a'),
  };
  if (!season.visible) return summer;
  const table: Palette[] = [
    { ...summer, skyTop: hex('#79b4ec'), floorSun: hex('#b4d86c') },
    summer,
    {
      ...summer,
      skyTop: hex('#6d93c4'),
      skyBottom: hex('#f2dcc0'),
      haze: hex('#d9c6b0'),
      floorSun: hex('#c9a25a'),
      floorShade: hex('#3a2e1e'),
    },
    {
      ...summer,
      skyTop: hex('#9aa8b8'),
      skyBottom: hex('#e6ebf0'),
      haze: hex('#d2d9e0'),
      floorSun: hex('#eef2f5'),
      floorShade: hex('#b8c2cc'),
    },
  ];
  const i = Math.floor(season.phase) % 4;
  const f = smoothstep(Math.max(0, (season.phase - Math.floor(season.phase) - 0.75) / 0.25));
  const a = table[i]!;
  const b = table[(i + 1) % 4]!;
  return {
    skyTop: mix(a.skyTop, b.skyTop, f),
    skyBottom: mix(a.skyBottom, b.skyBottom, f),
    haze: mix(a.haze, b.haze, f),
    floorShade: mix(a.floorShade, b.floorShade, f),
    floorSun: mix(a.floorSun, b.floorSun, f),
  };
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 季節に応じた葉の色と量（0 なら落葉して枝だけ） */
function foliage(
  speciesId: string,
  evergreen: boolean,
  season: Season,
): { color: RGB; amount: number } {
  const summer = LEAF_SUMMER[speciesId]!;
  if (!season.visible || evergreen) return { color: summer, amount: 1 };
  const p = season.phase;
  if (p < 0.35) return { color: mix(LEAF_SPRING[speciesId]!, summer, 0), amount: p / 0.35 };
  if (p < 1) return { color: mix(LEAF_SPRING[speciesId]!, summer, (p - 0.35) / 0.65), amount: 1 };
  if (p < 2) return { color: summer, amount: 1 };
  if (p < 2.6) return { color: mix(summer, LEAF_AUTUMN[speciesId]!, (p - 2) / 0.6), amount: 1 };
  if (p < 3) return { color: LEAF_AUTUMN[speciesId]!, amount: 1 - (p - 2.6) / 0.4 };
  return { color: summer, amount: 0 };
}

/** 背景: 空、遠くの山並み、遠くの森 */
export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  v: View,
  pal: Palette,
  h: number,
  look: number[],
  time: number,
) {
  const [, farY] = project(v, 0, v.standDepth);
  const sky = ctx.createLinearGradient(0, 0, 0, farY);
  sky.addColorStop(0, css(pal.skyTop));
  sky.addColorStop(1, css(pal.skyBottom));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, v.width, h);

  const ridge = (baseY: number, amp: number, color: RGB, seed: number) => {
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= v.width; x += 8) {
      const u = x / v.width;
      const y =
        baseY -
        amp *
          (0.55 +
            0.3 * Math.sin(u * 5.1 + seed) +
            0.15 * Math.sin(u * 13.7 + seed * 2) +
            0.08 * Math.sin(u * 31 + seed * 3));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(v.width, h);
    ctx.fill();
  };
  // ゆっくり流れる雲
  for (let i = 0; i < 4; i++) {
    const cx = ((look[0]! * 97 + i * 0.29 * v.width + time * (6 + i * 2)) % (v.width + 400)) - 200;
    const cy = farY * (0.12 + 0.13 * ((i * 0.37 + look[1]!) % 1));
    const r = 60 + 30 * i;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(2.4, 0.6);
    ctx.translate(-cx, -cy);
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  }
  ridge(farY - 20, 90, mix(pal.haze, pal.skyTop, 0.25), look[0]!);
  ridge(farY + 4, 45, mix(pal.haze, pal.floorShade, 0.35), look[1]!);
}

/** 林床の明るさを 1 m = 1 px の小さな画像にしておき、行ごとに引き伸ばして描く */
let floorImage: HTMLCanvasElement | null = null;

/** 林床: 1 m 格子の明るさで、木漏れ日の当たる所と日陰を塗り分ける */
export function drawFloor(
  ctx: CanvasRenderingContext2D,
  v: View,
  stand: Stand,
  pal: Palette,
  burn: number,
) {
  const { gw, gd } = stand;
  floorImage ??= document.createElement('canvas');
  if (floorImage.width !== gw || floorImage.height !== gd) {
    floorImage.width = gw;
    floorImage.height = gd;
  }
  const fctx = floorImage.getContext('2d')!;
  const img = fctx.createImageData(gw, gd);
  for (let i = 0; i < gw * gd; i++) {
    let c = mix(pal.floorShade, pal.floorSun, Math.sqrt(stand.floorLight[i]!));
    if (burn > 0) c = mix(c, [40, 32, 28], burn);
    img.data[i * 4] = c[0];
    img.data[i * 4 + 1] = c[1];
    img.data[i * 4 + 2] = c[2];
    img.data[i * 4 + 3] = 255;
  }
  fctx.putImageData(img, 0, 0);

  // 林床の台形で切り抜き、その中に行ごとに引き伸ばして描く（端がギザギザにならない）
  const corners = [project(v, 0, gd), project(v, gw, gd), project(v, gw, 0), project(v, 0, 0)];
  ctx.save();
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  for (let gz = gd - 1; gz >= 0; gz--) {
    const [, y0] = project(v, 0, gz + 1);
    const [xa, y1] = project(v, 0, gz);
    const [xb] = project(v, gw, gz);
    ctx.drawImage(floorImage, 0, gz, gw, 1, xa, y0, xb - xa, y1 - y0 + 1);
  }
  ctx.restore();
  // 手前の土の断面
  ctx.fillStyle = css(shade(pal.floorShade, 0.6));
  ctx.fillRect(0, v.groundFront, v.width, 400);
}

interface Blob {
  dx: number;
  dy: number;
  r: number;
}

const blobCache = new Map<number, Blob[]>();
const MAX_BLOBS = 30;

/** 木ごとに決まった樹冠の丸の並び（樹冠の中心を原点、半径 1 の単位で） */
function blobsFor(t: TreeState, speciesId: string): Blob[] {
  const cached = blobCache.get(t.id);
  if (cached) return cached;
  let seed = Math.floor(t.look * 1e9) >>> 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // 大きな樹冠ほど多くの小さな葉群で描くので、最大数ぶん作っておき先頭から使う
  const blobs: Blob[] = [];
  const spread = speciesId === 'oak' ? 0.85 : speciesId === 'birch' ? 0.7 : 0.78;
  for (let i = 0; i < MAX_BLOBS; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * spread;
    blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: 0.8 + rand() * 0.4 });
  }
  if (blobCache.size > 5000) blobCache.clear();
  blobCache.set(t.id, blobs);
  return blobs;
}

export function forgetTree(id: number) {
  blobCache.delete(id);
}

export interface TreeDraw {
  tree: TreeState;
  /** 画面上の当たり判定（タップで伐採するため） */
  box: [number, number, number, number];
}

/**
 * 木と枯れ木を奥から手前へ描く。yearFraction で 1 年の間の成長をなめらかにつなぐ。
 * 返り値は各木の画面上の範囲（タップの判定用）。
 */
export function drawTrees(
  ctx: CanvasRenderingContext2D,
  v: View,
  stand: Stand,
  pal: Palette,
  season: Season,
  yearFraction: number,
  time: number,
  wind: number,
  fallStart: WeakMap<Snag, number>,
): TreeDraw[] {
  const hits: TreeDraw[] = [];
  const items: { z: number; draw: () => void }[] = [];

  for (const t of stand.trees) {
    items.push({
      z: t.z,
      draw: () => hits.push(drawTree(ctx, v, t, pal, season, yearFraction, time, wind)),
    });
  }
  for (const s of stand.snags) {
    items.push({ z: s.z, draw: () => drawSnag(ctx, v, s, pal, time, fallStart) });
  }
  items.sort((a, b) => b.z - a.z);
  for (const item of items) item.draw();
  return hits;
}

function fog(v: View, z: number) {
  return 0.55 * (z / v.standDepth);
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  v: View,
  t: TreeState,
  pal: Palette,
  season: Season,
  yearFraction: number,
  time: number,
  wind: number,
): TreeDraw {
  const sp = SPECIES[t.species]!;
  const d = t.dPrev + (t.d - t.dPrev) * yearFraction;
  const [bx, by, s] = project(v, t.x, t.z);
  const px = v.ppm * s;
  const H = height(sp, d) * px;
  const R = crownRadius(sp, d) * px;
  const f = fog(v, t.z);
  const bark = mix(BARK[sp.id]!, pal.haze, f);
  const { color, amount } = foliage(sp.id, sp.evergreen, season);
  const leaf = mix(color, pal.haze, f);
  // 風: 背の高い木ほど梢が大きく揺れる
  const sway = (Math.sin(time * 1.3 + t.x * 0.35) * 0.5 + wind) * H * 0.012;

  const trunkW = Math.max(1, (d / 100) * px * 1.3);
  const box: [number, number, number, number] = [bx - R, by - H, bx + R, by];

  if (H < 3) {
    // 芽生え・稚樹は小さな葉の塊だけ
    ctx.fillStyle = css(leaf, amount > 0.3 ? 1 : 0.5);
    ctx.beginPath();
    ctx.ellipse(
      bx + sway,
      by - H * 0.6,
      Math.max(1.2, R),
      Math.max(1.2, H * 0.45),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    return { tree: t, box };
  }

  const conifer = sp.id === 'pine';
  const crownDepth = conifer ? (H < 12 * px ? 0.75 : 0.35) : sp.id === 'birch' ? 0.55 : 0.5;
  const crownBase = by - H * (1 - crownDepth);
  const topX = bx + sway;

  // 幹（根元から梢へ細くなる）
  ctx.fillStyle = css(bark);
  ctx.beginPath();
  ctx.moveTo(bx - trunkW / 2, by);
  ctx.lineTo(topX - trunkW * 0.15, by - H * 0.92);
  ctx.lineTo(topX + trunkW * 0.15, by - H * 0.92);
  ctx.lineTo(bx + trunkW / 2, by);
  ctx.fill();
  if (sp.id === 'birch' && trunkW > 2) {
    // シラカバの樹皮の黒い横すじ
    ctx.fillStyle = css(mix([40, 40, 40], pal.haze, f), 0.8);
    for (let k = 1; k < 6; k++) {
      const yy = by - (H * (1 - crownDepth) * k) / 6;
      const w = trunkW * (0.3 + ((t.look * 7 * k) % 0.5));
      ctx.fillRect(bx - w / 2 + (k % 2 ? -1 : 1), yy, w, Math.max(1, trunkW * 0.12));
    }
  }

  if (amount <= 0.02) {
    // 落葉樹の冬: 枝だけ。枝は幹のいろいろな高さから出て、上向きに弧を描いて伸びる
    const blobs = blobsFor(t, sp.id);
    const cy = crownBase - (H * crownDepth) / 2;
    const ry = (H * crownDepth) / 2;
    const count = Math.max(5, Math.min(16, Math.round(5 + R / 5)));
    // 細い小枝の集まりは、樹冠の形にうっすら色を付けて表す
    ctx.fillStyle = css(shade(bark, 0.9), 0.06);
    ctx.beginPath();
    ctx.ellipse(topX, cy, R * 0.9, ry * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = css(shade(bark, 0.85));
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const b = blobs[i]!;
      const ex = topX + b.dx * R;
      const ey = cy + b.dy * ry;
      // 上の枝ほど幹の高いところから出る
      const attachY = crownBase - ry * 2 * (0.1 + 0.75 * ((1 - b.dy) / 2));
      const ax = bx + (topX - bx) * ((by - attachY) / H);
      ctx.lineWidth = Math.max(0.5, trunkW * (0.12 + 0.18 * (1 - Math.abs(b.dx))));
      ctx.beginPath();
      ctx.moveTo(ax, attachY);
      ctx.quadraticCurveTo((ax + ex) / 2, Math.min(attachY, ey) - Math.abs(ex - ax) * 0.2, ex, ey);
      // 枝先の小さな二股
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + b.dx * R * 0.22, ey - ry * 0.2);
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + b.dx * R * 0.08 - R * 0.06, ey - ry * 0.28);
      ctx.stroke();
    }
    return { tree: t, box };
  }

  if (conifer && H < 12 * px) {
    // 若いマツ: 三角の段
    const tiers = 4;
    for (let k = 0; k < tiers; k++) {
      const top = by - H + (H * crownDepth * k) / tiers;
      const bottom = top + (H * crownDepth) / tiers + H * 0.08;
      const w = R * (0.45 + (0.55 * (k + 1)) / tiers);
      ctx.fillStyle = css(shade(leaf, 0.85 + 0.05 * k));
      ctx.beginPath();
      ctx.moveTo(topX, top);
      ctx.lineTo(topX + w, bottom);
      ctx.lineTo(topX - w, bottom);
      ctx.fill();
    }
    return { tree: t, box };
  }

  // 樹冠: 丸の重なり。影 → 本体 → 日の当たる面（左上から光）
  const blobs = blobsFor(t, sp.id);
  const cy = crownBase - (H * crownDepth) / 2;
  const rx = R;
  const ry = (H * crownDepth) / 2;
  const unit = Math.min(rx, ry) * (conifer ? 0.9 : 1);
  const alpha = sp.id === 'birch' ? 0.9 : 1;
  // 葉群の数は樹冠の大きさ（画面上の px）に応じて 6〜30。数が増えるほど 1 つを小さくして、
  // 樹冠の面積あたりの覆い方をそろえる
  const n = Math.max(6, Math.min(MAX_BLOBS, Math.round(6 + unit / 4.5)));
  const size = 0.42 * Math.sqrt(10 / n) * (conifer ? 1.2 : 1);
  // band: -1 すべて / 0 下 / 1 中 / 2 上（下の葉群ほど自分の影で暗い）
  const layer = (color: RGB, grow: number, ox: number, oy: number, a: number, band: number) => {
    ctx.fillStyle = css(color, a * alpha);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const b = blobs[i]!;
      if (band >= 0 && Math.min(2, Math.floor((1 - b.dy) * 1.5)) !== band) continue;
      const x = topX + b.dx * rx + ox * unit;
      const y = cy + b.dy * ry * (conifer ? 0.5 : 1) + oy * unit;
      const r = b.r * size * unit * grow;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  };
  layer(shade(leaf, 0.5), 1.1, 0.06, 0.08, amount, -1);
  layer(shade(leaf, 0.72), 0.95, 0, 0, amount, 0);
  layer(shade(leaf, 0.9), 0.95, 0, 0, amount, 1);
  layer(leaf, 0.95, 0, 0, amount, 2);
  // 左上から日が当たる
  layer(mix(leaf, [255, 250, 210], 0.3), 0.45, -0.12, -0.14, amount * 0.85, 2);
  return { tree: t, box: [topX - R, by - H, topX + R, by] };
}

function drawSnag(
  ctx: CanvasRenderingContext2D,
  v: View,
  s: Snag,
  pal: Palette,
  time: number,
  fallStart: WeakMap<Snag, number>,
) {
  const [bx, by, sc] = project(v, s.x, s.z);
  const px = v.ppm * sc;
  const H = s.height * px;
  const w = Math.max(1, (s.d / 100) * px * 1.3);
  const decay = s.fallen ? s.years / 25 : s.years / 40;
  // 倒木は苔むして茶色くなり、朽ちるにつれて林床の色に溶けていく
  const wood = s.fallen
    ? mix([96, 74, 52], pal.floorShade, 0.25 + 0.6 * decay)
    : mix([120, 112, 102], [80, 72, 64], decay);
  const color = mix(wood, pal.haze, fog(v, s.z));
  ctx.fillStyle = css(color, 1 - decay * 0.4);

  let angle = 0;
  if (s.fallen) {
    // 倒れる瞬間を 1 秒かけて見せる
    let start = fallStart.get(s);
    if (start === undefined && s.years === 0) {
      start = time;
      fallStart.set(s, start);
    }
    const t = start === undefined ? 1 : Math.min(1, (time - start) / 1.1);
    angle = s.side * (Math.PI / 2) * t * t;
  }
  const len = s.fallen ? H * 0.7 : H * 0.55;
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w * 0.3, -len);
  ctx.lineTo(w * 0.3, -len);
  ctx.lineTo(w / 2, 0);
  ctx.fill();
  if (!s.fallen) {
    // 折れた枝の跡
    ctx.strokeStyle = css(color, 0.9);
    ctx.lineWidth = Math.max(0.6, w * 0.25);
    ctx.beginPath();
    ctx.moveTo(0, -len * 0.7);
    ctx.lineTo(w * 2.5, -len * 0.82);
    ctx.moveTo(0, -len * 0.5);
    ctx.lineTo(-w * 2, -len * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}
