import { t, type Text } from '../../core/i18n';
import { mountPanel } from '../../core/panel';
import type { SimDefinition } from '../../core/sim';
import { SPECIES_COLORS, chartYearAt, drawChart } from './chart';
import {
  drawBackdrop,
  drawFloor,
  drawTrees,
  palette,
  scaleAt,
  unprojectZ,
  type Season,
  type TreeDraw,
  type View,
} from './render';
import { DEFAULT_STAND, SPECIES, Stand, height, type Snag } from './stand';

/** 1 秒に進む年数 */
const SPEEDS: { yearsPerSecond: number; label: Text }[] = [
  { yearsPerSecond: 0.1, label: { ja: 'ゆっくり（四季）', en: 'Slow (seasons)' } },
  { yearsPerSecond: 2, label: { ja: 'ふつう', en: 'Normal' } },
  { yearsPerSecond: 8, label: { ja: 'はやい', en: 'Fast' } },
];
/** 始める前に進めておく年数（何もない裸地から始めると、しばらく何も見えないため） */
const PREROLL_YEARS = 12;
const SEASONS: Text[] = [
  { ja: '春', en: 'spring' },
  { ja: '夏', en: 'summer' },
  { ja: '秋', en: 'autumn' },
  { ja: '冬', en: 'winter' },
];

type TapMode = 'fell' | number;

export const forest: SimDefinition = {
  id: 'forest',
  title: { ja: '森の一生', en: 'Life of a Forest' },
  description: {
    ja: '裸地に芽生えたシラカバやアカマツの林が、何百年もかけてミズナラやブナの森へ移り変わる。木 1 本 1 本が光を奪い合い、育ち、種をまき、枯れる。台風や山火事、伐採で森を揺さぶれる。',
    en: 'A clearing of birch and pine turns, over centuries, into an oak and beech forest. Every tree competes for light, grows, spreads seeds and dies. Shake it up with typhoons, wildfire or logging.',
  },
  dt: 1 / 60,
  create({ canvas, width, height: canvasHeight, dpr, rng, params }) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is not available');

    let w = width;
    let h = canvasHeight;
    let ratio = dpr;
    let speed = Math.max(0, Math.min(2, Number(params.get('speed-mode') ?? 1)));
    let tapMode: TapMode = 'fell';
    let yearAcc = 0;
    let time = 0;
    let hoverYear: number | null = null;
    let windBurst = 0;
    let windSide = 1;
    let fireGlow = 0;
    let burnYear = -100;
    let chartDirty = true;
    let hits: TreeDraw[] = [];
    const fallStart = new WeakMap<Snag, number>();
    const backdropLook = [rng.range(0, 6), rng.range(0, 6)];

    const panel = mountPanel(
      canvas.parentElement!,
      () => `
        <div class="forest-chart">
          <canvas></canvas>
          <div class="forest-legend">${SPECIES.map(
            (s, i) => `<span><i style="background:${SPECIES_COLORS[i]}"></i>${t(s.name)}</span>`,
          ).join('')}<span class="forest-readout"></span></div>
        </div>
        <div class="sim-row">
          ${SPEEDS.map((s, i) => `<button data-speed="${i}" class="${i === speed ? 'on' : ''}">${t(s.label)}</button>`).join('')}
        </div>
        <div class="sim-row">
          <button data-typhoon>🌀 ${t({ ja: '台風', en: 'Typhoon' })}</button>
          <button data-fire>🔥 ${t({ ja: '山火事', en: 'Wildfire' })}</button>
          <button data-reset>${t({ ja: '裸地からやり直す', en: 'Start over' })}</button>
        </div>
        <div class="sim-row">
          <label>${t({ ja: 'タップで', en: 'Tap to' })}</label>
          <button data-tap="fell" class="${tapMode === 'fell' ? 'on' : ''}">🪓 ${t({ ja: '伐採', en: 'Cut' })}</button>
          ${SPECIES.map((s, i) => `<button data-tap="${i}" class="${tapMode === i ? 'on' : ''}">🌱 ${t(s.name)}</button>`).join('')}
        </div>`,
      (el) => {
        el.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((b) =>
          b.addEventListener('click', () => {
            speed = Number(b.dataset.speed);
            panel.refresh();
          }),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-tap]').forEach((b) =>
          b.addEventListener('click', () => {
            tapMode = b.dataset.tap === 'fell' ? 'fell' : Number(b.dataset.tap);
            panel.refresh();
          }),
        );
        el.querySelector('[data-typhoon]')!.addEventListener('click', () => {
          windSide = rng.next() < 0.5 ? -1 : 1;
          stand.typhoon(windSide);
          windBurst = 2.5;
          chartDirty = true;
        });
        el.querySelector('[data-fire]')!.addEventListener('click', () => {
          stand.fire();
          fireGlow = 3;
          burnYear = stand.year;
          chartDirty = true;
        });
        el.querySelector('[data-reset]')!.addEventListener('click', () => {
          stand = newStand();
          view = makeView();
          chartDirty = true;
        });
        const chart = el.querySelector<HTMLCanvasElement>('.forest-chart canvas')!;
        chart.addEventListener('pointermove', (e) => {
          hoverYear = chartYearAt(chart, e.clientX, stand.history.length);
          chartDirty = true;
        });
        chart.addEventListener('pointerleave', () => {
          hoverYear = null;
          chartDirty = true;
        });
        chartDirty = true;
      },
    );

    /** 画面の大きさから、林分の幅と遠近の見せ方を決める */
    function makeView(standWidth?: number): View {
      const groundFront = Math.max(160, h - panel.el.offsetHeight - 14);
      const floorHeight = Math.min(120, groundFront * 0.2);
      // いちばん高い木（約 31 m）が画面に収まり、横に 40 m 以上は見えるように
      let ppm = Math.min((groundFront - floorHeight * 0.3 - 30) / 33, w / 40);
      const sw = standWidth ?? Math.min(120, w / ppm);
      ppm = Math.min(ppm, w / sw);
      return {
        width: w,
        groundFront,
        ppm,
        standWidth: sw,
        standDepth: 30,
        perspective: 38,
        floorHeight,
      };
    }

    function newStand(): Stand {
      const v = makeView();
      const scale = v.standWidth / 100;
      const s = new Stand(rng, {
        ...DEFAULT_STAND,
        width: v.standWidth,
        depth: 30,
        maxTrees: Math.round(DEFAULT_STAND.maxTrees * scale),
      });
      for (let y = 0; y < PREROLL_YEARS; y++) s.step();
      s.computeLight();
      burnYear = -100;
      return s;
    }

    let stand = newStand();
    let view = makeView(stand.options.width);

    const season = (): Season => ({
      phase: (yearAcc % 1) * 4,
      visible: SPEEDS[speed]!.yearsPerSecond < 1,
    });

    const updateReadout = () => {
      const el = panel.el.querySelector('.forest-readout');
      if (!el) return;
      const year = hoverYear ?? stand.history.length;
      const row = stand.history[year - 1];
      if (!row) {
        el.textContent = '';
        return;
      }
      const total = row.reduce((a, b) => a + b, 0);
      el.textContent = `${year}${t({ ja: '年目', en: ' yr' })} · ${total.toFixed(1)} m²/ha`;
    };

    return {
      step(dt) {
        time += dt;
        windBurst = Math.max(0, windBurst - dt);
        fireGlow = Math.max(0, fireGlow - dt);
        yearAcc += dt * SPEEDS[speed]!.yearsPerSecond;
        let steps = 0;
        while (yearAcc >= 1 && steps < 2) {
          yearAcc -= 1;
          stand.step();
          steps++;
          chartDirty = true;
        }
        if (steps === 2) yearAcc = Math.min(yearAcc, 0.99);
      },

      render() {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const s = season();
        const pal = palette(s);
        drawBackdrop(ctx, view, pal, h, backdropLook, time);
        const burn = Math.max(0, 1 - (stand.year - burnYear) / 8);
        drawFloor(ctx, view, stand, pal, burn);
        const wind = windBurst > 0 ? windSide * 3 * Math.min(1, windBurst) : 0;
        hits = drawTrees(ctx, view, stand, pal, s, Math.min(1, yearAcc), time, wind, fallStart);

        if (windBurst > 0) {
          // 台風の風のすじ
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * Math.min(1, windBurst)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          for (let i = 0; i < 40; i++) {
            const y = ((i * 97.3) % view.groundFront) * 0.95;
            const x =
              ((((i * 211.7 + time * 900 * windSide) % (w + 200)) + w + 200) % (w + 200)) - 100;
            ctx.moveTo(x, y);
            ctx.lineTo(x - windSide * 60, y + 6);
          }
          ctx.stroke();
        }
        if (fireGlow > 0) {
          const g = ctx.createLinearGradient(0, view.groundFront, 0, 0);
          const a = Math.min(1, fireGlow / 1.5) * (0.55 + 0.15 * Math.sin(time * 25));
          g.addColorStop(0, `rgba(255, 110, 20, ${a})`);
          g.addColorStop(0.5, `rgba(255, 60, 0, ${a * 0.4})`);
          g.addColorStop(1, 'rgba(60, 20, 0, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, view.groundFront + 20);
        }

        if (chartDirty) {
          const chart = panel.el.querySelector<HTMLCanvasElement>('.forest-chart canvas');
          if (chart) drawChart(chart, stand.history, hoverYear);
          updateReadout();
          chartDirty = false;
        }
      },

      resize(nw, nh, ndpr) {
        w = nw;
        h = nh;
        ratio = ndpr;
        view = makeView(stand.options.width);
        chartDirty = true;
      },

      pointer(e) {
        if (e.type !== 'down') return;
        if (tapMode === 'fell') {
          // いちばん手前にある、タップした位置の木を倒す
          let best: TreeDraw | null = null;
          for (const hit of hits) {
            const [x0, y0, x1, y1] = hit.box;
            if (e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
            if (height(SPECIES[hit.tree.species]!, hit.tree.d) < 2) continue;
            if (!best || hit.tree.z < best.tree.z) best = hit;
          }
          if (best) {
            stand.fell(best.tree);
            chartDirty = true;
          }
          return;
        }
        const z = unprojectZ(view, e.y);
        if (z === null) return;
        const x = view.standWidth / 2 + (e.x - w / 2) / (view.ppm * scaleAt(view, z));
        if (x < 0 || x >= stand.options.width) return;
        stand.addTree(tapMode, x, z, 2.5, 5);
        stand.computeLight();
      },

      stats: () => {
        const ba = stand.basalAreaBySpecies();
        const total = ba.reduce((a, b) => a + b, 0);
        let top = 0;
        for (let i = 1; i < ba.length; i++) if (ba[i]! > ba[top]!) top = i;
        const floor = stand.floorLight.reduce((a, b) => a + b, 0) / stand.floorLight.length;
        const s = season();
        const trees = stand.trees.filter((tr) => height(SPECIES[tr.species]!, tr.d) >= 2).length;
        return {
          [t({ ja: '年', en: 'Year' })]:
            `${stand.year}${s.visible ? ` · ${t(SEASONS[Math.floor(s.phase)]!)}` : ''}`,
          [t({ ja: '木（2 m 以上）', en: 'Trees (2 m+)' })]: trees,
          [t({ ja: '胸高断面積', en: 'Basal area' })]: `${total.toFixed(1)} m²/ha`,
          [t({ ja: '林床の明るさ', en: 'Floor light' })]: `${Math.round(floor * 100)}%`,
          [t({ ja: 'いちばん多い木', en: 'Dominant' })]: total > 0.5 ? t(SPECIES[top]!.name) : '—',
        };
      },

      dispose() {
        panel.dispose();
      },
    };
  },
};
