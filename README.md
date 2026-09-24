# Boids Sim Lab

ブラウザで動くインタラクティブなシミュレーション集。

```sh
npm install
npm run dev      # http://localhost:5173
npm run check    # 型チェック・lint・フォーマット・テスト
```

## 操作

| キー    | 動作                  |
| ------- | --------------------- |
| Space   | 停止 / 再開           |
| `.`     | 1 ステップ進める      |
| `[` `]` | 速度を下げる / 上げる |
| R       | リセット              |

URL クエリで条件を変えられます: `?seed=hello&n=3000#/boids`

## シミュレーションを追加する

1. `src/sims/<id>/index.ts` に `SimDefinition` を書く（`src/sims/boids` が雛形）
2. `src/registry.ts` の配列に追加する

詳しい約束事は [CLAUDE.md](./CLAUDE.md) を参照。

## デプロイ

`main` に push すると GitHub Actions が GitHub Pages へデプロイします
（リポジトリの Settings → Pages → Source を「GitHub Actions」にしてください）。
