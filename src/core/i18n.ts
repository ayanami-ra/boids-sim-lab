/**
 * 日本語 / 英語の切り替え。
 * 文言は { ja, en } の組で持ち、表示するときに t() で選ぶ。
 * 選んだ言語はブラウザに保存し、未設定ならブラウザの言語設定から決める。
 */
export type Lang = 'ja' | 'en';
export type Text = Record<Lang, string>;

const STORAGE_KEY = 'lang';
export const LANG_CHANGE = 'langchange';

/** 保存済みの設定 → ブラウザの言語設定の順に決める。日本語以外は英語 */
export function pickLang(saved: string | null, browserLangs: readonly string[]): Lang {
  if (saved === 'ja' || saved === 'en') return saved;
  const first = browserLangs[0]?.toLowerCase() ?? '';
  return first.startsWith('ja') ? 'ja' : 'en';
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

let current: Lang | null = null;

/** 現在の言語。URL の ?lang= → 保存済みの設定 → ブラウザの言語設定の順 */
export function lang(): Lang {
  current ??= pickLang(
    new URLSearchParams(location.search).get('lang') ?? readSaved(),
    navigator.languages,
  );
  return current;
}

export const t = (text: Text): string => text[lang()];

/**
 * 言語を変えて保存し、langchange イベントを出す。
 * 各画面はこれを受けて文言だけを差し替える（動いているシミュレーションは止めない）
 */
export function setLang(next: Lang): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // 保存できなくても、このページ内では切り替わる
  }
  document.documentElement.lang = next;
  window.dispatchEvent(new Event(LANG_CHANGE));
}

/** 画面右上などに置く切り替えボタン */
export function langButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'lang-toggle';
  const ja = lang() === 'ja';
  b.textContent = ja ? 'English' : '日本語';
  b.setAttribute('aria-label', ja ? 'Switch to English' : '日本語に切り替え');
  b.addEventListener('click', () => setLang(ja ? 'en' : 'ja'));
  return b;
}
