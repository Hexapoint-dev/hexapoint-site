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

## 4. 既存機能に必要な環境変数（再掲）

問い合わせフォームと決済を動かすには以下が必要です。

**メール送信（Resend）**
`RESEND_API_KEY` · `CONTACT_TO` · `CONTACT_FROM`

**ボット対策**
`TURNSTILE_SECRET_KEY`

**PayPal**
`PAYPAL_CLIENT_ID` · `PAYPAL_SECRET` · `PAYPAL_ENV` · `PAYPAL_WEBHOOK_ID`

**注文記録（Google Sheets）**
`GOOGLE_SHEET_WEBHOOK_URL` · `GOOGLE_SHEET_SECRET`

**KV 名前空間のバインド**
`ORDERS_KV`（Settings → Functions → KV namespace bindings）

> ⚠️ **PayPal は現在サンドボックス（テスト）モードです。**
> `index.html` の SDK は `https://www.sandbox.paypal.com/web-sdk/v6/core` を読み込んでいます。
> 本番決済を受け付けるには、SDK を `https://www.paypal.com/web-sdk/v6/core` に変更し、
> `PAYPAL_ENV=live` と本番の Client ID / Secret を設定してください。
> この 3 つを揃えずに片方だけ変更すると決済が動作しません。

---

## 5. 公開後の確認チェックリスト

以下がすべて正常に開くことを確認してください。

- [ ] `https://hexapoint.pages.dev/`
- [ ] `https://hexapoint.pages.dev/robots.txt`
- [ ] `https://hexapoint.pages.dev/sitemap.xml`
- [ ] `https://hexapoint.pages.dev/og-image.png`
- [ ] `https://hexapoint.pages.dev/c96a412c5d41125143ea5fa42129051f.txt`
- [ ] Google Search Console にサイトを追加し、`sitemap.xml` を送信
- [ ] Bing Webmaster Tools に Google Search Console からインポート
- [ ] Rich Results Test で構造化データを検証
