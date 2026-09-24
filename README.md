# Boids Sim Lab

ブラウザで動くインタラクティブなシミュレーション集。

```sh
npm install
npm run dev      # http://localhost:5173
npm run check    # 型チェック・lint・フォーマット・テスト
```

## シミュレーション

- **銀河衝突** — 2 つの渦巻銀河（星の円盤・バルジ・ダークマターのハロー）の全粒子どうしの重力を
  WebGPU で直接計算する N 体シミュレーション。潮汐の尾、リング銀河、合体して楕円銀河になるまでを再現する。
  シナリオは「アンテナ」「ねずみ」「子持ち銀河」「車輪」の 4 つ。ドラッグで回転、ピンチ・ホイールでズーム
- **Boids** — 群れのシミュレーション（雛形）

## 操作

| キー    | 動作                  |
| ------- | --------------------- |
| Space   | 停止 / 再開           |
| `.`     | 1 ステップ進める      |
| `[` `]` | 速度を下げる / 上げる |
| R       | リセット              |

画面のボタンで日本語 / English を切り替えられます（`?lang=en` でも指定可）。

URL クエリで条件を変えられます: `?seed=hello&n=3000#/boids`

## シミュレーションを追加する

1. `src/sims/<id>/index.ts` に `SimDefinition` を書く（`src/sims/boids` が雛形）
2. `src/registry.ts` の配列に追加する

詳しい約束事は [CLAUDE.md](./CLAUDE.md) を参照。

## デプロイ

`main` に push すると GitHub Actions が GitHub Pages へデプロイします
（リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください）。
