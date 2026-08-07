# バーチャルサイクリングアプリ 要件定義書

**バージョン**: 1.0
**作成日**: 2026-08-06
**ステータス**: ドラフト（前提事項に未確定項目あり。第12章参照）

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [実現可否の技術的結論](#2-実現可否の技術的結論)
3. [端末・実行環境の要件](#3-端末実行環境の要件)
4. [システム構成](#4-システム構成)
5. [Bluetooth (BLE) 要件](#5-bluetooth-ble-要件)
6. [機能要件](#6-機能要件)
7. [非機能要件](#7-非機能要件)
8. [Google Maps Platform 利用規約上の制約](#8-google-maps-platform-利用規約上の制約)
9. [リスクと対策](#9-リスクと対策)
10. [開発フェーズ計画](#10-開発フェーズ計画)
11. [必要機材と概算費用](#11-必要機材と概算費用)
12. [本書の前提](#12-本書の前提)
13. [参考資料](#13-参考資料)

---

## 1. プロジェクト概要

### 1.1 背景と目的

室内でエアロバイク／固定ローラーを漕ぐ運動は、ダイエットの手段として有効だが**極めて退屈**であり、continuity（継続性）が最大の課題となる。本アプリは、実在する世界の風景を Google Maps の 3D 地図データで再現し、自分がペダルを漕いだ分だけ景色が進む体験を提供することで、この退屈さを解消する。

### 1.2 ゴール

**「ダイエットのための有酸素運動を、飽きずに継続できる状態にする」**

### 1.3 最重要 KPI

本アプリの成否は消費カロリーの絶対量ではなく、**継続率**で測る。

| KPI | 目標値 | 測定方法 |
|---|---|---|
| 週あたり実施回数 | 3回以上 | セッション記録 |
| 1回あたり継続時間 | 30分以上 | セッション記録 |
| 4週間後の継続率 | 70%以上 | 週次の実施有無 |

> **設計上の指針**: 機能の優先順位に迷った場合は、常に「継続率に効くか」を判断基準とする。高機能化より、起動から走り出すまでの摩擦を減らすことを優先する。

### 1.4 スコープ外（初期リリース）

- 他ユーザーとのオンライン対戦・グループライド
- SNS 連携・ランキング
- トレーニングプラン自動生成（FTP テストなど本格的トレーニング機能）
- サーバーサイドのユーザー管理・課金

---

## 2. 実現可否の技術的結論

### 結論: **実現可能**。ただし2つの制約が設計を決定づける。

### 2.1 制約1 — iPhone のブラウザは Bluetooth に繋げない

iOS は **Safari も iOS版Chrome も Web Bluetooth API に非対応**である。iOS版Chrome は名前こそ Chrome だが、Apple の規約により描画エンジンが WebKit に強制されるため、Safari と全く同じ制約を受ける。Apple はプライバシー・セキュリティ上の懸念を理由に、Web Bluetooth の実装を明確に拒否している（Firefox も同様）。

Web Bluetooth が動作するのは **Chrome / Edge / Opera / Samsung Internet（Android およびデスクトップ）** のみで、全世界のブラウザシェアでは約76%（2026年4月時点）。

**したがって「iPhone の Safari で自作 Web アプリを開いてスマートトレーナーに接続する」は原理的に不可能である。**

回避策は3つあり、本プロジェクトではこれを段階的に組み合わせる（詳細は第3章）。

### 2.2 制約2 — 映像方式の課金単位により実質コストが1000倍以上変わる

Google Maps Platform には街並みを表示する手段が複数あるが、**課金の単位がそれぞれ異なる**。これを取り違えると、個人利用にもかかわらず月額数万円の請求が発生しうる。

| 映像方式 | 課金単位 | 単価 | 無料枠/月 | **30分ライド1回の実コスト** |
|---|---|---|---|---|
| **Photorealistic 3D Tiles** | **セッション（3時間）** | $6 / 1,000 | 1,000 | **約 $0.006（0.9円）** |
| Dynamic Street View | パノラマ読込ごと | $14 / 1,000 | 5,000 | 10km ÷ 10m間隔 ≒ 1,000枚 → **約 $14（2,100円）** |
| Street View Static | 画像1枚ごと | $7 / 1,000 | 10,000 | 1fps × 30分 = 1,800枚 → **約 $12.6（1,900円）** |
| Dynamic Maps（2D地図） | 地図読込ごと | $7 / 1,000 | 10,000 | 1回 → 約 $0.007 |

**Photorealistic 3D Tiles だけが「セッション課金」である。** 1回のセッション（3時間有効）を開始すれば、その間のタイル取得は何回でも追加課金されない。つまり**1回のライド全体が実質1リクエスト分**で済む。月1,000セッションの無料枠があるため、毎日乗っても**実質無料**である。

対して Street View は1枚ごとの課金であり、走り続ける用途とは本質的に相性が悪い。

> **傍証**: Zwift・Rouvy・Kinomap といった既存の商用バーチャルサイクリングアプリは、いずれも**事前撮影した動画**か**自作の3D世界**を使用しており、Google Street View をライブに流し込む製品は市場に存在しない。上記のコスト構造がその理由と考えられる。

### 2.3 採用する映像方式: ハイブリッド構成

| 用途 | 使用API | 理由 |
|---|---|---|
| **通常走行（常時）** | Photorealistic 3D Tiles | 実質無料。カメラが連続的に動くため「走っている感」が本物 |
| **要所での風景確認** | Street View | 「見回す」ボタン押下時と1kmごとのチェックポイントのみ。写真そのものの情報量を活かす |
| ミニマップ | Dynamic Maps | 1セッション1回の読込のみ |

Street View の呼び出しを「ユーザーの明示操作」と「1kmごと」に限定することで、1ライドあたり10〜20回程度に抑えられ、月5,000回の無料枠に十分収まる。

### 2.4 3D Tiles の弱点と対策

Photorealistic 3D Tiles は航空写真から生成された3Dメッシュであるため、**地上の目線に近づくほど画質が粗く（ブロック状に）なる**。また対応範囲は世界2,500都市以上とされるが、日本の地方部は非対応の可能性がある。

| 弱点 | 対策 |
|---|---|
| 地上目線で画質が粗い | カメラを後方上空に配置（range 40〜60m / tilt 70〜80°）。真の一人称視点は避け、「自分の少し後ろを追う三人称視点」にする |
| 対応都市が限定的 | ルート作成前にカバレッジを判定し、非対応なら2D地図モードへ自動フォールバック |

---

## 3. 端末・実行環境の要件

### 3.1 iPhone 対応の3つの選択肢

| 案 | 内容 | 追加コスト | 開発工数 | 評価 |
|---|---|---|---|---|
| **A. Web アプリ + PC/Mac Chrome** | GitHub Pages に配置。Web Bluetooth が標準で動作 | ゼロ | 小 | **最短で動く。まずここで完成させる** |
| **B. Web アプリ + WebBLE ブラウザ** | App Store の `WebBLE`（iOS の CoreBluetooth を Web Bluetooth API に橋渡しする WKWebView ベースの専用ブラウザ）で**同じ Web アプリ**を開く | 数百円（アプリ購入） | ゼロ（案Aと同一コード） | **iPhone で使える。ただし API は部分実装のため実機検証が必須** |
| C. ネイティブ iOS アプリ | Swift + CoreBluetooth でトレーナーに直結。3D描画は WKWebView 内の CesiumJS に委譲するハイブリッド構成 | Apple Developer Program 年額 約¥15,000 | 大（数倍） | 確実だが最後の手段 |

### 3.2 採用方針: 段階戦略

**案A と案B は同一の Web アプリコードで両立する。** これが本プロジェクトの中核的な設計判断である。

```
Phase 1  Web アプリとして開発 → PC/Mac の Chrome で完成・動作確認
              ↓  （同一コードをそのまま）
Phase 3  iPhone の WebBLE ブラウザで開いて実機検証
              ↓  （WebBLE で FTMS が安定動作しない場合のみ）
Phase 3' ネイティブ iOS アプリ化を判断
```

単一コードベースで PC と iPhone の両方をカバーできるため、**まず確実に動くものを PC で作り、その資産をそのまま iPhone に持ち込む**。ネイティブ化は案Bが実機で不十分だった場合のフォールバックとして位置づけ、初期投資を避ける。

### 3.3 動作要件

| 項目 | 要件 |
|---|---|
| 開発・主要動作環境 | Windows / macOS の Google Chrome（最新版） |
| iPhone 動作環境 | iOS 上の `WebBLE` アプリ（Safari・iOS版Chrome では **動作しない**） |
| 配信 | GitHub Pages（HTTPS。Web Bluetooth の secure context 要件を満たす） |
| ネットワーク | 常時接続（3Dタイルのストリーミングのため） |

---

## 4. システム構成

### 4.1 全体構成

```
┌─────────────────────────────────────────────────────┐
│  ブラウザ（PC/Chrome または iPhone/WebBLE）           │
│                                                       │
│  ┌────────────┐   ┌──────────────┐   ┌────────────┐ │
│  │ BLE 層      │   │ 走行エンジン   │   │ 表示層      │ │
│  │ ・FTMS      │──▶│ ・距離積算    │──▶│ ・3Dビュー  │ │
│  │ ・心拍      │   │ ・勾配算出    │   │ ・HUD       │ │
│  │ ・シミュ    │◀──│ ・カロリー計算 │   │ ・ミニマップ │ │
│  └────────────┘   └──────────────┘   └────────────┘ │
│         │                  │                  │       │
│         │                  ▼                  │       │
│         │          ┌──────────────┐          │       │
│         │          │ ローカル保存   │          │       │
│         │          │ (IndexedDB)   │          │       │
│         │          └──────────────┘          │       │
└─────────┼─────────────────────────────────────┼───────┘
          │                                     │
    ┌─────▼──────┐                    ┌─────────▼────────┐
    │ スマート     │                    │ Google Maps       │
    │ トレーナー   │                    │ Platform          │
    │ (Bluetooth) │                    │ ・3D Tiles        │
    └────────────┘                    │ ・Street View     │
                                       │ ・Routes API      │
                                       │ ・Elevation API   │
                                       └───────────────────┘
```

**サーバーは不要**。完全な静的サイトとして GitHub Pages で配信し、データはブラウザのローカルストレージに保持する。

### 4.2 技術スタック

| レイヤ | 採用技術 | 選定理由 |
|---|---|---|
| 実装形態 | **ビルド不要の静的サイト**（Vanilla JS + ES Modules） | GitHub Pages にプッシュするだけで動く。後からファイルを直接編集でき、ツールチェーンの陳腐化リスクがない |
| 3D描画 | **Maps JavaScript API の 3D Maps（`Map3DElement`）** | Google 公式。`center` / `range` / `tilt` / `heading` を毎フレーム更新することで走行を表現できる。帰属表示が自動で入る |
| 3D描画（代替） | CesiumJS + Google Photorealistic 3D Tiles | カメラ制御はより素直だが、帰属表示を自前実装する必要がある。`Map3DElement` で要求を満たせない場合に切替 |
| ルート生成 | Routes API（`computeRoutes`） | 現行API。Directions API は Legacy 扱い |
| 標高取得 | Elevation API | 1リクエストで最大512点のパス標高を取得可能 |
| データ保存 | IndexedDB（体重・セッション履歴）/ localStorage（設定・APIキー） | サーバー不要。オフラインでも動作 |

### 4.3 想定ファイル構成

```
index.html                       ランディング
app/index.html                   アプリ本体
app/css/style.css
app/js/main.js                   画面遷移・全体状態管理
app/js/config.js                 APIキーの localStorage 入出力
app/js/ble/ftms.js               FTMS接続・Indoor Bike Data パース・Control Point 書込
app/js/ble/heartRate.js          心拍センサー（任意接続）
app/js/ble/csc.js                スピード/ケイデンスセンサー（FTMS 非所有時）
app/js/ble/simulator.js          機材なしで動かす擬似データ源
app/js/map/route.js              ルート生成 + 標高プロファイル取得
app/js/map/geo.js                累積距離・距離→座標補間・方位角計算
app/js/map/view3d.js             Map3DElement のカメラ制御
app/js/map/streetview.js         Street View のスポット表示
app/js/map/fallback2d.js         3Dタイル非対応地域／キー未設定時の2D表示
app/js/ride/engine.js            走行ループ
app/js/ride/calories.js          kJ→kcal 換算、MET フォールバック
app/js/store/sessions.js         IndexedDB 入出力
app/js/ui/hud.js                 走行中HUD
app/js/ui/dashboard.js           ダイエットダッシュボード
docs/virtual-cycling-requirements.md
README.md                        セットアップ手順
```

---

## 5. Bluetooth (BLE) 要件

### 5.1 対応サービス

| 用途 | Service UUID | 主な Characteristic | 必須/任意 |
|---|---|---|---|
| スマートトレーナー | FTMS `0x1826` | Indoor Bike Data `0x2AD2` (notify)<br>Fitness Machine Feature `0x2ACC` (read)<br>Control Point `0x2AD9` (write + indicate)<br>Fitness Machine Status `0x2ADA` (notify) | いずれか必須 |
| スピード/ケイデンス | CSC `0x1816` | CSC Measurement `0x2A5B` (notify) | いずれか必須 |
| パワーメーター | Cycling Power `0x1818` | Cycling Power Measurement `0x2A63` (notify) | 任意 |
| 心拍計 | Heart Rate `0x180D` | HR Measurement `0x2A37` (notify) | 任意 |

### 5.2 Indoor Bike Data `0x2AD2` のバイトレイアウト

先頭の uint16 が Flags。**対応ビットが立っているフィールドのみが、以下の順序で詰めて並ぶ**（リトルエンディアン）。

| ビット | フィールド | 型 | 単位 / 分解能 |
|---|---|---|---|
| **0（反転）** | Instantaneous Speed | uint16 | km/h × 0.01 |
| 1 | Average Speed | uint16 | km/h × 0.01 |
| 2 | Instantaneous Cadence | uint16 | rpm × 0.5 |
| 3 | Average Cadence | uint16 | rpm × 0.5 |
| 4 | Total Distance | uint24 | m |
| 5 | Resistance Level | sint16 | — |
| 6 | Instantaneous Power | sint16 | W |
| 7 | Average Power | sint16 | W |
| 8 | Expended Energy | uint16 + uint16 + uint8 | kcal / kcal per hour / kcal per min |
| 9 | Heart Rate | uint8 | bpm |
| 10 | Metabolic Equivalent | uint8 | MET × 0.1 |
| 11 | Elapsed Time | uint16 | 秒 |
| 12 | Remaining Time | uint16 | 秒 |

> ### ⚠️ 実装上の最重要の罠
> **bit 0 は "More Data" であり、論理が反転している。**
> `(flags & 0x01) === 0` のときに Instantaneous Speed が**存在する**（1のときに存在しない）。
> ここを取り違えると以降の全フィールドのオフセットがずれ、速度もパワーも異常値になる。FTMS 実装で最も頻出するバグである。

### 5.3 Fitness Machine Control Point `0x2AD9`

| Op Code | 内容 | 用途 |
|---|---|---|
| `0x00` | Request Control | **他の書き込み前に必ず実行** |
| `0x01` | Reset | セッション初期化 |
| `0x05` | Set Target Power | ERGモード（将来拡張） |
| `0x07` | Start / Resume | 走行開始 |
| `0x08` | Stop / Pause | 一時停止 |
| `0x11` | **Set Indoor Bike Simulation Parameters** | **勾配連動の本体** |

#### `0x11` のパラメータ（計7バイト）

坂道でペダルが実際に重くなる「勾配連動」を実現する中核。

| 位置 | 内容 | 型 | 単位 / 分解能 |
|---|---|---|---|
| 0 | Op Code `0x11` | uint8 | — |
| 1–2 | Wind Speed | sint16 | m/s × 0.001 |
| 3–4 | **Grade（勾配）** | sint16 | % × 0.01 |
| 5 | Coefficient of Rolling Resistance | uint8 | × 0.0001 |
| 6 | Wind Resistance Coefficient | uint8 | kg/m × 0.01 |

**送信頻度の要件**: BLE の書き込みを過剰に行うと接続が不安定になるため、**2秒ごと、または勾配変化が 0.5% を超えたときのみ**送信する。

### 5.4 CSC からの速度・距離算出（FTMS 非所有時）

CSC Measurement `0x2A5B` は、累積ホイール回転数（uint32）と最終ホイールイベント時刻（uint16、単位 1/1024秒）を通知する。

```
速度 [m/s] = (回転数の差分 × ホイール周長[m]) ÷ (イベント時刻の差分 ÷ 1024)
距離 [m]   = 累積回転数 × ホイール周長[m]
```

ホイール周長は設定画面で入力する（例: 700×25C = 2105mm、26インチ = 2070mm）。イベント時刻は uint16 のため約64秒でラップアラウンドする点に注意し、差分計算時に補正すること。

### 5.5 Web Bluetooth 固有の実装要件

| 要件 | 内容 |
|---|---|
| Secure Context | HTTPS 必須（GitHub Pages が満たす） |
| ユーザー操作起点 | `requestDevice()` はクリック等のユーザー操作から呼ぶ必要がある。自動接続は不可 |
| `optionalServices` | 使用する全ての Service UUID を `requestDevice()` の `optionalServices` に宣言しておくこと。未宣言だと `getPrimaryService()` が実行時に失敗する |
| 再接続 | ブラウザをリロードすると再度ペアリング操作が必要。走行中の誤リロードを防ぐ `beforeunload` 警告を実装する |

### 5.6 メーカー実装差異への対応

FTMS は仕様上ほとんどのフィールドが任意であり、実際に何が送られてくるかはトレーナーのメーカー・機種によって異なる。

**要件**: 接続時に Fitness Machine Feature `0x2ACC` を読み取り、**取得可能なデータに応じて機能を動的に有効化する**こと。

- パワーが取得できない → カロリー計算を MET 方式にフォールバック（第6.5節）
- Control Point の勾配制御に対応しない → 勾配連動を無効化し、走行自体は継続する（エラーで止めない）

### 5.7 シミュレーターモード（必須要件）

**機材やAPIキーが無い状態でも、アプリの全機能が動作すること。**

擬似的な速度・ケイデンス・パワーを生成するモードを実装する。これは以下の理由から「あれば便利」ではなく**必須要件**である。

- 開発時に毎回トレーナーに乗る必要をなくす
- 自動テスト（CI）で走行ロジックを検証できる
- 機材購入前に体験を確認できる
- 不具合発生時に、BLE 起因かアプリロジック起因かを切り分けられる

---

## 6. 機能要件

### 6.1 ルート選択

| ID | 機能 | 優先度 |
|---|---|---|
| F-101 | 出発地・目的地を地名/住所で指定してルート生成 | 高 |
| F-102 | ルート生成の自動フォールバック（`BICYCLE` → `WALK` → `DRIVE`） | **高** |
| F-103 | GPX ファイルのインポート（Strava / Garmin 等からのエクスポート） | 高 |
| F-104 | プリセットルート（3Dタイル対応が確実な都市のルートを数本同梱） | 高 |
| F-105 | 地図上でのルート手動描画 | 中 |
| F-106 | お気に入りルートの保存・再走行 | 中 |
| F-107 | ルートの3Dタイル カバレッジ判定と警告表示 | 中 |

> **F-102 が高優先度である理由**: Google の自転車ルート（`BICYCLE` モード）は**日本国内のカバレッジが限定的**で、地域によっては「ルートを計算できません」となる。自転車モードのみに依存すると、日本のユーザーにとってアプリが使えない事態が頻発する。フォールバックは必須。

> **F-101〜F-104, F-106 は実装済み**（Phase 1・4）。F-106（お気に入り）は、保存したルートを再度走るとゴースト走行（前回のタイムとの比較）が自動で有効になる形で実装した。F-105（手動描画）と F-107（カバレッジ判定・警告表示）は未実装。

### 6.2 走行画面

| ID | 機能 | 優先度 |
|---|---|---|
| F-201 | 3D映像のリアルタイム描画（走行距離に連動してカメラが前進） | 高 |
| F-202 | HUD 表示: 速度・ケイデンス・パワー・心拍・距離・経過時間・勾配・消費カロリー | 高 |
| F-203 | ルート進捗バー（全体のどこを走っているか） | 高 |
| F-204 | ミニマップ（Google Maps） | 中 |
| F-205 | 「見回す」ボタン → 現在地の Street View を表示 | 中 |
| F-206 | 1kmごとの自動 Street View チェックポイント | 低 |
| F-207 | 標高プロファイルグラフと現在位置の表示 | 中 |

### 6.3 走行制御

| ID | 機能 | 優先度 |
|---|---|---|
| F-301 | 開始・一時停止・再開・中断・完走 | 高 |
| F-302 | 勾配連動 ON/OFF 切替（FTMS Control Point `0x11`） | 高 |
| F-303 | 映像速度の倍率設定（実速度の1.0〜3.0倍。ゆっくり漕いでも景色が進む） | 中 |
| F-304 | カメラ視点の切替（三人称の距離・角度調整） | 低 |

> **F-303 の意図**: 初心者が時速15kmで30分漕いでも実距離は7.5kmにしかならず、景色の変化が乏しい。倍率設定により「短時間でも遠くまで行った感」を演出でき、継続率（最重要KPI）に効く。

### 6.4 記録

| ID | 機能 | 優先度 |
|---|---|---|
| F-401 | セッション記録の保存（日時・ルート・距離・時間・平均/最大パワー・平均心拍・消費カロリー） | 高 |
| F-402 | セッション履歴の一覧・詳細表示 | 高 |
| F-403 | 走行データの CSV / GPX エクスポート | 低 |

### 6.5 ダイエット機能（本アプリの主目的）

| ID | 機能 | 優先度 |
|---|---|---|
| F-501 | 体重・体脂肪率の記録 | 高 |
| F-502 | 体重推移グラフ（移動平均線付き） | 高 |
| F-503 | 消費カロリーの算出 | 高 |
| F-504 | 週間・月間の消費カロリー累計と目標達成率 | 高 |
| F-505 | 心拍ゾーン別の滞在時間（脂肪燃焼ゾーンの管理） | 中 |
| F-506 | 連続実施日数・累計走行距離の可視化 | 中 |
| F-507 | 目標体重と達成予測日の表示 | 低 |

#### F-503 消費カロリー算出ロジック

**パワーが取得できる場合（推奨・最も正確）**

```
消費カロリー[kcal] ≒ 積算仕事量[kJ]
                   = Σ(パワー[W] × 経過時間[s]) ÷ 1000
```

これは近似ではなく、生理学的に妥当な換算である。仕事量 kJ をカロリーに直すには 4.184 で割る必要があるが、人体のペダリング効率は約20〜25%であるため、さらに約0.24で割ることになる。この2つの操作がほぼ相殺し、**結果として kJ の数値がそのまま kcal になる**。

**パワーが取得できない場合（MET 方式にフォールバック）**

```
消費カロリー[kcal] = METs × 体重[kg] × 時間[h] × 1.05
```

| 強度 | METs | 目安 |
|---|---|---|
| 軽い | 5.5 | 50W未満 / 会話が楽にできる |
| 中程度 | 7.0 | 50〜100W / 会話はできるが息が弾む |
| きつい | 10.5 | 100W以上 / 会話が困難 |

強度は速度・ケイデンスから推定する。**推定値である旨を UI 上に明示する**こと（パワー方式との精度差をユーザーに誤認させないため）。

#### F-505 心拍ゾーン定義

最大心拍数を `220 − 年齢` で推定し、以下のゾーンで滞在時間を集計する。

| ゾーン | 最大心拍比 | 特性 |
|---|---|---|
| Z1 回復 | 50–60% | ウォームアップ |
| **Z2 脂肪燃焼** | **60–70%** | **脂肪の利用比率が最も高い。ダイエット目的の主戦場** |
| Z3 有酸素 | 70–80% | 心肺機能向上 |
| Z4 閾値 | 80–90% | 高強度 |
| Z5 最大 | 90–100% | 無酸素 |

---

## 7. 非機能要件

### 7.1 性能

| 項目 | 要件 |
|---|---|
| 3D描画フレームレート | 30fps 以上 |
| BLE 通知の画面反映遅延 | 1秒以内 |
| アプリ起動から走行開始まで | 3ステップ以内・60秒以内（継続率に直結） |

### 7.2 コスト

| 項目 | 要件 |
|---|---|
| 1ライド（30分）あたりの API コスト | **10円未満** |
| 月間 API コスト（週3回・月12回想定） | 無料枠内に収まること |

### 7.3 セキュリティ

静的サイトである以上、**API キーはクライアントに露出する**。これは回避できない前提として、以下を必須要件とする。

| ID | 要件 |
|---|---|
| S-01 | **API キーをリポジトリにコミットしない。** 初回起動時にユーザーが入力し、`localStorage` に保存する方式とする |
| S-02 | Google Cloud コンソールで **HTTP リファラ制限**を設定（`kuzu-noha.github.io/github.io/*` のみ許可） |
| S-03 | **API 種別制限**を設定（使用する API のみに限定） |
| S-04 | **日次クォータ上限**を設定（想定利用量の2〜3倍程度で頭打ちにする） |
| S-05 | **予算アラート**を設定（意図しない課金の早期検知） |

> S-02〜S-05 はアプリ側の実装ではなく Google Cloud 側の設定だが、**これを怠ると不正利用による高額請求のリスクが現実化する**ため、README に必須手順として明記し、初回起動時のガイドにも含める。

### 7.4 プライバシー

| ID | 要件 |
|---|---|
| P-01 | 体重・体脂肪率・心拍は要配慮性の高い個人情報として扱う |
| P-02 | 初期リリースでは**一切サーバーに送信せず**、ブラウザのローカルに閉じる |
| P-03 | データのエクスポート・全削除機能を提供する |

### 7.5 可用性・耐障害性

| ID | 要件 |
|---|---|
| A-01 | 走行中に通信が切断されても、**記録は継続**する（映像のみ静止） |
| A-02 | 走行中に BLE が切断された場合、自動再接続を試み、失敗時もそれまでの記録を保全する |
| A-03 | 走行中のページリロードを `beforeunload` で警告する |
| A-04 | API キー未設定時もアプリがクラッシュせず、設定画面へ誘導する |

---

## 8. Google Maps Platform 利用規約上の制約

本アプリの設計に直接影響する規約上の制約を以下に整理する。**実装前に最新の規約を必ず確認すること**（規約は改定されうるため）。

| ID | 制約 | 設計への影響 |
|---|---|---|
| L-01 | **Google Maps コンテンツのキャッシュ禁止**（`pano_ID` のみ例外） | 3Dタイルや Street View 画像をローカル保存して再利用する実装は不可。先読みバッファの設計に制約 |
| L-02 | **バルクダウンロード・事前フェッチの禁止** | ルート全体のタイルを事前に一括取得する最適化は不可 |
| L-03 | **Street View 画像と非Googleマップの同一画面表示禁止** | ミニマップに OpenStreetMap 等を使ってはならない。**必ず Google Maps を使用する** |
| L-04 | **帰属表示の義務**（Google ロゴ、データ提供元） | `Map3DElement` は自動対応。CesiumJS 採用時は自前実装が必要 |
| L-05 | **自転車ルートは beta 提供** | 自転車ルート表示時に、経路が不正確な可能性がある旨の**警告文の表示義務**がある |

> **注記**: 本章は調査時点の公開情報に基づく整理であり、法的助言ではない。特に L-01 の「一時的キャッシュの許容範囲」については、実装前に [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) の原文を確認すること。

---

## 9. リスクと対策

| # | リスク | 影響度 | 対策 |
|---|---|---|---|
| R-01 | **iPhone で Web Bluetooth 非対応** | 高 | 段階戦略（PC/Chrome → WebBLE → ネイティブ）。単一コードベースで案A/Bを両立させ、初期投資を抑える |
| R-02 | **WebBLE は Web Bluetooth API の部分実装** | 高 | FTMS の最小サブセット（notify + write のみ）で成立する設計にする。Phase 3 の早い段階で実機検証し、ダメならネイティブ化に切り替える判断ポイントを設ける |
| R-03 | **Google 自転車ルートの日本カバレッジが限定的** | 高 | `BICYCLE`→`WALK`→`DRIVE` の自動フォールバック（F-102）＋ GPX インポート（F-103）＋ プリセットルート（F-104）の三重の備え |
| R-04 | **API キー露出による不正利用** | 高 | 第7.3節のセキュリティ要件（キー制限＋クォータ上限＋予算アラート）を必須手順化 |
| R-05 | 3D Tiles の地上目線での画質劣化 | 中 | カメラを後方上空に配置（range 40〜60m / tilt 70〜80°）。要所で Street View 併用 |
| R-06 | 3D Tiles のカバレッジ外地域 | 中 | 走行前カバレッジ判定 → 2D地図モードへ自動フォールバック |
| R-07 | FTMS のメーカー実装差異 | 中 | Fitness Machine Feature を読んで機能を動的判定（第5.6節）。勾配制御非対応でも走行は継続 |
| R-08 | Indoor Bike Data の bit 0 反転による解析ミス | 中 | 既知のバイト列を用いた単体テストを実装時に必ず用意する（第5.2節の警告参照） |
| R-09 | 走行中の通信断・BLE切断 | 中 | 記録の継続と自動再接続（第7.5節） |
| R-10 | Google Maps Platform の料金体系変更 | 低 | コスト監視を継続。3Dタイルのセッション課金が変更された場合は映像方式の再評価が必要 |

---

## 10. 開発フェーズ計画

| Phase | 内容 | 完了条件 |
|---|---|---|
| **Phase 0**<br>技術検証 | PC/Chrome で ①BLE実機接続 ②3Dタイル描画 を個別に確認 → 結合 | トレーナーを漕ぐと3D映像が前進する（最小限） |
| **Phase 1**<br>MVP | ルート選択 → 走行 → HUD表示 → セッション記録 の一連が通る | ✅ **完了**（実機 HITFIT_19403 で動作確認済み） |
| **Phase 2**<br>ダイエット機能 | 体重記録・カロリー収支・グラフ・目標管理・心拍ゾーン集計・走行完了サマリー | ✅ **完了**。ダッシュボードで週次の収支が見え、体重推移から目標達成日を予測し、走行直後にサマリー画面で成果とゾーン滞在時間を表示する |
| **Phase 3**<br>iPhone対応 | WebBLE で実機検証 → 不足ならネイティブ化を判断 | iPhone で走行できる／または判断結果が出る |
| **Phase 4**<br>体験向上 | 勾配連動の精緻化、Street View チェックポイント（✅完了）、ゴースト走行（✅完了）、ルートライブラリ（✅完了） | 主要3項目が完了。残りは実機での勾配連動の精緻化のみ |

### Phase 1〜2 実装で判明した知見（要件定義書への差分）

実機（HITFIT_19403、一体型エアロバイク）での検証を通じて、当初の想定から以下を修正した。

- **FTMS 非依存の設計が必須だった**: 一体型バイクの多くは FTMS を持たず、Cycling Power・CSC・独自プロトコルの組み合わせで実装されている。単一サービスへの決め打ちではなく、複数サービスを併用して項目ごとに解決する設計に変更した（5.6節の想定を上回る対応が必要だった）
- **速度センサーの値は無条件に信頼できない**: 一体型バイクの「ホイール回転数」は実車輪ではなく内部カウントであることが多く、そのままでは意味のある速度にならない。パワーからの物理的な逆算を既定にし、平滑化・変化率制限・妥当性チェックの3段階でノイズを除去する必要があった
- **車種による速度差を選べる要件を追加**: 当初の要件になかった「体感速度を上げたい」という要望に対し、車種プロファイル（空気抵抗係数の違い）と速度倍率の2系統を追加した

各 Phase は独立して価値を持つよう区切っている。Phase 1 完了時点で「使えるアプリ」になり、以降は継続率を高める改善という位置づけ。

---

## 11. 必要機材と概算費用

### 11.1 最小構成

| 品目 | 価格帯 | 備考 |
|---|---|---|
| 手持ちの自転車 | — | 既にあるもの |
| 固定ローラー台（非スマート） | ¥8,000〜¥20,000 | ミノウラ、GORIX など |
| スピード/ケイデンスセンサー（CSC） | ¥3,000〜¥6,000 | XOSS、CooSpo、Garmin |
| **合計** | **¥11,000〜¥26,000** | |

**制約**: パワーが測れないため、消費カロリーは MET 方式の推定値になる。勾配連動も不可。

### 11.2 推奨構成（ダイエット目的にはこちらを推奨）

| 品目 | 価格帯 | 備考 |
|---|---|---|
| スマートトレーナー（FTMS対応） | ¥40,000〜¥150,000 | Wahoo KICKR、Tacx、Elite、XPLOVA など |
| 心拍計（胸ベルト） | ¥5,000〜¥12,000 | Polar、Wahoo、CooSpo |
| **合計** | **¥45,000〜¥162,000** | |

**利点**:
- パワー（W）が取得でき、**消費カロリーが推定ではなく実測ベース**になる（kJ ≒ kcal）
- 勾配連動が使え、坂道で実際にペダルが重くなる → 没入感が段違いで、継続率に効く
- 心拍ゾーン管理により、脂肪燃焼ゾーンを狙った運動ができる

> **ダイエット目的での推奨理由**: 本アプリのゴールは「継続」であり、その最大の敵は退屈である。勾配連動による身体的なフィードバックは、映像だけの場合と比べて没入感を大きく高める。また消費カロリーの正確さは、体重変化との因果を実感できるかどうかを左右し、モチベーション維持に直結する。予算が許すなら推奨構成を選ぶ価値は大きい。

### 11.3 ソフトウェア側の費用

| 品目 | 費用 |
|---|---|
| GitHub Pages ホスティング | 無料 |
| Google Maps Platform | 無料枠内に収まる想定（第2.2節） |
| WebBLE アプリ（iPhone 利用時） | 数百円 |
| Apple Developer Program（ネイティブ化する場合のみ） | 年額 約¥15,000 |

---

## 12. 本書の前提

以下はユーザーへの確認が取れていない項目である。**確定した時点で該当章の見直しが必要**。

| # | 前提として置いた内容 | 変更時に影響を受ける章 |
|---|---|---|
| 1 | **利用端末 = iPhone**。ただし Web Bluetooth 非対応のため、PC/Chrome での開発・検証を経てから WebBLE で iPhone 対応する段階戦略を採用 | 第3章、第10章 |
| 2 | **所有機材 = 未確認**。FTMS / CSC / 心拍計の全てに対応する設計とし、取得できるデータに応じて機能を動的に有効化する | 第5章、第6.5節、第11章 |
| 3 | **利用者 = 本人のみの個人利用**。一般公開する場合は API コスト試算・プライバシー要件・利用規約が大きく変わる | 第2.2節、第7.3節、第7.4節、第8章 |
| 4 | **映像方式 = 3Dタイル主軸 + Street View スポット利用のハイブリッド** | 第2章、第6.2節 |

### 確認したい事項

1. お持ちの機材（スマートトレーナー / センサー / 心拍計 / まだ無い）
2. PC/Mac をバイクの前に置ける環境か（置けるなら Phase 1 がそのまま実用になる）
3. 主に走りたいエリア（3Dタイルのカバレッジ確認のため）

---

## 13. 参考資料

### Google Maps Platform
- [Street View Static API Usage and Billing](https://developers.google.com/maps/documentation/streetview/usage-and-billing)
- [Map Tiles API Usage and Billing](https://developers.google.com/maps/documentation/tile/usage-and-billing)
- [Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles)
- [3D Maps — Maps JavaScript API](https://developers.google.com/maps/documentation/javascript/reference/3d-map)
- [Animate camera paths](https://developers.google.com/maps/documentation/javascript/3d/animate-camera)
- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Policies for Street View Static API](https://developers.google.com/maps/documentation/streetview/policies)
- [Pricing categories](https://developers.google.com/maps/billing-and-pricing/pricing-categories)

### Bluetooth
- [Fitness Machine Service 1.0 — Bluetooth SIG](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/)
- [Cycling Speed and Cadence Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/CSCS_v1.0/out/en/index-en.html)
- [Indoor Bike Data characteristic 定義（GATT XML）](https://github.com/oesmith/gatt-xml/blob/master/org.bluetooth.characteristic.indoor_bike_data.xml)
- [Web Bluetooth API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API)
- [Bluetooth API — Can I use](https://caniuse.com/mdn-api_bluetooth)
- [WebBLE — iOS WebBluetooth Polyfill](https://daphtdazz.github.io/WebBLE/)

### カロリー換算
- [Calories and Power — TrainerRoad](https://www.trainerroad.com/blog/calories-and-power/)
- [Energy Expenditure: Calories, Kilojoules, and Power in Cycling — CTS](https://trainright.com/energy-expenditure-calories-kilojoules-and-power-in-cycling/)

### 競合調査
- [Rouvy — Wikipedia](https://en.wikipedia.org/wiki/Rouvy)
- [Best indoor cycling apps 2026 — Cyclist](https://www.cyclist.co.uk/buying-guides/buyers-guide-best-cycling-training-apps)
