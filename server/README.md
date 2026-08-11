# バックエンド（サブスクリプション用プロキシ）

`app/`（GitHub Pages で配信する静的サイト本体）とは別に、**Vercel へ単独でデプロイする**小さな
プロキシです。サブスク会員だけが Google Maps Platform の機能（3D映像・ルート検索・標高・
2Dフォールバックの背景地図）を使えるようにするために存在します。詳しい設計は
[`docs/virtual-cycling-requirements.md` §7.5](../docs/virtual-cycling-requirements.md) を参照してください。

**BYOK（自分の API キーを設定画面に貼る）は、このバックエンドが無くても・落ちていても
これまでどおり動きます。** ここは追加の課金導線であり、無料の使い方を置き換えるものではありません。

## 構成

| ファイル | 役割 |
|---|---|
| `api/maps/routes.js` | Routes API の代理取得（系統A） |
| `api/maps/elevation.js` | Elevation API の代理取得（系統A） |
| `api/maps/staticmap.js` | Static Maps API の代理取得（系統A、画像バイト列を中継） |
| `api/maps/key.js` | Maps JavaScript API ローダー用キーの配布（系統B） |
| `lib/licenses.js` | Lemon Squeezy のライセンスAPIへの照会・キャッシュ |
| `lib/requireLicense.js` | 4エンドポイント共通のライセンス確認ミドルウェア |
| `lib/cors.js` | フロントエンド（別オリジン）からのアクセス許可 |

系統A・系統Bの違い（なぜ2つに分かれているか）は `app/js/config.js` 冒頭のコメントと
要件定義書 7.5 を参照してください。要点だけ言うと、**系統Bで配布されるキーは配布された時点で
ブラウザから見えます**。3D Tiles / Street View は SDK 内部が直接 Google を叩く仕様のため、
これ以上は隠せません（バックエンドが提供するのは秘匿性ではなく認可と即時失効性です）。

## デプロイ手順（Phase B）

1. **Google Cloud 側でAPIキーを2本発行する**（1本を使い回さない。系統Aはサーバー間通信のため
   Referer ヘッダーが付かず、リファラ制限キーとは併用できないため）
   - `GOOGLE_MAPS_SERVER_KEY`: 系統A用。リファラ制限は掛けない代わりに、日次クォータ上限と
     予算アラートを必ず設定する
   - `GOOGLE_MAPS_LOADER_KEY`: 系統B用。HTTPリファラ制限を `kuzu-noha.github.io/github.io/*` に設定する
   - 両方とも、有効化するAPIを実際に使うものだけに絞る（API制限）
2. **Lemon Squeezy でサブスク商品を作成**し、ライセンスキー発行を有効にする（Licensing機能）
   - ⚠️ `lib/licenses.js` のエンドポイント・レスポンス形状はこのコード作成時点の想定です。
     デプロイ前に [Lemon Squeezy License API の最新ドキュメント](https://docs.lemonsqueezy.com/help/licensing)
     と突き合わせて確認してください
3. **Vercelで新規プロジェクトを作成**し、このリポジトリを接続する。プロジェクト設定の
   **Root Directory を `server` に設定**する（`app/`側はこれまでどおりGitHub Pagesのまま）
4. Vercel の Environment Variables に `.env.example` の内容を設定する
5. **Vercel Hobby（無料）プランは商用利用不可**。実際に課金を始める時点で **Pro（$20/月〜）に
   アップグレードする**（実費が発生するので、他の手順が全部終わってから最後に行う）
6. デプロイ後、`app/js/config.js` の以下2つの定数を実際の値に差し替える
   - `BACKEND_BASE_URL`: この Vercel プロジェクトの実デプロイURL
   - `SUBSCRIBE_URL`: 手順2で作った Lemon Squeezy 商品のチェックアウトURL
7. `docs/legal/` 配下（特定商取引法に基づく表記・利用規約・プライバシーポリシー）の
   テンプレートに実データ（事業者情報・価格・返金ポリシー等）を埋め、アプリから
   たどれる場所（フッター等）にリンクを追加する。特定商取引法上、価格を確定させずに
   課金を開始することはできないため、この手順は2〜6と並行して進めておく

## ローカルでの動作確認

```bash
cd server
npm install -g vercel   # 未導入の場合
vercel dev
```

Lemon Squeezy の実クレデンシャルが無くても、`lib/licenses.js` の `isLicenseActive` は
`fetchImpl` を差し替えられる設計になっているため、モックした `fetch` でロジック単体の
動作確認ができます（`test/unit.mjs` 参照）。実際の決済〜ライセンス発行〜アプリでの
有効化までの通しテストは、Lemon Squeezy 側の実アカウント（テストモード可）を
用意してから行ってください。
