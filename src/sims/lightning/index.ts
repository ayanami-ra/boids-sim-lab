import { t, type Text } from '../../core/i18n';
import { mountPanel } from '../../core/panel';
import type { SimDefinition } from '../../core/sim';
import { Cell, Discharge, type Mode } from './dbm';

/** 枝分かれの選択肢（η）。大きいほど枝が少なくまっすぐ */
const ETAS: { eta: number; label: Text }[] = [
  { eta: 1, label: { ja: '多い', en: 'Many' } },
  { eta: 2, label: { ja: 'ふつう', en: 'Some' } },
  { eta: 4, label: { ja: '少ない', en: 'Few' } },
];

interface Bolt {
  /** 地面に届いてからの秒数（まだなら -1） */
  afterStrike: number;
  /** 光の強さ（0〜1） */
  flash: number;
  /** 起点の列（格子のセル） */
  x: number;
}

/** 雷が生まれる平均の頻度（1 秒あたり） */
const FREQUENCIES: { rate: number; label: Text }[] = [
  { rate: 0.25, label: { ja: '少ない', en: 'Rare' } },
  { rate: 0.7, label: { ja: 'ふつう', en: 'Normal' } },
  { rate: 1.8, label: { ja: '激しい', en: 'Intense' } },
];
/** 同時に伸ばす雷の最大数 */
const MAX_GROWING = 5;
/** 地面に届いてから光り直すまでの時刻（秒） */
const PULSES = [0, 0.12, 0.3];

const MODES: { mode: Mode; label: Text; hint: Text }[] = [
  {
    mode: 'lightning',
    label: { ja: '雷', en: 'Lightning' },
    hint: {
      ja: '電位の方程式を解きながら、電場の強い方へ放電が枝分かれして進む。タップした高さまで避雷針が立つ。',
      en: 'The discharge branches toward the strongest electric field, solved from the potential equation. Tap to raise a lightning rod up to that height.',
    },
  },
  {
    mode: 'lichtenberg',
    label: { ja: 'リヒテンベルク図形', en: 'Lichtenberg figure' },
    hint: {
      ja: '中心の電極から外周へ向かって放電が広がる。タップした場所から新しく始まる。',
      en: 'A discharge spreads from a center electrode to the outer ring. Tap to start a new one there.',
    },
  },
];

interface World {
  mode: Mode;
  /** 1 セルの大きさ（CSS px） */
  cell: number;
  /** 格子の左上（CSS px） */
  ox: number;
  oy: number;
  gw: number;
  gh: number;
  /** 地表の高さ（セルの行番号、列ごと） */
  surface: Int32Array;
  rods: { x: number; top: number }[];
  /** 放電路がない状態で解いた電位（放電のたびに使い回す） */
  basePhi: Float32Array | null;
  discharge: Discharge;
  /** 放電の起点（リヒテンベルク図形） */
  origin: { x: number; y: number } | null;
}

export const lightning: SimDefinition = {
  id: 'lightning',
  title: { ja: '雷', en: 'Lightning' },
  description: {
    ja: '電位の方程式（ラプラス方程式）を解きながら放電が枝分かれして進む。避雷針を立てると本当にそこへ落ちやすくなる。',
    en: 'Discharges branch by solving the electric potential (Laplace’s equation). Put up a lightning rod and strikes really do favor it.',
  },
  dt: 1 / 60,
  create({ canvas, width, height, dpr, rng, params }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is not available');

    let w = width;
    let h = height;
    let ratio = dpr;
    let mode: Mode = params.get('mode') === 'lichtenberg' ? 'lichtenberg' : 'lightning';
    let eta = Number(params.get('eta')) || (mode === 'lightning' ? 2 : 1);
    let strikes = 0;
    let frequency = Math.max(0, Math.min(2, Number(params.get('freq') ?? 1)));
    /** 伸びている・光っている雷（リーダーの番号 → 状態） */
    const bolts = new Map<number, Bolt>();
    /** 次の雷が生まれるまでの秒数 */
    let nextSpawn = 0;
    let time = 0;
    const rain = Array.from({ length: 160 }, () => ({
      x: rng.next(),
      y: rng.next(),
      s: rng.range(0.6, 1),
    }));

    const panel = mountPanel(
      canvas.parentElement!,
      () => `
        <p class="sim-desc">${t(MODES.find((m) => m.mode === mode)!.hint)}</p>
        <div class="sim-row">
          ${MODES.map((m) => `<button data-mode="${m.mode}" class="${m.mode === mode ? 'on' : ''}">${t(m.label)}</button>`).join('')}
        </div>
        <div class="sim-row">
          <label>${t({ ja: '枝分かれ', en: 'Branching' })}</label>
          ${ETAS.map((e) => `<button data-eta="${e.eta}" class="${e.eta === eta ? 'on' : ''}">${t(e.label)} (η=${e.eta})</button>`).join('')}
          ${mode === 'lightning' ? `<button data-clear>${t({ ja: '避雷針を片付ける', en: 'Remove rods' })}</button>` : ''}
        </div>
        ${
          mode === 'lightning'
            ? `<div class="sim-row">
                <label>${t({ ja: '雷の頻度', en: 'Frequency' })}</label>
                ${FREQUENCIES.map((f, i) => `<button data-frequency="${i}" class="${i === frequency ? 'on' : ''}">${t(f.label)}</button>`).join('')}
              </div>`
            : ''
        }`,
      (el) => {
        el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
          b.addEventListener('click', () => {
            const next = b.dataset.mode as Mode;
            if (next === mode) return;
            mode = next;
            eta = mode === 'lightning' ? 2 : 1;
            world = buildWorld();
            panel.refresh();
          }),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-eta]').forEach((b) =>
          b.addEventListener('click', () => {
            eta = Number(b.dataset.eta);
            panel.refresh();
          }),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-frequency]').forEach((b) =>
          b.addEventListener('click', () => {
            frequency = Number(b.dataset.frequency);
            nextSpawn = Math.min(nextSpawn, spawnInterval());
            panel.refresh();
          }),
        );
        el.querySelector('[data-clear]')?.addEventListener('click', () => {
          world.rods = [];
          world = buildWorld(world);
        });
      },
    );

    const skyHeight = () => Math.max(120, h - panel.el.offsetHeight - 16);

    /** 雷: 地形と避雷針を作り、放電路なしの電位を解く。previous があれば避雷針を引き継ぐ */
    function buildWorld(previous?: World): World {
      if (mode === 'lichtenberg') {
        const size = Math.min(w - 24, skyHeight() - 60);
        const cell = size > 500 ? 4 : 3;
        const n = Math.max(41, Math.floor(size / cell) | 1);
        const discharge = new Discharge(n, n, 'lichtenberg');
        const world: World = {
          mode,
          cell,
          ox: (w - n * cell) / 2,
          oy: Math.max(50, (skyHeight() - n * cell) / 2),
          gw: n,
          gh: n,
          surface: new Int32Array(0),
          rods: [],
          basePhi: null,
          discharge,
          origin: previous?.mode === 'lichtenberg' ? previous.origin : null,
        };
        discharge.relax(200);
        world.basePhi = discharge.phi.slice();
        startDischarge(world);
        return world;
      }

      const cell = Math.max(4, Math.round(Math.sqrt((w * h) / 45000)));
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(skyHeight() / cell);
      // なだらかな丘。高さはシードで決まる
      const phase = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
      const surface = new Int32Array(gw);
      for (let x = 0; x < gw; x++) {
        const u = x / gw;
        const hill =
          0.05 * Math.sin(u * 5 + phase[0]!) +
          0.03 * Math.sin(u * 11 + phase[1]!) +
          0.015 * Math.sin(u * 23 + phase[2]!);
        surface[x] = Math.round(gh * (0.93 - Math.max(0, hill + 0.03)));
      }
      const rods = previous?.rods ?? [{ x: Math.round(gw * 0.72), top: Math.round(gh * 0.62) }];
      const discharge = new Discharge(gw, gh, 'lightning');
      const world: World = {
        mode,
        cell,
        ox: 0,
        oy: 0,
        gw,
        gh,
        surface,
        rods,
        basePhi: null,
        discharge,
        origin: null,
      };
      applyGround(world, discharge);
      discharge.relax(400);
      world.basePhi = discharge.phi.slice();
      startDischarge(world);
      return world;
    }

    function applyGround(world: World, d: Discharge) {
      for (let x = 0; x < world.gw; x++) {
        for (let y = world.surface[x]!; y < world.gh; y++) d.addGround(x, y);
      }
      for (const rod of world.rods) {
        for (let y = rod.top; y < world.surface[rod.x]!; y++) d.addGround(rod.x, y);
      }
    }

    /** 放電路をすべて消す。雷モードは最初の 1 本をすぐに生み、リヒテンベルク図形は中心から始める */
    function startDischarge(world: World) {
      const d = new Discharge(world.gw, world.gh, world.mode);
      if (world.mode === 'lightning') applyGround(world, d);
      if (world.basePhi) d.phi.set(world.basePhi);
      world.discharge = d;
      bolts.clear();
      if (world.mode === 'lightning') {
        spawnBolt(world);
        nextSpawn = spawnInterval();
      } else {
        const c = (world.gw - 1) / 2;
        const o = world.origin ?? { x: c, y: c };
        bolts.set(d.seed(Math.round(o.x), Math.round(o.y)), { afterStrike: -1, flash: 0, x: o.x });
      }
    }

    /** 雷の発生はランダム（ポアソン過程）: 次までの間隔は指数分布 */
    function spawnInterval() {
      return -Math.log(1 - rng.next()) / FREQUENCIES[frequency]!.rate;
    }

    /** 雲の底のランダムな位置から、新しい雷（先駆放電）を始める */
    function spawnBolt(world: World) {
      const d = world.discharge;
      const growing = [...bolts.values()].filter((b) => b.afterStrike < 0).length;
      if (growing >= MAX_GROWING) return;
      // 伸びている雷の起点のすぐ隣は避ける
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = Math.round(world.gw * rng.range(0.08, 0.92));
        const y = Math.round(world.gh * rng.range(0.04, 0.1));
        const i = y * world.gw + x;
        if (d.state[i] !== Cell.Free) continue;
        if ([...bolts.values()].some((b) => b.afterStrike < 0 && Math.abs(b.x - x) < 6)) continue;
        bolts.set(d.seed(x, y), { afterStrike: -1, flash: 0, x });
        return;
      }
    }

    let world = buildWorld();

    return {
      step(dt) {
        time += dt;
        for (const r of rain) {
          r.y += dt * 1.6 * r.s;
          r.x -= dt * 0.12 * r.s;
          if (r.y > 1) {
            r.y -= 1;
            r.x = rng.next();
          }
          if (r.x < 0) r.x += 1;
        }
        const d = world.discharge;
        if (world.mode === 'lightning') {
          nextSpawn -= dt;
          if (nextSpawn <= 0) {
            spawnBolt(world);
            nextSpawn = spawnInterval();
          }
        }
        const grows = world.mode === 'lightning' ? 3 : 8;
        for (const [id, bolt] of bolts) {
          if (bolt.afterStrike >= 0) {
            bolt.afterStrike += dt;
            // 雷は 1 回で終わらず、同じ道を何度か光り直す（再帰雷撃）
            const a = bolt.afterStrike;
            bolt.flash = Math.max(0, ...PULSES.map((p) => (a >= p ? Math.exp(-(a - p) * 9) : 0)));
            if (world.mode === 'lichtenberg') {
              if (a > 3.5) {
                startDischarge(world);
                return;
              }
            } else if (a > 1.6) {
              d.removeLeader(id, world.basePhi ?? undefined);
              bolts.delete(id);
            }
            continue;
          }
          for (let k = 0; k < grows; k++) {
            if (d.grow(eta, rng, id)) {
              strikes++;
              bolt.afterStrike = 0;
              break;
            }
          }
        }
        d.relax(1);
      },

      render() {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const flash = Math.max(0, ...[...bolts.values()].map((b) => b.flash));
        if (world.mode === 'lightning') drawStorm(ctx, world, w, h, flash, rain, time);
        else {
          ctx.fillStyle = '#04050b';
          ctx.fillRect(0, 0, w, h);
          const r = (world.gw * world.cell) / 2;
          ctx.strokeStyle = 'rgba(120, 140, 255, 0.25)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(world.ox + r, world.oy + r, r - world.cell, 0, Math.PI * 2);
          ctx.stroke();
        }
        drawChannel(ctx, world, bolts);
      },

      resize(nw, nh, ndpr) {
        const changed = Math.abs(nw - w) > 1 || Math.abs(nh - h) > 1;
        w = nw;
        h = nh;
        ratio = ndpr;
        if (changed) world = buildWorld();
      },

      pointer(e) {
        if (e.type !== 'down') return;
        const gx = Math.round((e.x - world.ox) / world.cell);
        const gy = Math.round((e.y - world.oy) / world.cell);
        if (gx < 1 || gy < 1 || gx >= world.gw - 1 || gy >= world.gh - 1) return;
        if (world.mode === 'lightning') {
          const top = Math.min(gy, world.surface[gx]! - 2);
          if (top < world.gh * 0.15) return;
          world.rods.push({ x: gx, top });
          // 避雷針ぶんの電位を解き直し、今の放電にも反映する
          const base = new Discharge(world.gw, world.gh, 'lightning');
          applyGround(world, base);
          base.phi.set(world.basePhi!);
          for (let y = top; y < world.surface[gx]!; y++) base.addGround(gx, y);
          base.relax(300);
          world.basePhi = base.phi.slice();
          for (let y = top; y < world.surface[gx]!; y++) world.discharge.addGround(gx, y);
        } else {
          const c = (world.gw - 1) / 2;
          if (Math.hypot(gx - c, gy - c) > c - 4) return;
          world.origin = { x: gx, y: gy };
          startDischarge(world);
        }
      },

      stats: () => ({
        [t({ ja: '落雷', en: 'Strikes' })]: strikes,
        [t({ ja: '伸びている雷', en: 'Growing' })]: [...bolts.values()].filter(
          (b) => b.afterStrike < 0,
        ).length,
        [t({ ja: '放電路', en: 'Channel' })]:
          `${world.discharge.length.toLocaleString()} ${t({ ja: 'セル', en: 'cells' })}`,
        [t({ ja: '電位の格子', en: 'Potential grid' })]: `${world.gw}×${world.gh}`,
        η: eta,
      }),

      dispose() {
        panel.dispose();
      },
    };
  },
};

function drawStorm(
  ctx: CanvasRenderingContext2D,
  world: World,
  w: number,
  h: number,
  flash: number,
  rain: { x: number; y: number; s: number }[],
  time: number,
) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  const lift = flash * 0.5;
  sky.addColorStop(0, `rgb(${10 + 90 * lift}, ${12 + 90 * lift}, ${26 + 120 * lift})`);
  sky.addColorStop(1, `rgb(${18 + 40 * lift}, ${22 + 40 * lift}, ${38 + 60 * lift})`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 雲の底: ゆっくり動くぼんやりした帯
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (let i = 0; i < 7; i++) {
    const x = ((i / 6) * w + Math.sin(time * 0.05 + i) * 30) % (w + 200);
    const g = ctx.createRadialGradient(x, 10, 10, x, 10, w * 0.25);
    g.addColorStop(0, `rgba(${40 + 150 * flash}, ${44 + 150 * flash}, ${70 + 170 * flash}, 0.9)`);
    g.addColorStop(1, 'rgba(20, 22, 40, 0)');
    ctx.fillStyle = g;
    // グラデーションが透明になる半径まで塗る（途中で切ると雲の下端に線が出る）
    ctx.fillRect(0, 0, w, w * 0.25 + 10);
  }
  ctx.restore();

  // 雨
  ctx.strokeStyle = `rgba(160, 180, 220, ${0.18 + flash * 0.3})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const r of rain) {
    const x = r.x * w;
    const y = r.y * h;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3 * r.s, y + 14 * r.s);
  }
  ctx.stroke();

  // 地面と避雷針
  const c = world.cell;
  ctx.fillStyle = `rgb(${5 + 30 * flash}, ${6 + 30 * flash}, ${10 + 40 * flash})`;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x < world.gw; x++) ctx.lineTo(x * c + c / 2, world.surface[x]! * c);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 200, 220, 0.8)';
  ctx.lineWidth = 2;
  for (const rod of world.rods) {
    const x = rod.x * c + c / 2;
    ctx.beginPath();
    ctx.moveTo(x, world.surface[rod.x]! * c);
    ctx.lineTo(x, rod.top * c);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220, 225, 240, 0.9)';
    ctx.beginPath();
    ctx.arc(x, rod.top * c, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 放電路を描く。枝の先にぶら下がるセルが多い（電流が多い）ほど太く明るい。
 * 雷ごとに状態が違う（伸びている / 光っている / 消えかけ）ので、雷ごとにまとめて描く。
 */
function drawChannel(ctx: CanvasRenderingContext2D, world: World, bolts: Map<number, Bolt>) {
  const d = world.discharge;
  if (d.length < 2) return;
  const c = world.cell;
  const px = (i: number) => world.ox + (i % d.w) * c + c / 2;
  const py = (i: number) => world.oy + Math.floor(i / d.w) * c + c / 2;
  const sizes = d.subtreeSizes();
  const lichtenberg = world.mode === 'lichtenberg';

  // 雷ごとのセル数（太さの基準）と、太さごとの線
  const buckets = 6;
  const perBolt = new Map<number, { count: number; paths: Path2D[] }>();
  for (let k = 0; k < d.length; k++) {
    const owner = d.owner[d.order[k]!]!;
    let entry = perBolt.get(owner);
    if (!entry)
      perBolt.set(
        owner,
        (entry = { count: 0, paths: Array.from({ length: buckets }, () => new Path2D()) }),
      );
    entry.count++;
  }
  for (let k = 0; k < d.length; k++) {
    const i = d.order[k]!;
    const p = d.parent[i]!;
    if (p < 0) continue;
    const entry = perBolt.get(d.owner[i]!)!;
    const level = Math.log(1 + sizes[i]!) / Math.log(1 + entry.count);
    const b = Math.min(buckets - 1, Math.floor(level * buckets));
    entry.paths[b]!.moveTo(px(p), py(p));
    entry.paths[b]!.lineTo(px(i), py(i));
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  let screenFlash = 0;
  for (const [id, entry] of perBolt) {
    const bolt = bolts.get(id);
    const struck = bolt ? bolt.afterStrike >= 0 : false;
    const flash = bolt?.flash ?? 0;
    // 落雷後は枝がすぐ消え、主放電路だけが光る
    const branchFade = struck && !lichtenberg ? Math.max(0, flash * 1.2 - 0.2) : 1;
    for (let b = 0; b < buckets; b++) {
      const level = (b + 1) / buckets;
      const alpha = (0.15 + 0.85 * level) * branchFade;
      if (alpha <= 0.01) continue;
      const [r, g, bl] = lichtenberg
        ? [120 + 135 * level, 150 + 105 * level, 255]
        : [170, 160, 255];
      ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${alpha * 0.18})`;
      ctx.lineWidth = (0.6 + 2.2 * level) * 4;
      ctx.stroke(entry.paths[b]!);
      ctx.strokeStyle = `rgba(${Math.min(255, r + 60)}, ${Math.min(255, g + 60)}, 255, ${alpha})`;
      ctx.lineWidth = 0.6 + 2.2 * level;
      ctx.stroke(entry.paths[b]!);
    }
    if (!struck || lichtenberg) continue;
    const main = new Path2D();
    const path = d.mainPath(id);
    for (let k = 0; k + 1 < path.length; k++) {
      main.moveTo(px(path[k]!), py(path[k]!));
      main.lineTo(px(path[k + 1]!), py(path[k + 1]!));
    }
    ctx.strokeStyle = `rgba(150, 140, 255, ${0.5 * flash})`;
    ctx.lineWidth = 16;
    ctx.stroke(main);
    ctx.strokeStyle = `rgba(210, 205, 255, ${0.8 * flash})`;
    ctx.lineWidth = 6;
    ctx.stroke(main);
    ctx.strokeStyle = `rgba(255, 255, 255, ${Math.min(1, 0.4 + flash)})`;
    ctx.lineWidth = 2.2;
    ctx.stroke(main);
    screenFlash = Math.max(screenFlash, flash);
  }
  if (screenFlash > 0) {
    ctx.fillStyle = `rgba(200, 200, 255, ${0.18 * screenFlash})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.restore();

  // 伸びている先端をきらめかせる
  ctx.fillStyle = 'rgba(230, 225, 255, 0.9)';
  const shown = new Map<number, number>();
  for (let k = d.length - 1; k > 0; k--) {
    const i = d.order[k]!;
    const owner = d.owner[i]!;
    const bolt = bolts.get(owner);
    if (!bolt || bolt.afterStrike >= 0) continue;
    const n = shown.get(owner) ?? 0;
    if (n >= 5) continue;
    shown.set(owner, n + 1);
    ctx.fillRect(px(i) - 1.5, py(i) - 1.5, 3, 3);
  }
}
