import { t, type Text } from '../../core/i18n';
import { mountPanel } from '../../core/panel';
import type { SimDefinition } from '../../core/sim';
import { DEFAULT_PARAMS, Forest } from './colonization';

/** 1 年の長さ（秒）。春・夏・秋・冬が 1/4 ずつ */
const YEAR_SECONDS = 40;
/** 春と夏に、何ステップごとに 1 回成長させるか */
const GROW_EVERY = 3;
const MAX_NODES = 16000;
const MAX_TREES = 12;

const SEASONS: Text[] = [
  { ja: '春', en: 'Spring' },
  { ja: '夏', en: 'Summer' },
  { ja: '秋', en: 'Autumn' },
  { ja: '冬', en: 'Winter' },
];

interface FallingLeaf {
  x: number;
  y: number;
  vx: number;
  phase: number;
  hue: number;
  life: number;
}

export const forest: SimDefinition = {
  id: 'forest',
  title: { ja: '森の成長', en: 'Growing Forest' },
  description: {
    ja: '木々が光の届く空間を奪い合いながら枝を伸ばす。隣の木と枝先が避け合う「樹冠の遠慮」が自然に現れ、四季がめぐる。タップで種をまく。',
    en: 'Trees branch out while competing for open, sunlit space. Neighboring crowns keep a gap between them (“crown shyness”) on their own, and the seasons turn. Tap to plant a seed.',
  },
  dt: 1 / 60,
  create({ canvas, width, height, dpr, rng }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is not available');

    let w = width;
    let h = height;
    let ratio = dpr;
    let showLight = false;
    let time = 0;
    let ticks = 0;
    let lastSeason = -1;
    const falling: FallingLeaf[] = [];

    const panel = mountPanel(
      canvas.parentElement!,
      () => `
        <p class="sim-desc">${t({
          ja: 'タップした場所に種をまく。光の粒（まだ枝が来ていない空間）に向かって枝が伸び、届いた粒は消える。',
          en: 'Tap to plant a seed. Branches grow toward specks of light (space no branch has reached yet), using them up as they arrive.',
        })}</p>
        <div class="sim-row">
          <label><input type="checkbox" data-light ${showLight ? 'checked' : ''}/> ${t({ ja: '光の粒を表示', en: 'Show light' })}</label>
          <button data-reset>${t({ ja: '森を植え直す', en: 'Replant' })}</button>
        </div>`,
      (el) => {
        el.querySelector<HTMLInputElement>('[data-light]')!.addEventListener('change', (e) => {
          showLight = (e.target as HTMLInputElement).checked;
        });
        el.querySelector('[data-reset]')!.addEventListener('click', () => {
          world = createWorld();
        });
      },
    );

    /** 森の座標は作ったときの画面の大きさで固定し、描くときに拡大縮小する */
    function createWorld() {
      const W = w;
      const H = h;
      const groundY = Math.max(200, H - panel.el.offsetHeight - 24);
      const k = Math.max(0.6, Math.min(1.6, groundY / 650));
      const params = {
        ...DEFAULT_PARAMS,
        influence: DEFAULT_PARAMS.influence * k,
        kill: DEFAULT_PARAMS.kill * k,
        segment: DEFAULT_PARAMS.segment * k,
        maxTrunk: groundY * 0.42,
      };
      const f = new Forest(W, H, groundY, params);
      const spacing = 12 * k;
      const lightCount = Math.round((W * groundY * 0.64) / (spacing * spacing));
      f.addAttractors(lightCount, rng);
      const count = W > 700 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const x = W * ((i + 0.5) / count + rng.range(-0.08, 0.08));
        f.plant(x, rng.range(0, 360));
      }
      falling.length = 0;
      time = 0;
      ticks = 0;
      lastSeason = -1;
      return { f, W, H, k, lightCount };
    }

    let world = createWorld();
    // 風で揺れた後の表示位置
    let sx = new Float32Array(0);
    let sy = new Float32Array(0);

    const season = () => ((time % YEAR_SECONDS) / YEAR_SECONDS) * 4;

    return {
      step(dt) {
        time += dt;
        ticks++;
        const s = season();
        const index = Math.floor(s);
        const { f } = world;
        if (index === 0 && lastSeason === 3) {
          // 春になると、枝が落ちて光の差す空間が少し戻る
          if (f.n < MAX_NODES) f.addAttractors(Math.round(world.lightCount * 0.25), rng);
        }
        lastSeason = index;
        if (s < 2 && ticks % GROW_EVERY === 0 && f.n < MAX_NODES) f.grow();

        // 秋は葉が散る
        if (index === 2 && f.n > 0 && falling.length < 500) {
          const rate = Math.min(8, f.n / 400);
          for (let i = 0; i < rate; i++) {
            const node = rng.int(f.n);
            if (f.children[node] !== 0) continue;
            falling.push({
              x: sx[node] ?? f.x[node]!,
              y: sy[node] ?? f.y[node]!,
              vx: rng.range(-10, 10),
              phase: rng.range(0, 6),
              hue: f.trees[f.tree[node]!]!.hue,
              life: 1,
            });
          }
        }
        for (const leaf of falling) {
          if (leaf.y < f.groundY) {
            leaf.y += dt * 28 * world.k;
            leaf.x += dt * (leaf.vx + 18 * Math.sin(time * 2 + leaf.phase));
          } else {
            leaf.life -= dt * 0.25;
          }
        }
        for (let i = falling.length - 1; i >= 0; i--)
          if (falling[i]!.life <= 0) falling.splice(i, 1);
      },

      render() {
        const { f, W, H } = world;
        const scale = Math.min(w / W, h / H);
        const offsetX = (w - W * scale) / 2;
        ctx.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * offsetX, 0);
        const s = season();
        drawSky(ctx, W, H, f.groundY, s);

        if (showLight) {
          ctx.fillStyle = 'rgba(255, 240, 150, 0.55)';
          for (let a = 0; a < f.attractors; a++) ctx.fillRect(f.ax[a]! - 1, f.ay[a]! - 1, 2, 2);
        }

        // 風: 太い枝ほど硬く、細い枝ほどよくしなる。根元からの角度を積み重ねて曲げる
        if (sx.length < f.n) {
          sx = new Float32Array(f.x.length);
          sy = new Float32Array(f.x.length);
        }
        const angle = new Float32Array(f.n);
        const wind =
          0.5 * Math.sin(time * 0.7) +
          0.3 * Math.sin(time * 1.9 + 1.3) +
          0.25 * Math.sin(time * 0.23);
        for (let i = 0; i < f.n; i++) {
          const p = f.parent[i]!;
          if (p < 0) {
            sx[i] = f.x[i]!;
            sy[i] = f.y[i]!;
            continue;
          }
          const flex = 0.006 / (f.radius[i]! + 0.25);
          const a = angle[p]! + wind * flex * (1 + 0.3 * Math.sin(time * 3 + f.x[i]! * 0.02));
          angle[i] = a;
          const dx = f.x[i]! - f.x[p]!;
          const dy = f.y[i]! - f.y[p]!;
          const c = Math.cos(a);
          const sn = Math.sin(a);
          sx[i] = sx[p]! + dx * c - dy * sn;
          sy[i] = sy[p]! + dx * sn + dy * c;
        }

        drawBranches(ctx, f, sx, sy, s);
        drawLeaves(ctx, f, sx, sy, s, world.k);

        for (const leaf of falling) {
          ctx.fillStyle = `hsla(${leaf.hue % 50}, 80%, 50%, ${Math.min(1, leaf.life)})`;
          ctx.beginPath();
          ctx.ellipse(
            leaf.x,
            leaf.y,
            3 * world.k,
            1.8 * world.k,
            time * 3 + leaf.phase,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      },

      resize(nw, nh, ndpr) {
        w = nw;
        h = nh;
        ratio = ndpr;
      },

      pointer(e) {
        if (e.type !== 'down') return;
        const { f, W, H } = world;
        if (f.trees.length >= MAX_TREES) return;
        const scale = Math.min(w / W, h / H);
        const x = (e.x - (w - W * scale) / 2) / scale;
        if (x < W * 0.03 || x > W * 0.97) return;
        f.plant(x, rng.range(0, 360));
        // 種のまわりに光の差す空間を開ける（まわりの木とも奪い合いになる）
        const half = Math.max(W * 0.1, f.params.influence * 1.5);
        f.addAttractors(
          Math.round(world.lightCount * ((2 * half) / W) * 0.6),
          rng,
          Math.max(W * 0.02, x - half),
          Math.min(W * 0.98, x + half),
        );
      },

      stats: () => ({
        [t({ ja: '年', en: 'Year' })]:
          `${Math.floor(time / YEAR_SECONDS) + 1} · ${t(SEASONS[Math.floor(season())]!)}`,
        [t({ ja: '木', en: 'Trees' })]: world.f.trees.length,
        [t({ ja: '枝の節', en: 'Branch nodes' })]: world.f.n.toLocaleString(),
        [t({ ja: '残りの光', en: 'Light left' })]: world.f.attractors.toLocaleString(),
      }),

      dispose() {
        panel.dispose();
      },
    };
  },
};

/** 季節 s（0〜4）ごとの空と地面 */
function drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, groundY: number, s: number) {
  const palette = [
    ['#8ec5ff', '#e8f4ff', '#6fae4f'], // 春
    ['#4b9be8', '#cfe8ff', '#4d8f35'], // 夏
    ['#f0b67a', '#ffe9cf', '#8a7a3a'], // 秋
    ['#9aa7b8', '#e9eef4', '#e8edf2'], // 冬
  ];
  const i = Math.floor(s) % 4;
  const j = (i + 1) % 4;
  const f = smooth(s - Math.floor(s));
  const col = (k: number) => mixColor(palette[i]![k]!, palette[j]![k]!, f);
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, col(0));
  sky.addColorStop(1, col(1));
  ctx.fillStyle = sky;
  ctx.fillRect(-W, 0, W * 3, groundY);
  ctx.fillStyle = col(2);
  ctx.fillRect(-W, groundY, W * 3, H - groundY + 400);
}

/** 季節の変わり目の最後の 2 割だけで色を移す */
const smooth = (x: number) => {
  const u = Math.max(0, (x - 0.8) / 0.2);
  return u * u * (3 - 2 * u);
};

function mixColor(a: string, b: string, f: number): string {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16));
  const pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return `rgb(${pa.map((v, k) => Math.round(v + (pb[k]! - v) * f)).join(',')})`;
}

function drawBranches(
  ctx: CanvasRenderingContext2D,
  f: Forest,
  sx: Float32Array,
  sy: Float32Array,
  s: number,
) {
  // 太さごとにまとめて描く
  const buckets = new Map<number, Path2D>();
  for (let i = 0; i < f.n; i++) {
    const p = f.parent[i]!;
    if (p < 0) continue;
    const width = Math.max(0.6, Math.round(f.radius[i]! * 2 * 2) / 2);
    let path = buckets.get(width);
    if (!path) buckets.set(width, (path = new Path2D()));
    path.moveTo(sx[p]!, sy[p]!);
    path.lineTo(sx[i]!, sy[i]!);
  }
  const winter = s >= 3 ? 1 : 0;
  ctx.lineCap = 'round';
  for (const [width, path] of buckets) {
    ctx.strokeStyle = winter ? '#4a3a30' : '#5b4331';
    ctx.lineWidth = width;
    ctx.stroke(path);
  }
}

/** 枝先に葉を付ける。春に芽吹き、夏に濃くなり、秋に色づいて散り、冬は裸 */
function drawLeaves(
  ctx: CanvasRenderingContext2D,
  f: Forest,
  sx: Float32Array,
  sy: Float32Array,
  s: number,
  k: number,
) {
  let amount: number;
  if (s < 0.4) amount = s / 0.4;
  else if (s < 2) amount = 1;
  else if (s < 3) amount = 1 - (s - 2);
  else amount = 0;
  if (amount <= 0.01) return;

  const autumn = Math.max(0, Math.min(1, (s - 1.85) / 0.6));
  const size = 3.6 * k;
  for (let t = 0; t < f.trees.length; t++) {
    const tree = f.trees[t]!;
    const green = s < 1 ? [100, 65, 52] : [118, 48, 34];
    const fall = [tree.hue % 50, 85, 50];
    const hue = green[0]! + (fall[0]! - green[0]!) * autumn;
    const sat = green[1]! + (fall[1]! - green[1]!) * autumn;
    const light = green[2]! + (fall[2]! - green[2]!) * autumn;
    const path = new Path2D();
    for (let i = 0; i < f.n; i++) {
      if (f.tree[i] !== t || f.trunk[i] || f.radius[i]! > 1.1) continue;
      // 秋は葉が 1 枚ずつ減っていく（節ごとに散る時期をずらす）
      const r = ((i * 2654435761) >>> 0) / 4294967296;
      if (r > amount) continue;
      // 1 つの節に 2 枚。位置を少しずつずらして、数珠つなぎではなく茂みに見せる
      for (let leaf = 0; leaf < 2; leaf++) {
        const a = (r * 97 + leaf * 2.4) * Math.PI;
        const d = size * (0.6 + 0.9 * ((r * 13 + leaf * 0.37) % 1));
        const lx = sx[i]! + Math.cos(a) * d;
        const ly = sy[i]! + Math.sin(a) * d;
        path.moveTo(lx + size, ly);
        path.arc(lx, ly, size, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 0.42)`;
    ctx.fill(path);
  }
}
