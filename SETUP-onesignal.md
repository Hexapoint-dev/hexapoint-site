# お客様の声機能：OneSignal メール連携セットアップ

「お客様の声」機能（プロジェクト完了後にクライアントへレビュー依頼メールを送り、管理画面で
承認してからサイトに掲載するフロー）は、依頼メールの送信だけ **OneSignal** の Email API を
使っています（サイトの他のメール ― 注文確認・お問い合わせ通知など ― は引き続き Resend 経由）。

関係ファイル：
- `migrations/0009_testimonials.sql` — D1 テーブル
- `functions/_shared/onesignal.js` — OneSignal へのメール送信
- `functions/api/admin/testimonials.js` / `functions/api/admin/testimonials/[id].js` — 管理画面API
- `functions/api/testimonial.js` — クライアント向け公開フォームAPI（トークン検証＋送信）
- `functions/api/testimonials.js` — ホームページ用の公開フィード（承認＋掲載済みのみ）
- `testimonial.html` — クライアントが開くフィードバックページ
- `admin.html` の「お客様の声」タブ

---

## 1. D1 マイグレーションを適用する

他のマイグレーションと同じ手順です（Settings → Functions → D1 database bindings で `DB` を
紐付け済みであることが前提）：

```
wrangler d1 execute <DB名> --file=migrations/0009_testimonials.sql --remote
```

## 2. OneSignal アカウント・アプリを作成する

1. https://onesignal.com/ でアカウント作成 → **New App/Website** を作成
   （Platform は "Email" を選択、または Web Push 用アプリに Email チャンネルを追加）。
2. 左メニュー **Settings → Email** を開き、送信元として使うメールアドレス／ドメインを設定。
   - 簡易運用：OneSignal が用意するデフォルト送信元でもテストは可能ですが、実際の顧客に
     送る本番運用では、独自ドメイン（例: `hexapoint-jp.com`）を追加し、OneSignal が出す
     **SPF・DKIM の DNS レコード**をそのドメインの DNS（Cloudflare の DNS タブ）に追加して
     認証を通すことを強く推奨します。これをやらないと、送信したメールが受信者側で
     迷惑メール判定されやすくなります。
   - 認証が済んだら、その送信元アドレス（例: `no-reply@hexapoint-jp.com`）を
     `ONESIGNAL_FROM_EMAIL` として使います。
3. 左メニュー **Settings → Keys & IDs** を開き、以下をメモ：
   - **OneSignal App ID**
   - **REST API Key**

## 3. Cloudflare Pages に環境変数を追加する

Cloudflare ダッシュボード → 対象 Pages プロジェクト → **Settings → Environment variables**
（Production 環境。プレビューでテストしたい場合は Preview 環境にも同様に追加）：

| 変数名 | 値 | 必須 |
|---|---|---|
| `ONESIGNAL_APP_ID` | 手順2でメモした App ID | ✅ |
| `ONESIGNAL_REST_API_KEY` | 手順2でメモした REST API Key（**Secret** として保存） | ✅ |
| `ONESIGNAL_FROM_EMAIL` | 認証済みの送信元アドレス | ✅ |
| `ONESIGNAL_FROM_NAME` | 送信者表示名（未設定時は `HexaPoint`） | 任意 |

保存後、**Deployments** タブから最新デプロイを **Retry deployment** すると即反映されます
（次回の通常デプロイでも自動的に反映されます）。

`ONESIGNAL_REST_API_KEY` は Resend の `RESEND_API_KEY` と同じ扱いで、**Secret**（値を隠す設定）
で保存してください — 他の管理者アカウントや画面共有で見えないようにするためです。

## 4. デプロイする

このセットで追加・変更したファイル（`migrations/0009_testimonials.sql` / `functions/_shared/db.js` /
`functions/_shared/onesignal.js` / `functions/api/admin/testimonials.js` /
`functions/api/admin/testimonials/[id].js` / `functions/api/testimonial.js` /
`functions/api/testimonials.js` / `testimonial.html` / `admin.html` / `index.html`）を、
通常のデプロイ手順でアップロードしてください。

## 5. 動作確認

1. `/admin.html` にログイン → **「お客様の声」タブ** → **「+ お客様の声をリクエスト」**。
   - 注文履歴から選ぶか、お客様名・メールアドレス・プロジェクト内容を手動入力して送信。
   - 注文詳細モーダルの **「お客様の声をリクエスト」** ボタンからも、その注文のお客様情報を
     自動入力した状態で同じフォームを開けます。
2. 指定したメールアドレスに OneSignal からメールが届くことを確認（届かない場合は
   OneSignal の **Delivery** ログ、または Settings → Email の認証状態を確認）。
3. メール内のリンク（`https://www.hexapoint-jp.com/testimonial.html?token=...`）を開き、
   評価・コメントを入力して送信。
4. 管理画面の「お客様の声」タブに **「確認待ち」** として表示されることを確認 → 行をクリックして
   詳細モーダルを開き、内容を確認・必要に応じて編集 → **「承認する」** → **「サイトに掲載する」**。
5. `https://www.hexapoint-jp.com/` をリロードし、価格セクションの直前に新しい
   「お客様の声」セクションが表示されることを確認（1件も掲載されていない間は、
   このセクション自体が非表示になります＝空白は出ません）。

## 補足：送信の仕組み

- 依頼メールのリンクは**1回限り**です。クライアントが一度送信すると、同じトークンで
  もう一度開いても「ご回答ありがとうございました」という画面になり、再送信はできません
  （再度送りたい場合は管理画面の詳細モーダルから「リンクを再送信」＝新しいトークンを発行）。
- クライアントの送信内容は **そのままサイトに載らず**、必ず管理画面での承認を経てから
  「サイトに掲載する」ボタンを押すまで非公開です。
- 送信フォーム（`testimonial.html`）は Cloudflare Turnstile（既存のお問い合わせフォームと
  同じボット対策）で保護されています。
