import type { RunnerHandle } from './core/runner';

/** FPS・ステップ情報の表示とキーボード操作 */
export function mountHud(root: HTMLElement, runner: RunnerHandle): () => void {
  const el = document.createElement('div');
  el.className = 'hud';
  root.append(el);

  let frames = 0;
  let fps = 0;
  let lastSample = performance.now();
  let raf = 0;
  const update = (now: number) => {
    frames++;
    if (now - lastSample > 500) {
      fps = (frames * 1000) / (now - lastSample);
      frames = 0;
      lastSample = now;
      const lines = Object.entries(runner.instance.stats?.() ?? {}).map(([k, v]) => `${k} ${v}`);
      el.textContent = [`${fps.toFixed(0)} fps${runner.paused ? ' · 停止中' : ''}`, ...lines].join(
        '\n',
      );
    }
    raf = requestAnimationFrame(update);
  };
  raf = requestAnimationFrame(update);

  const speeds = [0.25, 0.5, 1, 2, 4];
  let speedIndex = 2;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      if (runner.paused) runner.resume();
      else runner.pause();
    } else if (e.key === '.') runner.step();
    else if (e.key === 'r') void runner.reset();
    else if (e.key === ']' || e.key === '[') {
      speedIndex = Math.max(0, Math.min(speeds.length - 1, speedIndex + (e.key === ']' ? 1 : -1)));
      runner.setSpeed(speeds[speedIndex]!);
    }
  };
  window.addEventListener('keydown', onKey);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    el.remove();
  };
}
