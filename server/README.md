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
| `api/subscribe/complete.js` | Stripe Checkout 完了後、ライセンスキーを発行する |
| `lib/licenses.js` | Stripe への顧客・サブスクリプション照会・キャッシュ |
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
2. **Stripeでサブスク用の商品（Price）を作成**し、**Payment Link** を発行する
   - Payment Link の「支払い後」設定で、下記URLへリダイレクトするようにしておく
     （`{CHECKOUT_SESSION_ID}` はStripeが実際のセッションIDに置換して埋め込むプレースホルダー）
     ```
     https://kuzu-noha.github.io/github.io/app/?checkout_session_id={CHECKOUT_SESSION_ID}
     ```
   - アプリはこのリダイレクトを検知して `api/subscribe/complete.js` を呼び、Stripeの
     Checkout Session からライセンスキーを自動発行・保存する（`app/js/main.js` の
     `bindLicenseSetup` 参照）。動作確認が済むまでは Stripe のテストモードで進めて良い
3. **Vercelで新規プロジェクトを作成**し、このリポジトリを接続する。プロジェクト設定の
   **Root Directory を `server` に設定**する（`app/`側はこれまでどおりGitHub Pagesのまま）
   > ⚠️ **つまずきやすい点**: インポート直後はリポジトリの**デフォルトブランチ**（`main`）を
   > 元にフォルダ一覧が作られる。`main` に `server/` が無い場合、Root Directoryの選択肢に
   > `server` が出てこない。その場合は一旦そのままプロジェクトを作成し、作成後に
   > **Settings → Build and Deployment → Root Directory** を `server` に変更する。
   > 「Redeploy」は元のデプロイと同じブランチ・コミットのまま再実行されるため、正しい
   > ブランチに新しくpushしてプレビューデプロイを発生させ、**Deployments タブの「…」→
   > Promote to Production** で本番に昇格させること
4. Vercel の Environment Variables に `.env.example` の内容を設定する（`STRIPE_SECRET_KEY`
   はStripeダッシュボードの「開発者」→「APIキー」から取得する）
5. **Vercel Hobby（無料）プランは商用利用不可**。実際に課金を始める時点で **Pro（$20/月〜）に
   アップグレードする**（実費が発生するので、他の手順が全部終わってから最後に行う）
6. デプロイ後、`app/js/config.js` の以下2つの定数を実際の値に差し替える
   - `BACKEND_BASE_URL`: この Vercel プロジェクトの実デプロイURL
   - `SUBSCRIBE_URL`: 手順2で作った Stripe Payment Link のURL
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

Stripe の実クレデンシャルが無くても、`lib/licenses.js` の `isLicenseActive` は
`stripeImpl` を差し替えられる設計になっているため、モックしたStripeクライアントで
ロジック単体の動作確認ができます（`test/unit.mjs` 参照）。実際の決済〜ライセンスキー発行
〜アプリでの有効化までの通しテストは、Stripe側の実アカウント（テストモード可）を
用意してから行ってください。
