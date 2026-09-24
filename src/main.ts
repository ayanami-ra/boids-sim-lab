import './style.css';
import { runSim, type RunnerHandle } from './core/runner';
import { mountHud } from './hud';
import { sims } from './registry';

declare global {
  interface Window {
    /** Playwright やコンソールから操作するためのフック */
    __sim?: RunnerHandle;
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | null = null;

function gallery() {
  app.innerHTML = `
    <main class="gallery">
      <h1>Boids Sim Lab</h1>
      <p class="lead">ブラウザで動くシミュレーション集</p>
      <ul>${sims
        .map(
          (s) =>
            `<li><a href="#/${s.id}"><strong>${s.title}</strong><span>${s.description}</span></a></li>`,
        )
        .join('')}</ul>
    </main>`;
}

async function route() {
  cleanup?.();
  cleanup = null;
  window.__sim = undefined;
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const def = sims.find((s) => s.id === id);
  if (!def) return gallery();

  app.innerHTML = `
    <div class="stage">
      <canvas></canvas>
      <a class="back" href="#/">← 一覧</a>
      <div class="help">Space 停止/再開 · . 1 ステップ · [ ] 速度 · R リセット</div>
    </div>`;
  const stage = app.querySelector<HTMLDivElement>('.stage')!;
  const canvas = stage.querySelector('canvas')!;
  const runner = await runSim(def, canvas, new URLSearchParams(location.search));
  const unmountHud = mountHud(stage, runner);
  window.__sim = runner;
  cleanup = () => {
    unmountHud();
    runner.dispose();
  };
}

window.addEventListener('hashchange', () => void route());
void route();
