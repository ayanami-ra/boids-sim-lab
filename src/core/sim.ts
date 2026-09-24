import type { Rng } from './rng';

/** シミュレーションが受け取る実行環境 */
export interface SimContext {
  canvas: HTMLCanvasElement;
  /** CSS ピクセル単位の論理サイズ */
  width: number;
  height: number;
  /** devicePixelRatio（canvas の実解像度 = width * dpr） */
  dpr: number;
  rng: Rng;
  params: URLSearchParams;
}

/** 起動中のシミュレーション 1 個 */
export interface SimInstance {
  /** 固定 dt（秒）で状態を 1 ステップ進める。描画はしない */
  step(dt: number): void;
  /** 現在の状態を描画する。alpha は次ステップへの補間係数 [0, 1) */
  render(alpha: number): void;
  resize?(width: number, height: number, dpr: number): void;
  /** ポインタ操作（キャンバス座標、CSS px） */
  pointer?(e: { x: number; y: number; down: boolean; type: 'down' | 'move' | 'up' }): void;
  /** HUD に出す追加情報 */
  stats?(): Record<string, string | number>;
  dispose?(): void;
}

/** ギャラリーに並ぶシミュレーションの定義 */
export interface SimDefinition {
  id: string;
  title: string;
  description: string;
  /** 物理の固定 dt（秒）。省略時 1/120 */
  dt?: number;
  create(ctx: SimContext): SimInstance | Promise<SimInstance>;
}
