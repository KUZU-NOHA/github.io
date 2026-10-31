# KDP 出品タスク指示書（第2巻・ペーパーバック）— ブラウザ操作ができるセッション用

Chrome 拡張機能（Claude in Chrome）がつながった Claude のセッションに実行させます。
KDP にはあなた自身がログインしておきます。**パスワード・認証コードは Claude に渡さないでください。**

## 依頼文（そのまま貼り付け）

```
Amazon KDP（kdp.amazon.com）で、ペーパーバック「Fennel and the Big Blue Sad」の出品準備をしてください。
私は KDP にログイン済みです。パスワードや認証コードの入力は求めないでください。
以下の値を各欄に入力し、本文PDFと表紙PDFのアップロード、オンラインプレビューの確認まで進めてください。
重要: 「出版（Publish Your Paperback Book）」ボタンは押さず、押す直前の画面で止まって、入力内容の一覧を私に見せ、私の承認を待ってください。
入力で迷う項目や、画面が想定と違う場合は、推測せずに私に聞いてください。
```

## 入力する値（第2巻）

詳細ページ:
- Language: English
- Book title: Fennel and the Big Blue Sad
- Subtitle: A Story About Feeling Sad
- Series title: Fennel's Feelings / Series number: 2（1巻と同じシリーズに入れる。Series欄がなければ出版後に追加）
- Author: first name KUZU / last name NOHA
- Contributors: なし / Public domain: No / Adult content: なし
- Reading age: min 3 / max 6
- AI-generated content: Text = Yes, Images = Yes（ツール名の欄: "Text: Claude (Anthropic). Images: ChatGPT image generation (OpenAI), upscaled with Real-ESRGAN."）
- Description（HTMLそのまま）:

```
<p><b>Fennel's favorite blue kite just flew away. And now a Big Blue Sad is growing inside him.</b></p>
<p>His chin wobbles. A tear rolls down, then two, then three... until a big blue puddle grows around his knees. Mama Bear sits beside him and shows him a gentle way to care for a sad feeling.</p>
<p>With three kind steps — <b>Notice. Cry. Cuddle.</b> — little readers learn that sad is okay, that tears are like rain, and that the sun comes back.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A soothing read-aloud rhyme for ages 3–6</li>
<li>Three simple, gentle steps children can copy: Notice, Cry, Cuddle</li>
<li>A kid-friendly image of sadness as a blue puddle that shrinks with comfort</li>
<li>A note for grown-ups with simple ways to sit with a sad child</li>
<li>Soft watercolor-style illustrations in a cozy meadow and cottage</li>
</ul>
<p>Book 2 in the Fennel's Feelings series. Perfect for bedtime, classroom circle time, and any day a little one feels sad.</p>
```

- Keywords（7個、1個ずつ別の欄）:
1. children's book about sadness and big feelings
2. picture book for kids who feel sad
3. social emotional learning book ages 3-6
4. rhyming bedtime story bear
5. losing something favorite kids book
6. teach kids it is okay to cry
7. preschool kindergarten feelings book

- Categories（最大3、画面の名前が少し違うときは一番近いもの）:
1. Children's Books › Growing Up & Facts of Life › Emotions & Feelings
2. Children's Books › Literature & Fiction › Animals › Bears
3. Children's Books › Growing Up & Facts of Life › Self-Esteem / Self-Reliance

コンテンツ:
- Print ISBN: Get a free KDP ISBN
- Print options: Premium color / White paper / Trim 8.5 x 8.5 in / Bleed / Cover finish: Matte
- 本文: https://github.com/KUZU-NOHA/github.io/raw/main/docs/kdp-picture-book/book2-fennel-blue-sad/kdp-upload/interior.pdf をダウンロードしてアップロード
- 表紙: https://github.com/KUZU-NOHA/github.io/raw/main/docs/kdp-picture-book/book2-fennel-blue-sad/kdp-upload/cover.pdf をダウンロードし、「印刷用PDFをアップロード」で使う
- Launch Previewer で全32ページを確認（エラー・警告があれば私に報告）

権利と価格設定:
- Territories: All territories (worldwide rights)
- Primary marketplace: Amazon.com
- List price: 9.99 USD（印税率はKDPの画面で確認して私に報告）

## 出版の前に、あなたが自分でやること
1. Amazon.com で書名「Fennel and the Big Blue Sad」を検索する。
2. USPTO（tmsearch.uspto.gov）で FENNEL を区分16・28で検索する。
3. 税務情報・支払い方法・本人確認が KDP アカウントで完了していることを確認する。
4. プルーフ（見本）を1冊注文して、色と綴じ目を見るのが安全。
5. 止まった画面の内容を確認し、**あなた自身が「出版」を押す**。

## 注意
- ファイルのアップロードは、ブラウザ拡張から自動でできない場合があります。そのときは、ダウンロードしたPDFを自分で選んでください。
- 「出版」ボタンを Claude に押させないでください（取り消しにくく、公開される操作です）。
