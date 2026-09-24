/**
 * 種ごとの胸高断面積の積み上げ面グラフ（森の中身が年とともにどう入れ替わるか）。
 * 色はデータ可視化の既定パレット（暗い面用）の 1〜4 番を種の固定順で使い、
 * 凡例と右端の直接ラベルで色だけに頼らず種を示す。
 */
import { t } from '../../core/i18n';
import { SPECIES } from './stand';

/** シラカバ・アカマツ・ミズナラ・ブナの順。暗い面（#0b0e18）で検証済み */
export const SPECIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const SURFACE = '#0b0e18';
const TEXT_MUTED = '#8a93a8';

export function drawChart(
  canvas: HTMLCanvasElement,
  history: Float32Array[],
  hoverYear: number | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const labelW = 64;
  const plotW = w - labelW - 4;
  const top = 4;
  const bottom = h - 14;
  const years = Math.max(100, history.length);
  let max = 40;
  for (const row of history) max = Math.max(max, row.reduce((a, b) => a + b, 0) * 1.1);
  const X = (y: number) => (y / years) * plotW;
  const Y = (v: number) => bottom - (v / max) * (bottom - top);

  // 目盛り: 控えめな横線と年の数字
  ctx.strokeStyle = 'rgba(138, 147, 168, 0.18)';
  ctx.lineWidth = 1;
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = '10px ui-monospace, monospace';
  for (const v of [20, 40, 60]) {
    if (v > max) continue;
    ctx.beginPath();
    ctx.moveTo(0, Y(v) + 0.5);
    ctx.lineTo(plotW, Y(v) + 0.5);
    ctx.stroke();
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', 0, bottom + 2);
  ctx.textAlign = 'right';
  ctx.fillText(`${years}${t({ ja: '年', en: ' yr' })}`, plotW, bottom + 2);

  if (history.length > 1) {
    // 下から順に積み上げる。帯の境目に面の色の 2px の隙間を入れる
    const cumulative = history.map(() => 0);
    for (let s = 0; s < SPECIES.length; s++) {
      const lower = cumulative.slice();
      for (let i = 0; i < history.length; i++) cumulative[i]! += history[i]![s]!;
      ctx.fillStyle = SPECIES_COLORS[s]!;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(lower[0]!));
      for (let i = 0; i < history.length; i++) ctx.lineTo(X(i + 1), Y(cumulative[i]!));
      for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(X(i + 1), Y(lower[i]!));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = SURFACE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const p = [X(i + 1), Y(cumulative[i]!)] as const;
        if (i === 0) ctx.moveTo(...p);
        else ctx.lineTo(...p);
      }
      ctx.stroke();
    }

    // 右端の直接ラベル（量のある種だけ、重ならないように）
    const last = history[history.length - 1]!;
    const total = last.reduce((a, b) => a + b, 0);
    let base = 0;
    let lastY = Infinity;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '11px system-ui, sans-serif';
    for (let s = 0; s < SPECIES.length; s++) {
      const v = last[s]!;
      const mid = Y(base + v / 2);
      base += v;
      if (total <= 0 || v / total < 0.08) continue;
      const y = Math.min(mid, lastY - 12);
      lastY = y;
      ctx.fillStyle = SPECIES_COLORS[s]!;
      ctx.fillRect(plotW + 6, y - 4, 8, 8);
      ctx.fillStyle = '#e6e9f2';
      ctx.fillText(t(SPECIES[s]!.name), plotW + 17, y);
    }
  }

  if (hoverYear !== null && hoverYear >= 1 && hoverYear <= history.length) {
    const x = X(hoverYear);
    ctx.strokeStyle = 'rgba(230, 233, 242, 0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top);
    ctx.lineTo(x + 0.5, bottom);
    ctx.stroke();
  }
}

/** グラフ上の x 座標から年を求める */
export function chartYearAt(canvas: HTMLCanvasElement, clientX: number, historyLength: number) {
  const rect = canvas.getBoundingClientRect();
  const plotW = rect.width - 64 - 4;
  const years = Math.max(100, historyLength);
  const year = Math.round(((clientX - rect.left) / plotW) * years);
  return year >= 1 && year <= historyLength ? year : null;
}
