import { initWebGPU } from '../../core/gpu';
import { LANG_CHANGE, lang, t, type Text } from '../../core/i18n';
import { transformPoint } from '../../core/mat4';
import type { SimDefinition, SimInstance } from '../../core/sim';
import { OrbitCamera } from './camera';
import { GpuNBody } from './gpu-nbody';
import { SCENARIOS, UNIT_TIME_MYR, buildScenario, type Particles } from './model';
import { energyFromStep, leapfrogStep } from './nbody-cpu';

/** 物理の 1 ステップ（シミュレーション内の時間単位。0.03 ≈ 0.14 Myr） */
const DT = 0.03;
/** 1 フレームで GPU に使わせたい時間（ミリ秒）。これに収まるようにステップ数を自動調整する */
const GPU_BUDGET_MS = 12;
/** 星 1 個を描くぼかしの半径（kpc）。大きめにして星の集まりを光の雲として見せる */
const STAR_RADIUS = 0.45;
const GPU_COUNTS = [4096, 8192, 16384, 32768, 65536];
const CPU_COUNTS = [512, 1024, 2048];

/** 粒子数が少ないほど軟化長を大きくして、粒子同士の近接散乱によるノイズを抑える */
const softeningFor = (n: number) => 0.25 * Math.cbrt(16384 / n);

export const galaxy: SimDefinition = {
  id: 'galaxy',
  title: { ja: '銀河衝突', en: 'Galaxy Collision' },
  description: {
    ja: '2 つの渦巻銀河の衝突を、星とダークマター全粒子の重力を直接計算する N 体シミュレーションで再現。',
    en: 'Two spiral galaxies collide in an N-body simulation that computes the gravity between every star and dark matter particle directly.',
  },
  dt: 1 / 60,
  async create({ canvas, width, height, dpr, rng, params }) {
    const scenario = SCENARIOS.find((s) => s.id === params.get('scenario')) ?? SCENARIOS[0]!;
    const gpu = params.get('cpu') === '1' ? null : await initWebGPU(canvas);
    const slowGpu = gpu !== null && isSoftwareAdapter(gpu.adapter);
    const counts = gpu ? GPU_COUNTS : CPU_COUNTS;
    const defaultN = gpu ? (slowGpu ? 2048 : 16384) : 1024;
    const n = Number(params.get('n')) || defaultN;
    const eps = softeningFor(n);
    const particles = buildScenario(scenario, n, eps, rng);
    const fixedSubsteps = Number(params.get('substeps')) || 0;

    let w = width;
    let h = height;
    let ratio = dpr;
    let showDarkMatter = params.get('dm') === '1';
    const camera = new OrbitCamera(
      canvas,
      Number(params.get('pitch') ?? scenario.cameraPitch),
      // 縦長の画面では横方向が狭いので、少し引いて全体を収める
      Number(params.get('dist') ?? scenario.cameraDistance * (width < height ? 1.4 : 1)),
    );
    if (params.has('yaw')) camera.yaw = (Number(params.get('yaw')) * Math.PI) / 180;
    const autoRotate = params.get('rotate') !== '0';
    const panel = mountPanel(canvas.parentElement!, {
      scenarioId: scenario.id,
      n,
      counts,
      showDarkMatter,
      mode: gpu
        ? slowGpu
          ? { ja: 'WebGPU（ソフトウェア）', en: 'WebGPU (software)' }
          : { ja: 'WebGPU', en: 'WebGPU' }
        : { ja: 'CPU（WebGPU 非対応）', en: 'CPU (no WebGPU)' },
      onDarkMatter: (v) => (showDarkMatter = v),
    });

    /** パネルの高さの半分だけ、描画の中心を上へずらす */
    const panelOffset = () => (h > 0 ? panel.el.offsetHeight / h : 0);

    const common = {
      resize(nw: number, nh: number, ndpr: number) {
        w = nw;
        h = nh;
        ratio = ndpr;
      },
    };

    // 性能の計測
    let lastFrame = performance.now();
    let stepsPerSecond = 0;
    let energy0: number | null = null;
    let energyError: number | null = null;
    const baseStats = (steps: number) => ({
      [t({ ja: '粒子', en: 'Particles' })]: n.toLocaleString(),
      [t({ ja: '経過', en: 'Time' })]: t({
        ja: `${Math.round(steps * DT * UNIT_TIME_MYR).toLocaleString()} 百万年`,
        en: `${Math.round(steps * DT * UNIT_TIME_MYR).toLocaleString()} Myr`,
      }),
      [t({ ja: '重力計算/秒', en: 'Gravity pairs/s' })]: formatBig(stepsPerSecond * n * n),
      [t({ ja: 'エネルギー誤差', en: 'Energy error' })]:
        energyError === null
          ? t({ ja: '計測中', en: 'measuring' })
          : `${(energyError * 100).toPrecision(2)}%`,
    });
    const recordEnergy = (total: number) => {
      if (energy0 === null) energy0 = total;
      else energyError = (total - energy0) / Math.abs(energy0);
    };

    if (gpu) {
      const sim = new GpuNBody(gpu, particles, eps, DT);
      let substeps = fixedSubsteps || 2;
      let pending = 0;
      let measuring = false;
      let lastEnergyAt = 0;
      let stepWindow = { t: performance.now(), steps: 0 };

      const instance: SimInstance & { gpu: GpuNBody } = {
        gpu: sim,
        ...common,
        step() {
          if (fixedSubsteps) {
            const enc = gpu.device.createCommandEncoder();
            sim.encodeSteps(enc, fixedSubsteps);
            gpu.device.queue.submit([enc.finish()]);
          } else {
            pending++;
          }
        },
        render() {
          const now = performance.now();
          const frameSeconds = Math.min(0.1, (now - lastFrame) / 1000);
          lastFrame = now;
          const pw = Math.max(1, Math.round(w * ratio));
          const ph = Math.max(1, Math.round(h * ratio));
          const focalPx = camera.update(pw, ph, autoRotate, frameSeconds, panelOffset());

          const enc = gpu.device.createCommandEncoder();
          const count = fixedSubsteps ? 0 : substeps * Math.min(pending, 2);
          pending = 0;
          sim.encodeSteps(enc, count);
          sim.encodeDraw(enc, {
            viewProj: camera.viewProj,
            width: pw,
            height: ph,
            focalPx,
            starRadius: STAR_RADIUS,
            brightness: 0.3 * Math.sqrt(16384 / n),
            showDarkMatter,
          });
          const submitted = performance.now();
          gpu.device.queue.submit([enc.finish()]);

          // GPU が実際にかかった時間から、次フレームのステップ数を決める
          if (count > 0 && !measuring && !fixedSubsteps) {
            measuring = true;
            void gpu.device.queue.onSubmittedWorkDone().then(() => {
              measuring = false;
              const msPerStep = Math.max(0.01, (performance.now() - submitted) / count);
              const target = Math.max(1, Math.min(256, GPU_BUDGET_MS / msPerStep));
              substeps = Math.max(1, Math.round(substeps * 0.7 + target * 0.3));
            });
          }
          stepWindow.steps += count;
          if (now - stepWindow.t > 1000) {
            stepsPerSecond = (stepWindow.steps * 1000) / (now - stepWindow.t);
            stepWindow = { t: now, steps: 0 };
          }
          if (now - lastEnergyAt > 1000) {
            lastEnergyAt = now;
            void sim.readEnergy().then((e) => e && recordEnergy(e.total));
          }
        },
        stats: () => baseStats(sim.steps),
        dispose() {
          camera.dispose();
          panel.dispose();
          sim.dispose();
        },
      };
      return instance;
    }

    // ---- CPU フォールバック（Canvas2D） ----
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is not available');
    const acc = new Float32Array(n * 4);
    const masses = particles.pos.filter((_, i) => i % 4 === 3);
    leapfrogStep(particles, eps, DT, acc, 0.5, 0);
    let steps = 0;
    let lastEnergyAt = 0;
    let stepWindow = { t: performance.now(), steps: 0 };
    const colors = ['#9fb8ff', '#ffc680', '#7a5cff'];

    return {
      ...common,
      step() {
        leapfrogStep(particles, eps, DT, acc);
        steps++;
        stepWindow.steps++;
      },
      render() {
        const now = performance.now();
        const frameSeconds = Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        if (now - stepWindow.t > 1000) {
          stepsPerSecond = (stepWindow.steps * 1000) / (now - stepWindow.t);
          stepWindow = { t: now, steps: 0 };
        }
        if (now - lastEnergyAt > 1000 && steps > 0) {
          lastEnergyAt = now;
          recordEnergy(energyFromStep(particles.vel, acc, masses, DT).total);
        }
        camera.update(w, h, autoRotate, frameSeconds, panelOffset());
        drawCpu(ctx, particles, camera.viewProj, w, h, ratio, colors, showDarkMatter);
      },
      stats: () => baseStats(steps),
      dispose() {
        camera.dispose();
        panel.dispose();
      },
    };
  },
};

/** CPU で WebGPU をエミュレートしているアダプタ（とても遅い）か */
function isSoftwareAdapter(adapter: GPUAdapter): boolean {
  return adapter.info?.isFallbackAdapter === true || adapter.info?.architecture === 'swiftshader';
}

function drawCpu(
  ctx: CanvasRenderingContext2D,
  p: Particles,
  viewProj: Float32Array,
  w: number,
  h: number,
  dpr: number,
  colors: string[],
  showDarkMatter: boolean,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#02030a';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < p.count; i++) {
    const component = Math.round(p.vel[i * 4 + 3]!) % 3;
    if (component === 2 && !showDarkMatter) continue;
    const [x, y, , cw] = transformPoint(
      viewProj,
      p.pos[i * 4]!,
      p.pos[i * 4 + 1]!,
      p.pos[i * 4 + 2]!,
    );
    if (cw <= 0) continue;
    const sx = (x / cw) * 0.5 * w + 0.5 * w;
    const sy = (-y / cw) * 0.5 * h + 0.5 * h;
    ctx.globalAlpha = component === 2 ? 0.15 : 0.7;
    ctx.fillStyle = colors[component]!;
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function formatBig(v: number): string {
  if (lang() === 'en') {
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)} trillion`;
    if (v >= 1e9) return `${(v / 1e9).toFixed(1)} billion`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(1)} million`;
    return Math.round(v).toLocaleString('en');
  }
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)} 兆回`;
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)} 億回`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(0)} 万回`;
  return `${Math.round(v)} 回`;
}

/** 画面下のシナリオ・粒子数・表示切り替えパネル。言語が変わったら文言だけ描き直す */
function mountPanel(
  root: HTMLElement,
  opts: {
    scenarioId: string;
    n: number;
    counts: number[];
    showDarkMatter: boolean;
    mode: Text;
    onDarkMatter: (v: boolean) => void;
  },
): { el: HTMLElement; dispose: () => void } {
  const panel = document.createElement('div');
  panel.className = 'galaxy-panel';
  const current = SCENARIOS.find((s) => s.id === opts.scenarioId)!;
  const counts = opts.counts.includes(opts.n)
    ? opts.counts
    : [...opts.counts, opts.n].sort((a, b) => a - b);
  let showDarkMatter = opts.showDarkMatter;

  const navigate = (changes: Record<string, string>) => {
    const q = new URLSearchParams(location.search);
    for (const [k, v] of Object.entries(changes)) q.set(k, v);
    history.replaceState(null, '', `?${q}${location.hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };

  const render = () => {
    panel.innerHTML = `
      <p class="galaxy-desc">${t(current.description)}</p>
      <div class="galaxy-row">
        ${SCENARIOS.map(
          (s) =>
            `<button data-scenario="${s.id}" class="${s.id === current.id ? 'on' : ''}">${t(s.title)}</button>`,
        ).join('')}
      </div>
      <div class="galaxy-row">
        <label>${t({ ja: '粒子数', en: 'Particles' })}
          <select data-n>
            ${counts.map((c) => `<option value="${c}" ${c === opts.n ? 'selected' : ''}>${c.toLocaleString()}</option>`).join('')}
          </select>
        </label>
        <label><input type="checkbox" data-dm ${showDarkMatter ? 'checked' : ''}/> ${t({ ja: 'ダークマターを表示', en: 'Show dark matter' })}</label>
        <span class="galaxy-mode">${t(opts.mode)}</span>
      </div>`;
    panel
      .querySelectorAll<HTMLButtonElement>('[data-scenario]')
      .forEach((b) =>
        b.addEventListener('click', () => navigate({ scenario: b.dataset.scenario! })),
      );
    panel
      .querySelector<HTMLSelectElement>('[data-n]')!
      .addEventListener('change', (e) => navigate({ n: (e.target as HTMLSelectElement).value }));
    panel.querySelector<HTMLInputElement>('[data-dm]')!.addEventListener('change', (e) => {
      showDarkMatter = (e.target as HTMLInputElement).checked;
      opts.onDarkMatter(showDarkMatter);
    });
  };
  render();
  window.addEventListener(LANG_CHANGE, render);
  // パネル上の操作でカメラが回らないように
  panel.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.append(panel);
  return {
    el: panel,
    dispose: () => {
      window.removeEventListener(LANG_CHANGE, render);
      panel.remove();
    },
  };
}
