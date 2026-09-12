# LINE公式アカウント連携セットアップ（管理画面の「LINE」タブ）

管理画面から直接、LINE公式アカウントに届いたお客様のメッセージを見て返信できる機能です。

関係ファイル：
- `migrations/0011_line_chat.sql` — D1テーブル（`line_conversations` / `line_messages`）
- `functions/_shared/line.js` — LINE API呼び出し（署名検証・プロフィール取得・画像取得・返信送信）
- `functions/api/line-webhook.js` — LINEからのメッセージ受信（Webhook）
- `functions/api/admin/line-conversations.js` / `line-conversations/[id].js` — 管理画面API
- `admin.html` の「LINE」タブ

---

## 1. D1 マイグレーションを適用する

```
wrangler d1 execute <DB名> --file=migrations/0011_line_chat.sql --remote
```

## 2. Messaging API を有効化する

すでにLINE公式アカウントをお持ちとのことなので：

1. **LINE Official Account Manager**（https://manager.line.biz/）にログイン → 対象アカウントを選択
   → 左メニュー **設定 → Messaging API** を開く。
2. まだ有効化していない場合は **Messaging APIを利用する** ボタンから有効化（プロバイダーの選択・作成を求められる場合があります）。
3. 有効化すると自動的に **LINE Developers Console**（https://developers.line.biz/console/）にも
   同じチャンネルが作成されます。

## 3. Channel Secret と Channel Access Token を取得する

LINE Developers Console → 対象のプロバイダー → 対象のチャンネル（Messaging API）を開く：

1. **Basic settings** タブ → **Channel secret** をコピー（これが `LINE_CHANNEL_SECRET`）。
2. **Messaging API** タブ → 下の方の **Channel access token（長期）** →
   まだ発行していなければ **Issue**（発行）ボタンを押してコピー（これが `LINE_CHANNEL_ACCESS_TOKEN`）。

## 4. Webhook URL を設定する

同じ **Messaging API** タブ内：

1. **Webhook URL** に以下を入力して **Update**（更新）：
   ```
   https://www.hexapoint-jp.com/api/line-webhook
   ```
2. **Webhookの利用** を **オン** にする。
3. 隣の **検証**（Verify）ボタンを押して、成功（Success）と表示されることを確認
   （環境変数を設定してデプロイした後に行ってください — 未設定の状態で検証すると失敗します）。
4. 画面をさらに下にスクロールし、**応答メッセージ（自動応答）** と **あいさつメッセージ** は
   **オフ** にすることを推奨します。オンのままだと、お客様のメッセージに対してLINEが
   自動応答を返してしまい、この管理画面での会話と混ざって分かりにくくなります
   （このオン/オフは LINE Official Account Manager → 設定 → 応答設定 からも変更できます）。

## 5. Cloudflare Pages に環境変数を追加する

Cloudflare ダッシュボード → 対象 Pages プロジェクト → **Settings → Environment variables**：

| 変数名 | 値 | 必須 |
|---|---|---|
| `LINE_CHANNEL_SECRET` | 手順3でコピーしたChannel secret | ✅（**Secret**として保存） |
| `LINE_CHANNEL_ACCESS_TOKEN` | 手順3でコピーしたChannel access token | ✅（**Secret**として保存） |

保存後、**Deployments** タブから最新デプロイを **Retry deployment** すると即反映されます。

## 6. デプロイして動作確認

1. 新規・変更ファイルをすべてデプロイ（`migrations/0011_line_chat.sql` は手順1で既に適用済み）。
2. 手順4の **検証**（Verify）ボタンを押し、成功することを確認。
3. 自分のスマホでその公式アカウントを友だち追加 → 何かメッセージを送ってみる。
4. `/admin.html` の **「LINE」タブ** を開き、会話が表示されることを確認（表示されない場合は
   **更新 / Refresh** を押す）。
5. その会話をクリックして開き、返信を入力して送信 → スマホ側にちゃんと届くか確認。
6. 画像を送ってみて、管理画面のチャット画面にサムネイルが表示されることを確認。

## 補足

- **1対1のチャットのみ対応**（グループトーク・複数人トークは対象外です）。
- 画像は **350KB〜1.5MB程度まで** をD1データベースに直接保存します
  （R2やCloudflare Imagesのような別の画像保存サービスは使っていません — 現状の
  シンプルな構成を保つためです）。1.5MBを超える画像は保存されず、
  「画像（サイズが大きいため保存できませんでした）」という表示になります。
- スタンプ・動画・音声・ファイル・位置情報は、内容そのものではなく
  「[スタンプ]」のようなラベルのみ会話に記録されます（MVPの対象外）。
- 管理画面からの返信は **Push Message API** を使用しており、LINEの無料メッセージ枠
  （月間の無料通数）を消費します。無料枠を超えると追加送信には料金が発生する場合があるので、
  LINE Official Account Managerの利用状況ページで時々確認することをおすすめします。
- 管理画面を開いている間、チャット画面は8秒ごとに自動更新されます（WebSocketではなく
  ポーリング方式のため、厳密なリアルタイムではありません）。
