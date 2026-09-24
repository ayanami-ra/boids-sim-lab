import './style.css';
import { LANG_CHANGE, langButton, lang, t } from './core/i18n';
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
      <p class="lead">${t({ ja: 'ブラウザで動くシミュレーション集', en: 'Simulations that run in your browser' })}</p>
      <ul>${sims
        .map(
          (s) =>
            `<li><a href="#/${s.id}"><strong>${t(s.title)}</strong><span>${t(s.description)}</span></a></li>`,
        )
        .join('')}</ul>
    </main>`;
  app.append(langButton());
}

async function route() {
  document.documentElement.lang = lang();
  cleanup?.();
  cleanup = null;
  window.__sim = undefined;
  const id = location.hash.replace(/^#\/?/, '').split('?')[0];
  const def = sims.find((s) => s.id === id);
  if (!def) return gallery();

  app.innerHTML = `
    <div class="stage">
      <canvas></canvas>
      <a class="back" href="#/"></a>
      <div class="help"></div>
    </div>`;
  const stage = app.querySelector<HTMLDivElement>('.stage')!;
  labelStage(stage);
  const canvas = stage.querySelector('canvas')!;
  const runner = await runSim(def, canvas, new URLSearchParams(location.search));
  const unmountHud = mountHud(stage, runner);
  window.__sim = runner;
  cleanup = () => {
    unmountHud();
    runner.dispose();
  };
}

/** シミュレーション画面の共通部分の文言（言語切り替えのたびに呼ぶ） */
function labelStage(stage: HTMLElement) {
  stage.querySelector('.back')!.textContent = t({ ja: '← 一覧', en: '← All' });
  stage.querySelector('.help')!.textContent = t({
    ja: 'Space 停止/再開 · . 1 ステップ · [ ] 速度 · R リセット',
    en: 'Space pause/resume · . step · [ ] speed · R reset',
  });
  stage.querySelector('.lang-toggle')?.remove();
  stage.append(langButton());
}

window.addEventListener('hashchange', () => void route());
window.addEventListener(LANG_CHANGE, () => {
  const stage = app.querySelector<HTMLElement>('.stage');
  if (stage) labelStage(stage);
  else gallery();
});
void route();
