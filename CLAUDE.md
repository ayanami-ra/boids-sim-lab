# Boids Sim Lab

ブラウザで動くシミュレーション集。Vite + TypeScript（strict）、描画は Canvas2D / WebGPU。

## コマンド

- `npm run dev` — 開発サーバ（http://localhost:5173）
- `npm run check` — 型チェック + lint + format チェック + テスト。**push 前に必ず通す**
- `npm run build` — 本番ビルド（`dist/`）
- `npm run shot -- <sim-id> [steps] [query]` — dev サーバ起動中に、停止状態から `steps` だけ進めた
  canvas を `shots/<sim-id>.png` に保存する。ページでエラーが出たら終了コード 1。
  見た目に関わる変更をしたら撮って画像を確認すること。
- `npm run timeline -- <sim-id> "<query>" <ステップ,ステップ,…>` — 1 回の実行の途中経過を
  `shots/<sim-id>-<ステップ>.png` として連続で撮る（時間発展を確かめる用）
- `npm run verify:gpu` — 銀河衝突の GPU 計算が CPU 版（ユニットテスト済み）と一致するかをブラウザで確認。
  `src/sims/galaxy/shaders.ts` や `gpu-nbody.ts` を変えたら必ず実行する

スクリーンショット系のスクリプトはヘッドレス Chromium の WebGPU（SwiftShader、CPU で動くので遅い）を使う。
銀河衝突は `n=2048`〜`4096` 程度にしないと終わらない。

## 構成

- `src/core/` — シミュレーションに依存しない基盤
  - `sim.ts` — `SimDefinition` / `SimInstance` のインターフェース
  - `runner.ts` — 固定タイムステップでの実行、ポインタ入力、リサイズ、`window.__sim` フック
  - `rng.ts` — シード付き乱数。**`Math.random()` は使わず `ctx.rng` を使う**（再現性のため）
  - `spatial-hash.ts` — 近傍探索用グリッド
  - `gpu.ts` — WebGPU 初期化（非対応なら `null`）
  - `i18n.ts` — 日本語 / 英語の切り替え。URL の `?lang=en` → 保存済みの設定 → ブラウザの言語設定の順で決まる
- `src/sims/<id>/index.ts` — シミュレーション 1 本。`src/registry.ts` に登録するとギャラリーに出る
- `src/sims/boids/` — 参照実装。新しいシミュレーションはこれを雛形にする
- `src/sims/galaxy/` — 銀河衝突の N 体シミュレーション（WebGPU、非対応なら CPU + Canvas2D）
  - `model.ts` — 初期条件（円盤・バルジ・ハローの分布、軌道、シナリオ）。単位系は G=1, kpc, 1e10 太陽質量。
    1 シナリオの銀河は 2〜`MAX_GALAXIES`（4）個。2 個は放物線軌道（`pair`）、3〜4 個は収縮する銀河群（`group`）
  - `nbody-cpu.ts` — 直接総和とリープフロッグ積分の CPU 版。GPU 版と同じ式で、テストの基準
  - `shaders.ts` — WGSL（重力計算、描画、トーンマップ）
  - `gpu-nbody.ts` — GPU バッファとパイプライン、エネルギーの読み出し
  - URL クエリ: `scenario`, `n`, `dm=1`, `cpu=1`, `substeps`（固定するとステップ数が決定的になる）,
    `yaw` / `pitch` / `dist`（カメラ、度と kpc）, `rotate=0`（自動回転を止める）
- `tests/` — Vitest。物理や数値計算のコアは DOM に依存しない関数に切り出してテストする

## シミュレーションを書くときの約束

- `step(dt)` は状態更新のみ、`render(alpha)` は描画のみ。`step` は固定 dt で呼ばれる
- 粒子などの大量の状態は `Float32Array` の SoA で持ち、`step` 内でオブジェクトを確保しない
- パラメータは URL クエリ（`?seed=…&n=…`）から読む。`seed`・`paused=1`・`speed` はランナーが解釈済み
- WebGPU を使う場合は `initWebGPU()` が `null` のときのフォールバック（または案内表示）を用意する
- `navigator.gpu.requestAdapter()` を 2 回呼ばない（Chrome で最初の device が失われる）。アダプタ情報は
  `initWebGPU()` の返り値の `adapter` を使う
- 座標は CSS px。canvas の実解像度は `width * dpr`
- 画面に出す文言は日本語と英語の両方を `{ ja, en }`（`Text` 型）で書き、`t()` で表示する（`src/core/i18n.ts`）。
  言語が切り替わると `langchange` イベントが出るので、固定の文言を持つ DOM はそれを受けて描き直す
  （シミュレーションは止めない）。`stats()` は呼ばれるたびに `t()` を通すので対応不要
- コメントは日本語
