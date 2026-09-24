import { initWebGPU } from '../../core/gpu';
import { LANG_CHANGE, t, type Text } from '../../core/i18n';
import { mountPanel } from '../../core/panel';
import type { SimDefinition, SimInstance } from '../../core/sim';
import { GpuPendulums } from './gpu-pendulums';
import { G, angleGap, energy, flipped, rk4, type State } from './physics';

type Mode = 'fan' | 'map';

/** 積分の刻み（秒）。1/60 秒の画面 1 コマで 20 回 */
const DT = 1 / 1200;
const STEPS_PER_FRAME = 20;
/** マップ: この時間まで回らなければ「回らない」 */
const MAP_MAX_TIME = 30;

const POSES: { pose: [number, number, number]; label: Text }[] = [
  { pose: [2.0, 2.3, 2.6], label: { ja: 'ななめ', en: 'Tilted' } },
  { pose: [Math.PI / 2, Math.PI / 2, Math.PI / 2], label: { ja: '水平', en: 'Horizontal' } },
  { pose: [3.0, 3.05, 3.1], label: { ja: 'ほぼ逆さ', en: 'Nearly upright' } },
];
const SPREADS = [1e-9, 1e-6, 1e-3];
const GPU_COUNTS = [1000, 10000, 100000];
const CPU_COUNTS = [100, 300];

const superscript = (n: number) =>
  String(n)
    .split('')
    .map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹⁻'['0123456789-'.indexOf(c)] ?? c)
    .join('');
const pow10 = (x: number) => `10${superscript(Math.round(Math.log10(x)))}`;

export const pendulum: SimDefinition = {
  id: 'pendulum',
  title: { ja: '三重振り子とカオス', en: 'Triple Pendulum Chaos' },
  description: {
    ja: 'ほんの少しずつ違う角度で放した何万本もの三重振り子が、一瞬そろって揺れた後、花火のようにばらける。一回転するまでの時間を並べると、フラクタルの模様が現れる。',
    en: 'Tens of thousands of triple pendulums, released a hair apart, swing as one — then burst apart like fireworks. Map how long each takes to flip and a fractal appears.',
  },
  dt: 1 / 60,
  async create({ canvas, width, height, dpr, params }) {
    const gpu = params.get('cpu') === '1' ? null : await initWebGPU(canvas);
    const software =
      gpu !== null &&
      (gpu.adapter.info?.isFallbackAdapter || gpu.adapter.info?.architecture === 'swiftshader');
    const counts = gpu ? GPU_COUNTS : CPU_COUNTS;

    let w = width;
    let h = height;
    let ratio = dpr;
    let mode: Mode = params.get('mode') === 'map' ? 'map' : 'fan';
    let pose: [number, number, number] = [...POSES[0]!.pose];
    let spread = SPREADS[1]!;
    let count = Number(params.get('n')) || (gpu ? (software ? 1000 : 10000) : 100);
    let slow = false;
    // 倍精度で並走させる 2 本（両端の振り子）。ばらけた時刻と、エネルギーの保存を測る
    let ref: { a: State; b: State; e0: number; divergedAt: number | null; time: number } =
      makeReference();
    let mapTime = 0;
    let mapRes = 0;

    // 画面の上に重ねる文字（マップの軸など）
    const overlay = document.createElement('div');
    overlay.className = 'pendulum-overlay';
    canvas.parentElement!.append(overlay);

    const panel = mountPanel(
      canvas.parentElement!,
      () => `
        <p class="sim-desc">${t(
          mode === 'fan'
            ? {
                ja: `${count.toLocaleString()} 本の振り子を、1 本目の棒の角度だけ ${pow10(spread)} rad ずつずらして同時に放す。タップした方向に持ち上げて放し直す。`,
                en: `${count.toLocaleString()} pendulums released together, the first rod offset by ${pow10(spread)} rad each. Tap to lift them toward that point and release.`,
              }
            : {
                ja: '1 画素 = 1 本の振り子。横が 1 本目、縦が 2 本目の棒の最初の角度（3 本目は真下）。明るいほど早く一回転する。タップするとその振り子を見に行く。',
                en: 'One pixel = one pendulum. x: first rod angle, y: second rod angle (third hangs straight down). Brighter flips sooner. Tap to watch that pendulum.',
              },
        )}</p>
        <div class="sim-row">
          <button data-mode="fan" class="${mode === 'fan' ? 'on' : ''}">${t({ ja: 'ばらける振り子', en: 'Diverging swarm' })}</button>
          <button data-mode="map" class="${mode === 'map' ? 'on' : ''}">${t({ ja: '一回転の地図', en: 'Flip map' })}</button>
        </div>
        ${
          mode === 'fan'
            ? `<div class="sim-row">
                ${POSES.map((p, i) => `<button data-pose="${i}">${t(p.label)}</button>`).join('')}
                <button data-slow class="${slow ? 'on' : ''}">${t({ ja: 'スロー', en: 'Slow-mo' })}</button>
              </div>
              <div class="sim-row">
                <label>${t({ ja: '本数', en: 'Count' })}</label>
                ${counts.map((c) => `<button data-count="${c}" class="${c === count ? 'on' : ''}">${c.toLocaleString()}</button>`).join('')}
                <label>${t({ ja: 'ずれ', en: 'Offset' })}</label>
                ${SPREADS.map((s) => `<button data-spread="${s}" class="${s === spread ? 'on' : ''}">${pow10(s)}</button>`).join('')}
              </div>`
            : `<div class="pendulum-legend">
                <span>${t({ ja: 'すぐ回る', en: 'Flips fast' })}</span>
                <i></i>
                <span>${t({ ja: 'なかなか回らない', en: 'Flips late' })}</span>
                <b></b>
                <span>${t({ ja: `${MAP_MAX_TIME} 秒以内に回らない`, en: `No flip in ${MAP_MAX_TIME} s` })}</span>
              </div>
              <div class="sim-row"><button data-remap>${t({ ja: 'もう一度', en: 'Restart' })}</button></div>`
        }`,
      (el) => {
        el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
          b.addEventListener('click', () => switchMode(b.dataset.mode as Mode)),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-pose]').forEach((b) =>
          b.addEventListener('click', () => {
            pose = [...POSES[Number(b.dataset.pose)]!.pose];
            restartFan();
          }),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-count]').forEach((b) =>
          b.addEventListener('click', () => {
            count = Number(b.dataset.count);
            restartFan(true);
            panel.refresh();
          }),
        );
        el.querySelectorAll<HTMLButtonElement>('[data-spread]').forEach((b) =>
          b.addEventListener('click', () => {
            spread = Number(b.dataset.spread);
            restartFan();
            panel.refresh();
          }),
        );
        el.querySelector('[data-slow]')?.addEventListener('click', () => {
          slow = !slow;
          panel.refresh();
        });
        el.querySelector('[data-remap]')?.addEventListener('click', () => startMap());
      },
    );

    function makeReference() {
      const a: State = [pose[0] - spread / 2, pose[1], pose[2], 0, 0, 0];
      const b: State = [pose[0] + spread / 2, pose[1], pose[2], 0, 0, 0];
      return { a, b, e0: energy(a), divergedAt: null as number | null, time: 0 };
    }

    function fanInitial(): Float32Array {
      const data = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        const u = count > 1 ? i / (count - 1) - 0.5 : 0;
        data.set([pose[0] + u * spread, pose[1], pose[2], 0, 0, 0], i * 6);
      }
      return data;
    }

    function mapInitial(res: number): Float32Array {
      const data = new Float32Array(res * res * 6);
      for (let y = 0; y < res; y++) {
        for (let x = 0; x < res; x++) {
          const t1 = -Math.PI + ((x + 0.5) / res) * 2 * Math.PI;
          // 画面の上が +π
          const t2 = Math.PI - ((y + 0.5) / res) * 2 * Math.PI;
          data.set([t1, t2, 0, 0, 0, 0], (y * res + x) * 6);
        }
      }
      return data;
    }

    // ---- GPU / CPU の実体 ----
    let sim: GpuPendulums | null = null;
    let cpuStates: State[] = [];
    let cpuFlip: Float32Array = new Float32Array(0);
    let cpuTime = 0;
    let trailCanvas: HTMLCanvasElement | null = null;

    function restartFan(resize = false) {
      ref = makeReference();
      if (gpu) {
        if (resize || !sim || sim.n !== count) {
          sim?.dispose();
          sim = new GpuPendulums(gpu, fanInitial());
        } else {
          sim.upload(fanInitial());
        }
      } else {
        const data = fanInitial();
        cpuStates = Array.from(
          { length: count },
          (_, i) => Array.from(data.subarray(i * 6, i * 6 + 6)) as State,
        );
        cpuTime = 0;
        trailCanvas = null;
      }
    }

    function startMap() {
      mapRes = gpu ? (software ? 96 : w * h > 500000 ? 512 : 320) : 48;
      mapTime = 0;
      const data = mapInitial(mapRes);
      if (gpu) {
        sim?.dispose();
        sim = new GpuPendulums(gpu, data);
      } else {
        cpuStates = Array.from(
          { length: mapRes * mapRes },
          (_, i) => Array.from(data.subarray(i * 6, i * 6 + 6)) as State,
        );
        cpuFlip = new Float32Array(mapRes * mapRes);
        cpuTime = 0;
      }
    }

    function switchMode(next: Mode) {
      if (next === mode) return;
      mode = next;
      if (mode === 'fan') restartFan(true);
      else startMap();
      panel.refresh();
      updateOverlay();
    }

    const sceneHeight = () => Math.max(160, h - panel.el.offsetHeight - 10);
    const fanGeometry = () => {
      const sh = sceneHeight();
      const scale = (Math.min(w, sh) * 0.46) / 3;
      return { pivotX: w / 2, pivotY: sh / 2, scale };
    };
    const mapGeometry = () => {
      const sh = sceneHeight();
      const size = Math.min(w - 76, sh - 56);
      // 左に縦軸の目盛り（「−180°」）が入る余白を取る
      return { x: (w - size) / 2 + 22, y: (sh - size) / 2 + 6, size };
    };

    function updateOverlay() {
      if (mode !== 'map') {
        overlay.innerHTML = '';
        return;
      }
      const m = mapGeometry();
      overlay.innerHTML = `
        <span style="left:${m.x}px;top:${m.y + m.size + 4}px">−180°</span>
        <span style="left:${m.x + m.size / 2}px;top:${m.y + m.size + 4}px;transform:translateX(-50%)">${t({ ja: '1 本目の角度', en: 'rod 1 angle' })} θ₁</span>
        <span style="left:${m.x + m.size}px;top:${m.y + m.size + 4}px;transform:translateX(-100%)">180°</span>
        <span style="left:${m.x - 6}px;top:${m.y}px;transform:translateX(-100%)">180°</span>
        <span style="left:${m.x - 6}px;top:${m.y + m.size / 2}px;transform:translate(-100%,-50%)">θ₂</span>
        <span style="left:${m.x - 6}px;top:${m.y + m.size}px;transform:translate(-100%,-100%)">−180°</span>`;
    }
    window.addEventListener(LANG_CHANGE, updateOverlay);

    if (mode === 'fan') restartFan(true);
    else startMap();
    updateOverlay();

    let stepsThisSecond = 0;
    let stepRate = 0;
    let rateWindow = performance.now();

    const ctx2d = gpu ? null : canvas.getContext('2d');

    const instance: SimInstance & { readonly gpuSim: GpuPendulums | null } = {
      step() {
        const steps = mode === 'fan' && slow ? STEPS_PER_FRAME / 4 : STEPS_PER_FRAME;
        if (mode === 'fan') {
          // 倍精度の参照 2 本
          for (let k = 0; k < steps; k++) {
            ref.a = rk4(ref.a, DT);
            ref.b = rk4(ref.b, DT);
            ref.time += DT;
            if (ref.divergedAt === null && angleGap(ref.a, ref.b) > 0.2) ref.divergedAt = ref.time;
          }
        } else {
          if (mapTime >= MAP_MAX_TIME) return;
          mapTime += steps * DT;
        }
        const n = gpu ? sim!.n : cpuStates.length;
        stepsThisSecond += steps * n;

        if (gpu) {
          const enc = gpu.device.createCommandEncoder();
          sim!.encodeStep(enc, steps, DT, G);
          gpu.device.queue.submit([enc.finish()]);
        } else {
          // CPU: マップは 1 コマで進める量を減らす
          const cpuSteps = mode === 'map' ? 4 : steps;
          const dt = mode === 'map' ? (steps * DT) / cpuSteps : DT;
          for (let i = 0; i < cpuStates.length; i++) {
            let s = cpuStates[i]!;
            for (let k = 0; k < cpuSteps; k++) {
              s = rk4(s, dt);
              if (mode === 'map' && cpuFlip[i] === 0 && flipped(s))
                cpuFlip[i] = cpuTime + (k + 1) * dt;
            }
            cpuStates[i] = s;
          }
          cpuTime += cpuSteps * dt;
        }
      },

      render() {
        const now = performance.now();
        if (now - rateWindow > 1000) {
          stepRate = (stepsThisSecond * 1000) / (now - rateWindow);
          stepsThisSecond = 0;
          rateWindow = now;
        }
        const pw = Math.max(1, Math.round(w * ratio));
        const ph = Math.max(1, Math.round(h * ratio));
        if (gpu && sim) {
          const enc = gpu.device.createCommandEncoder();
          if (mode === 'fan') {
            const g = fanGeometry();
            sim.encodeFan(enc, {
              pivotX: g.pivotX * ratio,
              pivotY: g.pivotY * ratio,
              scale: g.scale * ratio,
              width: pw,
              height: ph,
              intensity: Math.min(1.5, 3 / Math.sqrt(sim.n)),
              trail: 0.86,
            });
          } else {
            const m = mapGeometry();
            sim.encodeMap(enc, {
              x: m.x * ratio,
              y: m.y * ratio,
              size: m.size * ratio,
              res: mapRes,
              width: pw,
              height: ph,
              maxTime: MAP_MAX_TIME,
            });
          }
          gpu.device.queue.submit([enc.finish()]);
          return;
        }
        if (ctx2d) drawCpu(ctx2d);
      },

      resize(nw, nh, ndpr) {
        w = nw;
        h = nh;
        ratio = ndpr;
        trailCanvas = null;
        updateOverlay();
      },

      pointer(e) {
        if (e.type !== 'down') return;
        if (mode === 'fan') {
          const g = fanGeometry();
          // 支点からタップした方向へ、3 本をまっすぐ持ち上げる
          const angle = Math.atan2(e.x - g.pivotX, e.y - g.pivotY);
          pose = [angle, angle + 0.02, angle + 0.04];
          restartFan();
          return;
        }
        const m = mapGeometry();
        const u = (e.x - m.x) / m.size;
        const v = (e.y - m.y) / m.size;
        if (u < 0 || u > 1 || v < 0 || v > 1) return;
        pose = [-Math.PI + u * 2 * Math.PI, Math.PI - v * 2 * Math.PI, 0];
        mode = 'fan';
        restartFan(true);
        panel.refresh();
        updateOverlay();
      },

      stats: () => {
        const time = mode === 'fan' ? ref.time : gpu ? mapTime : cpuTime;
        const base = {
          [t({ ja: '時間', en: 'Time' })]: `${time.toFixed(1)} ${t({ ja: '秒', en: 's' })}`,
          [t({ ja: '振り子', en: 'Pendulums' })]: (gpu
            ? sim!.n
            : cpuStates.length
          ).toLocaleString(),
          [t({ ja: '計算', en: 'Steps' })]:
            `${formatRate(stepRate)} RK4/${t({ ja: '秒', en: 's' })}`,
        };
        if (mode === 'map') return base;
        const drift = Math.abs((energy(ref.a) - ref.e0) / ref.e0);
        return {
          ...base,
          [t({ ja: '予測の限界', en: 'Predictable for' })]:
            ref.divergedAt === null
              ? t({ ja: 'まだそろっている', en: 'still together' })
              : `${ref.divergedAt.toFixed(2)} ${t({ ja: '秒', en: 's' })}`,
          [t({ ja: 'エネルギー誤差', en: 'Energy error' })]: `${(drift * 100).toPrecision(2)}%`,
        };
      },

      dispose() {
        window.removeEventListener(LANG_CHANGE, updateOverlay);
        overlay.remove();
        panel.dispose();
        sim?.dispose();
      },

      // テスト・確認用
      get gpuSim() {
        return sim;
      },
    };
    return instance;

    function drawCpu(ctx: CanvasRenderingContext2D) {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (mode === 'map') {
        ctx.fillStyle = '#05060c';
        ctx.fillRect(0, 0, w, h);
        const m = mapGeometry();
        const cell = m.size / mapRes;
        for (let i = 0; i < cpuFlip.length; i++) {
          const f = cpuFlip[i]!;
          if (f === 0) continue;
          const u = Math.max(0, Math.min(1, 1 - Math.log(f / 0.3) / Math.log(MAP_MAX_TIME / 0.3)));
          ctx.fillStyle = `rgb(${13 + 192 * u}, ${54 + 172 * u}, ${107 + 144 * u})`;
          ctx.fillRect(
            m.x + (i % mapRes) * cell,
            m.y + Math.floor(i / mapRes) * cell,
            cell + 0.5,
            cell + 0.5,
          );
        }
        return;
      }
      trailCanvas ??= Object.assign(document.createElement('canvas'), {
        width: canvas.width,
        height: canvas.height,
      });
      const tc = trailCanvas.getContext('2d')!;
      tc.setTransform(ratio, 0, 0, ratio, 0, 0);
      tc.globalCompositeOperation = 'source-over';
      tc.fillStyle = 'rgba(5, 6, 12, 0.18)';
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = 'lighter';
      const g = fanGeometry();
      cpuStates.forEach((s, i) => {
        const u = cpuStates.length > 1 ? i / (cpuStates.length - 1) : 0;
        tc.strokeStyle = `hsla(${190 + 200 * u}, 90%, 60%, 0.35)`;
        tc.beginPath();
        let x = g.pivotX;
        let y = g.pivotY;
        tc.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += Math.sin(s[k]!) * g.scale;
          y += Math.cos(s[k]!) * g.scale;
          tc.lineTo(x, y);
        }
        tc.stroke();
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(trailCanvas, 0, 0);
    }
  },
};

function formatRate(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return `${Math.round(v)}`;
}
