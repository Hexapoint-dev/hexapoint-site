# HexaPoint — Cloudflare セットアップ / Cloudflare Setup

このファイルはサイトの一部として公開されるものではありません（削除しても動作に影響しません）。
This file is documentation only — it is not part of the published site.

---

## 1. Cloudflare Web Analytics（所要 2 分）

プライバシー重視・Cookie 不要のアクセス解析。実ユーザーの Core Web Vitals
（LCP / INP / CLS）を計測できます。Google がランキングに使う指標と同じものです。

1. Cloudflare ダッシュボード → **Web Analytics** → **Add a site**
2. `hexapoint.pages.dev` を入力
3. 表示される **token** をコピー
4. `index.html` の末尾にある次の行を探し、`PASTE_YOUR_TOKEN_HERE` を token に置き換える：

```html
<script defer src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "PASTE_YOUR_TOKEN_HERE"}'></script>
```

トークンを入れるまでこのスクリプトは何もしません（害はありません）。

---

## 2. IndexNow 自動送信 `/api/indexnow`

Bing・Yandex・Naver・Seznam に「ページを更新した」と即時通知します。
Bing のインデックスは ChatGPT Search も参照しているため、AI 検索での露出にも効きます。

### 環境変数（Cloudflare ダッシュボード → Pages プロジェクト → Settings → Environment variables）

| 変数名 | 値 |
|---|---|
| `INDEXNOW_KEY` | `c96a412c5d41125143ea5fa42129051f` |
| `INDEXNOW_SECRET` | 自分で決める長いランダム文字列（下記参照） |
| `SITE_ORIGIN` | 任意。独自ドメインに移行したら `https://例.jp` を設定 |

> **`INDEXNOW_SECRET` は IndexNow のキーではありません。**
> 他人が勝手に送信できないようにするための、あなただけのパスワードです。
> 生成例：`openssl rand -hex 24`

キーファイル `c96a412c5d41125143ea5fa42129051f.txt` はサイトのルートに配置済みです。
公開後、次の URL でキー文字列だけが表示されることを必ず確認してください：

```
https://hexapoint.pages.dev/c96a412c5d41125143ea5fa42129051f.txt
```

### 使い方

トップページを送信：

```
https://hexapoint.pages.dev/api/indexnow?secret=YOUR_SECRET
```

複数ページを送信：

```bash
curl -X POST "https://hexapoint.pages.dev/api/indexnow?secret=YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"urls":["/","/blog/first-post"]}'
```

`Authorization: Bearer YOUR_SECRET` ヘッダーでも認証できます。

### レスポンス例

```json
{
  "ok": true,
  "indexnowStatus": 200,
  "meaning": "Accepted — search engines were notified.",
  "submitted": ["https://hexapoint.pages.dev/"],
  "keyLocation": "https://hexapoint.pages.dev/c96a412c5d41125143ea5fa42129051f.txt"
}
```

`ok: false` の場合は `meaning` に原因が書かれます（403 = キー不一致、422 = ホスト不一致 など）。

### 安全設計

- シークレットが一致しないリクエストは 401 で拒否（総当たり対策としてタイミング差の出ない比較を使用）
- このサイト以外のホストの URL は送信対象から除外（他人のサイトを送信させられない）
- 重複 URL は自動で 1 件に統合、1 回あたり最大 100 URL

---

## 3. 独自ドメインを設定すると追加で使える機能

`pages.dev` は Cloudflare 所有のドメインなので、ゾーン単位の機能は使えません。
独自ドメイン（例：`hexapoint.jp`）を Cloudflare に追加すると、無料プランのままで以下が解放されます。

| 機能 | 効果 |
|---|---|
| **Crawler Hints** | IndexNow を全自動送信（上記 `/api/indexnow` が不要になります） |
| **Speed Brain** | 次ページを先読み。LCP 平均約 45% 改善。無料プランで既定 ON |
| **Bot Fight Mode / WAF** | 問い合わせフォーム・決済経路の保護を強化 |
| **Email Routing** | `info@例.jp` を既存メールへ無料転送。日本の顧客の信頼度向上 |
| **Always Online** | 障害時もキャッシュ済みページを配信 |

---

## 4. 無料相談の予約機能（Cal.com 連携）`/api/cal-slots` `/api/cal-book`

トップページ下部「無料相談を予約する」セクションは、フォームではなく実際の予約カレンダーです。
日本時間とサウジアラビア時間を並べて表示し、選んだ時間で [Cal.com](https://cal.com) に
自動で予約を作成します（確認メール・ビデオ通話リンクは Cal.com 側が自動送信）。

### 手順

1. [cal.com](https://cal.com) で無料アカウントを作成（すでにお持ちならログインでOK）
2. **Event Types** → 新規作成 → 例：「無料相談 / Free Consultation」（30分）
   - Availability（対応可能時間）を日本の営業時間に合わせて設定
   - 作成後、そのイベントタイプの URL または管理画面に表示される数値 ID を控える
     （分からない場合は `GET https://api.cal.com/v2/event-types` で一覧取得可能）
3. **Settings → Developer → API keys** で API キーを発行（`cal_` または `cal_live_` で始まる）
4. Cloudflare ダッシュボード → Pages プロジェクト → **Settings → Environment variables** に追加：

| 変数名 | 値 |
|---|---|
| `CAL_API_KEY` | 手順3で発行した API キー |
| `CAL_EVENT_TYPE_ID` | 手順2のイベントタイプの数値 ID |

`TURNSTILE_SECRET_KEY` は問い合わせフォームと共用します（すでに設定済みのはずです）。

### 直前予約を防ぐ（最低2日前まで）＋ 日時変更・キャンセルの確認

**最低予約通知期間（2日前まで）**

サイト側（日付選択の候補・`/api/cal-slots`・`/api/cal-book`）はすでに
「今日から2日以内の予約」をすべて拒否するようにコードで実装済みです
（`index.html` の `MIN_NOTICE_DAYS`、両方の Function の同名定数）。

ただし、これはあくまで二重の安全策です。**本来の制御は Cal.com 側の設定で行ってください**：

1. Cal.com → 対象の Event Type → **Limits** タブ
2. **Minimum notice**（最低通知期間）を **2 days** に設定

こうすることで、Cal.com 自身の空き時間計算からも直前の時間帯が最初から除外されます
（コード側の制限と設定がずれないよう、両方とも「2日」に揃えてください）。

**日時変更・キャンセル**

Cal.com は予約完了時に送る確認メールに、お客様自身で「日時変更」「キャンセル」できる
リンクを標準で含めます（当サイト側の追加実装は不要）。念のため以下を確認してください：

1. Cal.com → 対象の Event Type → **Advanced** タブ
2. **Disable Cancelling**・**Disable Rescheduling** が両方とも **オフ（無効）** になっていることを確認
   （オンにすると、お客様は自分で日時変更・キャンセルができなくなります）

### 動作の仕組み

- `/api/cal-slots?date=YYYY-MM-DD` — Cal.com の空き時間を取得するプロキシ。API キーはサーバー側にのみ存在し、ブラウザには渡りません。
- `/api/cal-book` — Turnstile を検証したうえで Cal.com に予約を作成するプロキシ。
- 予約完了後のメール送信・カレンダー招待・日時変更/キャンセルのリンクは Cal.com が自動で行うため、この機能自体は追加のメール設定を必要としません。

> ⚠️ どちらの環境変数も未設定の場合、予約セクションは「時間を選んでください」のまま
> 空き時間が表示されません（`server_not_configured` エラーがブラウザのコンソールに出ます）。

---

## 5. 既存機能に必要な環境変数（再掲）

問い合わせフォームと決済を動かすには以下が必要です。

**メール送信（Resend）**
`RESEND_API_KEY` · `CONTACT_TO` · `CONTACT_FROM`

**ボット対策**
`TURNSTILE_SECRET_KEY`

**Stripe**（オンライン決済 — PayPal は完全に廃止済み）
`STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET`

Stripe Dashboard → Developers/Workbench → API keys で Secret key（`sk_live_...`）を取得し、
Webhooks で `https://hexapoint.pages.dev/api/stripe-webhook` を登録（イベント：
`checkout.session.completed`）して発行される Signing secret（`whsec_...`）を設定してください。
テストする場合は Test mode の鍵（`sk_test_...`）と、Test mode で作成した別の Webhook の
`whsec_...` を使います（本番用とは別物です）。

**KV 名前空間のバインド**
`ORDERS_KV`（Settings → Functions → KV namespace bindings）

**注文記録（D1 データベース）**

注文は Google Sheets ではなく Cloudflare D1（本物のデータベース）に記録されます。
Settings → Functions → D1 database bindings で、バインディング名 **`DB`** として
D1 データベースをこの Pages プロジェクトに紐付けてください。バインド後、
`migrations/0001_orders.sql` と `migrations/0002_order_notes.sql`（メモ機能追加分）を
一度ずつ適用する必要があります
（`wrangler d1 execute <DB名> --file=migrations/0001_orders.sql --remote`、
`0002_order_notes.sql` も同様に）。詳しい手順はチャットで案内します。

**管理画面（`/admin.html` と `/api/admin/*`）の保護**

このサイトは独自ドメインなしの `hexapoint.pages.dev` で運用されているため、
**Cloudflare Access は使えません**（Access の Self-hosted アプリは自分が所有する
ゾーンのドメインしか選べず、`pages.dev` は Cloudflare 自身のゾーンのため対象外です）。
代わりに管理画面自体にパスワードログイン機能を組み込みました
（`functions/_shared/admin-auth.js` — 署名付き HttpOnly セッションクッキー方式、
サーバー側にセッション情報を保存しない）。

Cloudflare Pages → Settings → Environment variables に以下を **Secret** として追加してください：

| 変数名 | 値 |
|---|---|
| `ADMIN_PASSWORD` | 管理画面ログイン用のパスワード（長め・使い回さない文字列を推奨） |
| `ADMIN_SESSION_SECRET` | セッション署名専用のランダム文字列（生成例：`openssl rand -hex 32`） |

`TURNSTILE_SECRET_KEY` はログインフォームの Bot 対策にもそのまま再利用されるため、
追加設定は不要です（すでに設定済みのはずです）。

ログイン試行はサーバー側でも IP ごとに 15 分あたり最大 5 回まで制限しています
（`ORDERS_KV` を利用）。これらの環境変数を設定し忘れると、管理画面に一切ログイン
できなくなります（`ADMIN_PASSWORD`／`ADMIN_SESSION_SECRET` が未設定の間は
ログイン API が 500 エラーを返します）。

> ⚠️ **Stripe は Checkout（ホスト型決済ページ）方式です。**
> `index.html` に Stripe の SDK は一切読み込まれていません — 「Pay with Stripe」ボタンを押すと
> サーバー側で Checkout Session を作成し、ブラウザを Stripe のページへ直接リダイレクトします。
> 本番決済を正しく受け付けるには、`STRIPE_SECRET_KEY` を **Live** の Secret key
> （`sk_live_...`）にし、Live mode で作成した Webhook の `whsec_...` を
> `STRIPE_WEBHOOK_SECRET` に設定してください。Test 用の鍵のままデプロイすると
> テスト決済しか通りません（実際の入金にはなりません）。

---

## 6. 公開後の確認チェックリスト

以下がすべて正常に開くことを確認してください。

- [ ] `https://hexapoint.pages.dev/`
- [ ] `https://hexapoint.pages.dev/robots.txt`
- [ ] `https://hexapoint.pages.dev/sitemap.xml`
- [ ] `https://hexapoint.pages.dev/og-image.png`
- [ ] `https://hexapoint.pages.dev/c96a412c5d41125143ea5fa42129051f.txt`
- [ ] Google Search Console にサイトを追加し、`sitemap.xml` を送信
- [ ] Bing Webmaster Tools に Google Search Console からインポート
- [ ] Rich Results Test で構造化データを検証
