/**
 * 固定タイムステップの積算器。描画フレームレートに関係なく物理を一定の dt で進める。
 * DOM に依存しない純粋な計算なのでテストできる。
 */
export interface ClockState {
  accumulator: number;
}

export interface ClockOptions {
  /** 1 ステップの秒数 */
  dt: number;
  /** 1 フレームで回す最大ステップ数（タブ復帰時の死のスパイラル防止） */
  maxSteps: number;
}

/** 経過秒数を受け取り、今フレームで実行すべきステップ数と補間係数 alpha を返す */
export function advanceClock(
  state: ClockState,
  elapsed: number,
  { dt, maxSteps }: ClockOptions,
): { steps: number; alpha: number } {
  state.accumulator += Math.max(0, elapsed);
  let steps = Math.floor(state.accumulator / dt);
  if (steps > maxSteps) {
    steps = maxSteps;
    state.accumulator = 0;
  } else {
    state.accumulator -= steps * dt;
  }
  return { steps, alpha: state.accumulator / dt };
}
