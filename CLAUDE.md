# Boids Sim Lab

ブラウザで動くシミュレーション集。Vite + TypeScript（strict）、描画は Canvas2D / WebGPU。

## コマンド

- `npm run dev` — 開発サーバ（http://localhost:5173）
- `npm run check` — 型チェック + lint + format チェック + テスト。**push 前に必ず通す**
- `npm run build` — 本番ビルド（`dist/`）
- `npm run shot -- <sim-id> [steps] [query]` — dev サーバ起動中に、停止状態から `steps` だけ進めた
  canvas を `shots/<sim-id>.png` に保存する。ページでエラーが出たら終了コード 1。
  見た目に関わる変更をしたら撮って画像を確認すること。

## 構成

- `src/core/` — シミュレーションに依存しない基盤
  - `sim.ts` — `SimDefinition` / `SimInstance` のインターフェース
  - `runner.ts` — 固定タイムステップでの実行、ポインタ入力、リサイズ、`window.__sim` フック
  - `rng.ts` — シード付き乱数。**`Math.random()` は使わず `ctx.rng` を使う**（再現性のため）
  - `spatial-hash.ts` — 近傍探索用グリッド
  - `gpu.ts` — WebGPU 初期化（非対応なら `null`）
- `src/sims/<id>/index.ts` — シミュレーション 1 本。`src/registry.ts` に登録するとギャラリーに出る
- `src/sims/boids/` — 参照実装。新しいシミュレーションはこれを雛形にする
- `tests/` — Vitest。物理や数値計算のコアは DOM に依存しない関数に切り出してテストする

## シミュレーションを書くときの約束

- `step(dt)` は状態更新のみ、`render(alpha)` は描画のみ。`step` は固定 dt で呼ばれる
- 粒子などの大量の状態は `Float32Array` の SoA で持ち、`step` 内でオブジェクトを確保しない
- パラメータは URL クエリ（`?seed=…&n=…`）から読む。`seed`・`paused=1`・`speed` はランナーが解釈済み
- WebGPU を使う場合は `initWebGPU()` が `null` のときのフォールバック（または案内表示）を用意する
- 座標は CSS px。canvas の実解像度は `width * dpr`
- UI 文言・コメントは日本語
