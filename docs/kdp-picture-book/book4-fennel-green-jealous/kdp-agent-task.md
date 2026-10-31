# KDP 出品タスク指示書（第4巻・ペーパーバック）— ブラウザ操作ができるセッション用

Chrome 拡張機能（Claude in Chrome）がつながった Claude のセッションに実行させます。
KDP にはあなた自身がログインしておきます。**パスワード・認証コードは Claude に渡さないでください。**

## 依頼文（そのまま貼り付け）

```
Amazon KDP（kdp.amazon.com）で、ペーパーバック「Fennel and the Big Green Jealous」の出品準備をしてください。
私は KDP にログイン済みです。パスワードや認証コードの入力は求めないでください。
以下の値を各欄に入力し、本文PDFと表紙PDFのアップロード、オンラインプレビューの確認まで進めてください。
重要: 「出版（Publish Your Paperback Book）」ボタンは押さず、押す直前の画面で止まって、入力内容の一覧を私に見せ、私の承認を待ってください。
入力で迷う項目や、画面が想定と違う場合は、推測せずに私に聞いてください。
```

## 入力する値（第4巻）

詳細ページ:
- Language: English
- Book title: Fennel and the Big Green Jealous
- Subtitle: A Story About Feeling Jealous
- Series title: Fennel's Feelings / Series number: 4（1巻と同じシリーズに入れる。Series欄がなければ出版後に追加）
- Author: first name KUZU / last name NOHA
- Contributors: なし / Public domain: No / Adult content: なし
- Reading age: min 3 / max 6
- AI-generated content: Text = Yes, Images = Yes（ツール名の欄: "Text: Claude (Anthropic). Images: ChatGPT image generation (OpenAI), upscaled with Real-ESRGAN."）
- Description（HTMLそのまま）:

```
<p><b>Fennel Bear had Mama all to himself. Then a bundle in a pink blanket came home... and a prickly Big Green Jealous began to grow.</b></p>
<p>Everyone coos over Baby Poppy's tiny toes. Mama holds Poppy. Mama rocks Poppy. A green vine curls around Fennel's tummy, until Mama kneels down and shows him how to tame a jealous feeling.</p>
<p>With three kind steps — <b>Spot it. Ask. Join.</b> — little readers learn that jealous feelings are normal, and that there is love enough for two.</p>
<p><b>Inside this warm rhyming picture book:</b></p>
<ul>
<li>A cozy read-aloud rhyme for ages 3–6, great for big brothers and big sisters</li>
<li>A kid-friendly image of jealousy as a prickly green vine that shrinks with love</li>
<li>Three simple steps children can copy: Spot, Ask, Join</li>
<li>A note for grown-ups with easy ways to help an older child feel seen</li>
<li>Soft watercolor-style illustrations</li>
</ul>
<p>Book 4 in the Fennel's Feelings series. A gentle gift for families welcoming a new baby.</p>
```

- Keywords（7個、1個ずつ別の欄）:
1. new baby sibling book for older child
2. children's book about jealousy
3. big brother book new baby gift
4. big sister book new baby
5. social emotional learning book ages 3-6
6. rhyming picture book bear family
7. help toddler jealous of new baby

- Categories（最大3、画面の名前が少し違うときは一番近いもの）:
1. Children's Books › Growing Up & Facts of Life › New Baby
2. Children's Books › Growing Up & Facts of Life › Emotions & Feelings
3. Children's Books › Literature & Fiction › Animals › Bears

コンテンツ:
- Print ISBN: Get a free KDP ISBN
- Print options: Premium color / White paper / Trim 8.5 x 8.5 in / Bleed / Cover finish: Matte
- 本文: https://github.com/KUZU-NOHA/github.io/raw/main/docs/kdp-picture-book/book4-fennel-green-jealous/kdp-upload/interior.pdf をダウンロードしてアップロード
- 表紙: https://github.com/KUZU-NOHA/github.io/raw/main/docs/kdp-picture-book/book4-fennel-green-jealous/kdp-upload/cover.pdf をダウンロードし、「印刷用PDFをアップロード」で使う
- Launch Previewer で全32ページを確認（エラー・警告があれば私に報告）

権利と価格設定:
- Territories: All territories (worldwide rights)
- Primary marketplace: Amazon.com
- List price: 9.99 USD（印税率はKDPの画面で確認して私に報告）

## 出版の前に、あなたが自分でやること
1. Amazon.com で書名「Fennel and the Big Green Jealous」を検索する。
2. USPTO（tmsearch.uspto.gov）で FENNEL を区分16・28で検索する。
3. 税務情報・支払い方法・本人確認が KDP アカウントで完了していることを確認する。
4. プルーフ（見本）を1冊注文して、色と綴じ目を見るのが安全。
5. 止まった画面の内容を確認し、**あなた自身が「出版」を押す**。

## 注意
- ファイルのアップロードは、ブラウザ拡張から自動でできない場合があります。そのときは、ダウンロードしたPDFを自分で選んでください。
- 「出版」ボタンを Claude に押させないでください（取り消しにくく、公開される操作です）。
