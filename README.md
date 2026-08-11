# 🚴 バーチャルサイクリング

Google マップの 3D 地図の中を、自分が漕いだぶんだけ進む室内サイクリングアプリ。
Bluetooth スマートトレーナーと連携し、坂道では実際にペダルが重くなります。
**ダイエットの継続を支えること**を目的にしています。

👉 **[動かす手順（完全版）](docs/SETUP.md)** ／ **[アプリを開く](https://kuzu-noha.github.io/github.io/app/)** ／ **[要件定義書](docs/virtual-cycling-requirements.md)**

> **初めての方は [docs/SETUP.md](docs/SETUP.md) をご覧ください。**
> STEP 1・2 だけなら5分・費用ゼロで、機材も API キーも無しに動作を確認できます。

---

## ⚠️ 動作環境

Bluetooth 接続には **Web Bluetooth 対応ブラウザ**が必要です。

| 環境 | 可否 |
|---|---|
| PC / Mac の **Chrome / Edge** | ✅ そのまま動きます |
| Android の Chrome | ✅ 動きます |
| **iPhone / iPad の Safari・Chrome** | ❌ **動きません**（iOS は Web Bluetooth 非対応） |
| iPhone + App Store の **WebBLE** ブラウザ | ✅ 同じ URL を WebBLE で開いてください |

iOS の Chrome は中身が WebKit のため、Safari と同じ制約を受けます。
Apple がプライバシー上の理由で Web Bluetooth を実装していないためで、回避には
WebBLE のような専用ブラウザかネイティブアプリが必要です。

**機材が無くてもシミュレーターモードで全機能を試せます。**

---

## セットアップ

### 1. Google Cloud で API キーを発行する

3D 映像を使うには API キーが必要です（キー無しでも 2D 表示モードで動作します）。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成し、課金を有効化
2. 以下の API を有効化する
   - **Maps JavaScript API**（3D 表示・ストリートビュー）
   - **Map Tiles API**（フォトリアル 3D タイル）
   - **Routes API**（ルート生成）
   - **Elevation API**（標高・勾配）
3. 「認証情報」から API キーを作成

### 2. キーに制限をかける（必須）

静的サイトのため API キーはブラウザに露出します。**以下は必須です。**

| 設定 | 内容 |
|---|---|
| **アプリケーションの制限** | HTTP リファラー → `kuzu-noha.github.io/github.io/*` |
| **API の制限** | 上記4つの API のみ許可 |
| **クォータ上限** | 各 API に日次上限を設定（想定利用量の2〜3倍） |
| **予算アラート** | Cloud Billing で通知を設定 |

> これを怠ると、キーが第三者に使われて高額請求が発生しうる。

### 3. アプリにキーを入力する

アプリの「設定」画面で入力します。キーは **この端末の `localStorage` にのみ保存**され、
リポジトリにもサーバーにも送信されません。

---

## サブスクリプション（有料プラン）

自分で API キーを取得・管理したくない場合向けに、月額会員になると 3D 映像・
ルート検索・地点指定ルートの標高が使えるサブスクリプションを用意している
（要件定義書 [第7.5節](docs/virtual-cycling-requirements.md)）。

**上記のセットアップ（自分の API キーを設定画面に貼る、BYOK）は無料のまま無期限で維持する。**
サブスクはこれを置き換えるものではなく、別の選択肢として並存する。両方設定した
場合はサブスクを優先し、サブスクのバックエンドが不通の場合は自動的に BYOK に
フォールバックする。

サブスクの実キー（Google Maps Platform）は本リポジトリとは別デプロイのバックエンド
（`server/`、Vercel）の環境変数にのみ置かれ、決済・ライセンスキー発行は
Stripe が行う。バックエンドの構成・デプロイ手順は
[`server/README.md`](server/README.md) を、特定商取引法表記・利用規約・
プライバシーポリシーのテンプレートは [`docs/legal/`](docs/legal/) を参照。

> **現在の状況**: アプリ・バックエンドのコードは実装済み。実際の課金開始には
> Stripe でのサブスク商品作成・Payment Link発行、Google Cloud での2本目の API キー発行、
> Vercel への実デプロイ（Pro プランへのアップグレードを含む）、価格と
> 特定商取引法上の事業者情報の確定が必要（`server/README.md` の「デプロイ手順」参照）。

---

## API コストについて

映像方式によって**課金の単位**が違い、実コストが1000倍以上変わります。

| 方式 | 課金単位 | 30分ライド1回 |
|---|---|---|
| **フォトリアル 3D タイル** | **セッション（3時間）** | **約 0.9 円** |
| Dynamic Street View | パノラマ1枚ごと | 約 2,100 円 |

本アプリは 3D タイルを主軸に据え、ストリートビューは「見回す」ボタンと 1km ごとの
チェックポイントに限定しています。3D タイルは月1,000セッションの無料枠があるため、
**毎日乗っても実質無料**の範囲に収まります。

---

## 使い方

1. **ルート** — プリセット、GPX インポート、地点指定のいずれかで選ぶ
2. **走行** — トレーナーに接続（またはシミュレーター開始）→「走行開始」
3. **記録** — 走行後に距離・カロリーが保存される。体重も記録できる

### ルートが作れないとき

Google の自転車ルートは日本のカバレッジが限定的です。地点指定で失敗する場合は
自動的に徒歩 → 自動車の順にフォールバックしますが、それでもダメなら
**プリセット**か **GPX インポート**（Strava / Garmin から書き出し）をお使いください。

---

## 開発

ビルド不要の静的サイトです。Vanilla JS + ES Modules で書かれています。

```bash
# ローカルで動かす
python3 -m http.server 8000
# → http://localhost:8000/app/

# 単体テスト（純粋ロジック・ブラウザ不要）
node --test test/unit.mjs

# E2E テスト（Playwright + Chromium）
node test/e2e.mjs
```

### 構成

```
index.html                  ランディング
app/index.html              アプリ本体
app/js/ble/ftms.js          FTMS 接続・Indoor Bike Data パース・勾配送信
app/js/ble/heartRate.js     心拍計
app/js/ble/simulator.js     機材なしで動かす擬似データ源
app/js/map/geo.js           距離・方位・補間・ポリライン展開
app/js/map/route.js         ルート生成（フォールバック付き）・標高取得
app/js/map/view3d.js        Map3DElement のカメラ制御
app/js/map/fallback2d.js    2D フォールバック描画
app/js/map/streetview.js    ストリートビューのスポット表示
app/js/ride/engine.js       走行ループ（距離積算・勾配算出・カロリー）
app/js/ride/calories.js     kJ→kcal 換算・MET フォールバック
app/js/store/sessions.js    IndexedDB 保存
app/js/ui/                  HUD・ダッシュボード
```

### 実装上の注意点

**FTMS の Flags bit 0 は論理が反転しています。**
`(flags & 0x01) === 0` のときに瞬間速度が「存在」します。ここを取り違えると
以降の全フィールドのオフセットがずれます。`test/unit.mjs` に検証があります。

**Google Maps の利用規約上、以下は禁止されています。**
- 地図コンテンツのキャッシュ（`pano_ID` のみ例外）・事前フェッチ
- ストリートビュー画像と非 Google マップの同一画面表示（ミニマップは必ず Google Maps を使う）

---

## データの扱い

体重・体脂肪率・心拍は要配慮情報として扱い、**この端末のブラウザ内にのみ保存**します。
サーバーには一切送信されません。記録画面から JSON エクスポートと全削除ができます。

サブスクリプションを有効化した場合のみ、メールアドレスとライセンスキーが有効性確認の
ためバックエンドと決済代行（Stripe）に送信されます。体重・体脂肪率・心拍・
走行記録はこの例外に含まれず、サブスク利用時も引き続き送信されません。詳しくは
[`docs/legal/privacy.md`](docs/legal/privacy.md)（テンプレート）を参照。

---

地図データ © Google — 本アプリは Google Maps Platform を利用しています。
