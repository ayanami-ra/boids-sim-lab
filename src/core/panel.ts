import { LANG_CHANGE } from './i18n';

/**
 * 画面下に置く操作パネル。render() が返す HTML を表示し、bind() でイベントをつなぐ。
 * 言語が切り替わったら描き直す。dispose() で取り外す。
 */
export function mountPanel(
  root: HTMLElement,
  render: () => string,
  bind: (panel: HTMLElement) => void,
): { el: HTMLElement; refresh: () => void; dispose: () => void } {
  const el = document.createElement('div');
  el.className = 'sim-panel';
  const refresh = () => {
    el.innerHTML = render();
    bind(el);
  };
  refresh();
  window.addEventListener(LANG_CHANGE, refresh);
  // パネル上の操作がキャンバスに伝わらないように
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.append(el);
  return {
    el,
    refresh,
    dispose: () => {
      window.removeEventListener(LANG_CHANGE, refresh);
      el.remove();
    },
  };
}
