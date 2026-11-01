"""Write kdp-listing.md, manuscript.md and kdp-agent-task.md for a book from its spec.json.
python3 common/make_listing.py <book_dir>"""
import os, sys, json
book = os.path.abspath(sys.argv[1]); folder = os.path.basename(book)
s = json.load(open(os.path.join(book, "spec.json"), encoding="utf-8")); L = s["listing"]; n = s["n"]
RAW = f"https://github.com/KUZU-NOHA/github.io/raw/main/docs/kdp-picture-book/{folder}/kdp-upload/"
kw = "\n".join(f"{i+1}. {k}" for i, k in enumerate(L["keywords"]))
cats = "\n".join(f"{i+1}. {c}" for i, c in enumerate(L["categories"]))
title = s["title"]; sub = s["subtitle_listing"]
steps = " ".join(x[0].split(". ")[1].title() + "." for x in s["steps"])
open(os.path.join(book, "kdp-listing.md"), "w", encoding="utf-8").write(f"""# KDP listing kit — {title} (by KUZU NOHA) — Series: Fennel's Feelings, book {n}

Same process as books 1-5 (see `../book1-fennel/kdp-listing.md` for the full step-by-step, pricing and checklist).

| Field | Value |
|---|---|
| Title | {title} |
| Subtitle | {sub} |
| Series | Fennel's Feelings — Book {n} |
| Author | KUZU NOHA |
| Age range | 3 – 6 |
| AI-generated content | Yes |
| Print | Paperback, Premium color, 8.5 × 8.5 in, bleed, matte, free KDP ISBN |
| Files | `kdp-upload/interior.pdf`, `kdp-upload/cover.pdf` |

### Description
```
{L["description"]}
```

### Keywords (7)
{kw}

### Categories
{cats}

### Name / competition notes (web search only)
{L["notes"]}
""")
open(os.path.join(book, "manuscript.md"), "w", encoding="utf-8").write(f"# {title}\nSeries: Fennel's Feelings, book {n} | Ages 3-6 | 32 pages | 8.5x8.5 in | rhyming\nSteps: {steps}\n\n" + "\n".join(f"S{i+1}  | {a} | {b}" for i, (a, b, _) in enumerate(s["story"])) + "\n")
desc_block = L["description"]
open(os.path.join(book, "kdp-agent-task.md"), "w", encoding="utf-8").write(f"""# KDP 出品タスク指示書（第{n}巻・ペーパーバック）— ブラウザ操作ができるセッション用

Chrome 拡張機能（Claude in Chrome）がつながった Claude のセッションに実行させます。
KDP にはあなた自身がログインしておきます。**パスワード・認証コードは Claude に渡さないでください。**

## 依頼文（そのまま貼り付け）

```
Amazon KDP（kdp.amazon.com）で、ペーパーバック「{title}」の出品準備をしてください。
私は KDP にログイン済みです。パスワードや認証コードの入力は求めないでください。
以下の値を各欄に入力し、本文PDFと表紙PDFのアップロード、オンラインプレビューの確認まで進めてください。
重要: 「出版（Publish Your Paperback Book）」ボタンは押さず、押す直前の画面で止まって、入力内容の一覧を私に見せ、私の承認を待ってください。
入力で迷う項目や、画面が想定と違う場合は、推測せずに私に聞いてください。
```

## 入力する値（第{n}巻）

詳細ページ:
- Language: English
- Book title: {title}
- Subtitle: {sub}
- Series title: Fennel's Feelings / Series number: {n}（Series欄がなければ出版後に追加）
- Author: first name KUZU / last name NOHA
- Contributors: なし / Public domain: No / Adult content: なし
- Reading age: min 3 / max 6
- AI-generated content: Text = Yes, Images = Yes（ツール名の欄: "Text: Claude (Anthropic). Images: ChatGPT image generation (OpenAI), upscaled with Real-ESRGAN."）
- Description（HTMLそのまま）:

```
{desc_block}
```

- Keywords（7個、1個ずつ別の欄）:
{kw}

- Categories（最大3、画面の名前が少し違うときは一番近いもの）:
{cats}

コンテンツ:
- Print ISBN: Get a free KDP ISBN
- Print options: Premium color / White paper / Trim 8.5 x 8.5 in / Bleed / Cover finish: Matte
- 本文: {RAW}interior.pdf をダウンロードしてアップロード
- 表紙: {RAW}cover.pdf をダウンロードし、「印刷用PDFをアップロード」で使う
- Launch Previewer で全32ページを確認（エラー・警告があれば私に報告）

権利と価格設定:
- Territories: All territories (worldwide rights)
- Primary marketplace: Amazon.com
- List price: 9.99 USD（印税率はKDPの画面で確認して私に報告）

## 出版の前に、あなたが自分でやること
1. Amazon.com で書名「{title}」を検索する。
2. USPTO（tmsearch.uspto.gov）で FENNEL を区分16・28で検索する。
3. 税務情報・支払い方法・本人確認が KDP アカウントで完了していることを確認する。
4. プルーフ（見本）を1冊注文して、色と綴じ目を見るのが安全。
5. 止まった画面の内容を確認し、**あなた自身が「出版」を押す**。

## 注意
- ファイルのアップロードは、ブラウザ拡張から自動でできない場合があります。そのときは、ダウンロードしたPDFを自分で選んでください。
- 「出版」ボタンを Claude に押させないでください（取り消しにくく、公開される操作です）。
""")
print("wrote listing for", title)
