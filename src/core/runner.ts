import { advanceClock, type ClockState } from './clock';
import { createRng } from './rng';
import type { SimDefinition, SimInstance } from './sim';

export interface RunnerHandle {
  pause(): void;
  resume(): void;
  /** 一時停止中に n ステップ進めて描画する（デバッグ・スクショ用） */
  step(n?: number): void;
  setSpeed(speed: number): void;
  reset(): Promise<void>;
  dispose(): void;
  readonly instance: SimInstance;
  readonly paused: boolean;
  readonly frame: number;
}

/**
 * シミュレーションを canvas 上で回す。
 * URL パラメータ: seed=… (乱数シード), paused=1 (停止状態で開始), speed=… (時間倍率)
 */
export async function runSim(
  def: SimDefinition,
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
): Promise<RunnerHandle> {
  const dt = def.dt ?? 1 / 120;
  const seed = params.get('seed') ?? 'opus';
  let paused = params.get('paused') === '1';
  let speed = Number(params.get('speed') ?? 1) || 1;
  let frame = 0;
  let raf = 0;
  let last = performance.now();
  const clock: ClockState = { accumulator: 0 };

  const measure = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    return { width, height, dpr };
  };

  const create = async () => {
    const m = measure();
    return def.create({ canvas, ...m, rng: createRng(seed), params });
  };

  let instance = await create();

  const onResize = () => {
    const m = measure();
    instance.resize?.(m.width, m.height, m.dpr);
    instance.render(0);
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(canvas);

  const toLocal = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  let down = false;
  const onDown = (e: PointerEvent) => {
    down = true;
    canvas.setPointerCapture(e.pointerId);
    instance.pointer?.({ ...toLocal(e), down, type: 'down' });
  };
  const onMove = (e: PointerEvent) => instance.pointer?.({ ...toLocal(e), down, type: 'move' });
  const onUp = (e: PointerEvent) => {
    down = false;
    instance.pointer?.({ ...toLocal(e), down, type: 'up' });
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const tick = (now: number) => {
    const elapsed = Math.min(0.25, (now - last) / 1000) * speed;
    last = now;
    if (!paused) {
      const { steps, alpha } = advanceClock(clock, elapsed, { dt, maxSteps: 8 });
      for (let i = 0; i < steps; i++) instance.step(dt);
      instance.render(alpha);
      frame++;
    }
    raf = requestAnimationFrame(tick);
  };
  instance.render(0);
  raf = requestAnimationFrame(tick);

  return {
    get instance() {
      return instance;
    },
    get paused() {
      return paused;
    },
    get frame() {
      return frame;
    },
    pause: () => {
      paused = true;
    },
    resume: () => {
      paused = false;
      last = performance.now();
    },
    step: (n = 1) => {
      for (let i = 0; i < n; i++) instance.step(dt);
      instance.render(0);
    },
    setSpeed: (s) => {
      speed = s;
    },
    reset: async () => {
      instance.dispose?.();
      clock.accumulator = 0;
      instance = await create();
      instance.render(0);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      instance.dispose?.();
    },
  };
}
