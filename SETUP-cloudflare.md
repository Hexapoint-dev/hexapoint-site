# HexaPoint — Cloudflare セットアップ / Cloudflare Setup

このファイルはサイトの一部として公開されるものではありません（削除しても動作に影響しません）。
This file is documentation only — it is not part of the published site.

---

## 1. Cloudflare Web Analytics（所要 2 分）

プライバシー重視・Cookie 不要のアクセス解析。実ユーザーの Core Web Vitals
（LCP / INP / CLS）を計測できます。Google がランキングに使う指標と同じものです。

> ✅ **設定済み** — `hexapoint.pages.dev` 用の token は `index.html` 末尾に
> すでに埋め込まれています。この beacon 方式はドメイン検証を行わない仕組みなので、
> `www.hexapoint-jp.com` に移行した後もそのまま同じ token で計測が続きます
> （追加作業なしで動作します）。

もし今後ダッシュボード上で `hexapoint.pages.dev` と `www.hexapoint-jp.com` の集計を
分けて見たい場合のみ、以下の手順で新しい token に切り替えてください（任意）：

1. Cloudflare ダッシュボード → **Web Analytics** → **Add a site**
2. `www.hexapoint-jp.com` を入力
3. 表示される新しい **token** をコピー
4. `index.html` 末尾の次の行にある token を、新しいものに置き換える：

```html
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js"
  data-cf-beacon='{"token": "14389d8b10c5493582583126eb3663da"}'></script>
```

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
https://www.hexapoint-jp.com/c96a412c5d41125143ea5fa42129051f.txt
```

### 使い方

トップページを送信：

```
https://www.hexapoint-jp.com/api/indexnow?secret=YOUR_SECRET
```

複数ページを送信：

```bash
curl -X POST "https://www.hexapoint-jp.com/api/indexnow?secret=YOUR_SECRET" \
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
  "submitted": ["https://www.hexapoint-jp.com/"],
  "keyLocation": "https://www.hexapoint-jp.com/c96a412c5d41125143ea5fa42129051f.txt"
}
```

`ok: false` の場合は `meaning` に原因が書かれます（403 = キー不一致、422 = ホスト不一致 など）。

### 安全設計

- シークレットが一致しないリクエストは 401 で拒否（総当たり対策としてタイミング差の出ない比較を使用）
- このサイト以外のホストの URL は送信対象から除外（他人のサイトを送信させられない）
- 重複 URL は自動で 1 件に統合、1 回あたり最大 100 URL

---

## 3. 独自ドメイン `www.hexapoint-jp.com` の接続手順

このサイトはこれまで `pages.dev`（Cloudflare 所有のドメイン）で運用されていましたが、
`www.hexapoint-jp.com` を購入済みのため、以下の手順で接続してください。

### 3.1 — ドメインのゾーン状態を確認（Cloudflare Registrar 経由の購入なら自動済み）

`hexapoint-jp.com` を **Cloudflare Registrar** 経由で購入した場合、他社レジストラ経由と違い
ネームサーバーの手動切り替えは**不要**です — 購入と同時に同じ Cloudflare アカウント内に
ゾーンが自動作成され、最初から Cloudflare のネームサーバーが使われます。

1. `dash.cloudflare.com` にログイン。
2. 左サイドバー（アカウントホーム）で **Websites**（または上部の **Manage Account** 隣、
   アカウントによっては単に一覧表示）を開き、`hexapoint-jp.com` の行を探す。
3. ステータス列が **Active**（緑）になっていることを確認。まれに購入直後は
   **Pending Nameservers** と出ることがあるが、Cloudflare Registrar 経由なら数分〜
   長くて1時間以内に自動で Active に変わる（何もする必要はない）。
4. `hexapoint-jp.com` の行をクリックしてそのゾーンのダッシュボードに入る。
5. 左メニュー **DNS → Records** を開き、既存レコードを確認。購入直後は空、または
   Cloudflare の既定パーキングページ用レコード（`CNAME @ → parking...` のようなもの）
   だけのはず。次の 3.2 で追加するレコードが自動でこれを置き換える・共存するので、
   今は削除しなくてよい。

### 3.2 — Pages プロジェクトにカスタムドメインとして接続

1. 左サイドバー **Compute (Workers)** → **Workers & Pages**（アカウントによっては
   直接 **Workers & Pages** と表示）を開く。
2. 一覧から対象の **Pages** プロジェクト（HexaPoint のサイト）をクリック。
3. 上部タブから **Custom domains** を選択。
4. **Set up a custom domain** ボタンをクリック。
5. 入力欄に `www.hexapoint-jp.com` と入力 → **Continue**。
6. 確認画面が出たら **Activate domain**（文言はバージョンにより多少異なる）をクリック。
   - 3.1 でゾーンがすでに Active なら、Cloudflare が自動で `www` の CNAME レコードを
     DNS に追加し、SSL証明書の発行も自動で始まる。
   - 反映まで通常**数秒〜数分**（証明書発行待ちで最大 24 時間とダッシュボードに
     表示されることもあるが、実際はほぼ即時〜十数分で完了することが多い）。
   - ステータスが **Active**（緑のチェック）になれば完了。
7. もう一度 **Set up a custom domain** を押し、今度は `hexapoint-jp.com`
   （**www を付けない**、ルート/apex ドメイン）を同じ手順で追加。
8. apex（www なし）を追加すると、Cloudflare Pages の Custom domains 画面がその行に
   **redirect to www.hexapoint-jp.com** のようなトグル／リンクを表示することが多い —
   表示されればそれを有効化するだけで完了。
   - 表示されない・見当たらない場合は手動で作る：
     1. そのゾーン（`hexapoint-jp.com`）のダッシュボードに戻り、左メニュー
        **Rules → Redirect Rules** を開く。
     2. **Create rule** → 名前は任意（例：`apex to www`）。
     3. **When incoming requests match** → **Custom filter expression** を選び、
        Field: `Hostname`、Operator: `equals`、Value: `hexapoint-jp.com` を設定
        （UI に応じて「Edit expression」からテキストで
        `(http.host eq "hexapoint-jp.com")` と直接書いてもよい）。
     4. **Then** の **Type** を **Dynamic** にし、
        **Expression**: `concat("https://www.hexapoint-jp.com", http.request.uri.path)`
        （クエリ文字列も維持したい場合は `http.request.uri` を使う）。
     5. **Status code**: `301`。
     6. **Save and Deploy**。
9. ブラウザで `https://www.hexapoint-jp.com/` を開き、サイトが正しく表示されることを確認。
   さらに `https://hexapoint-jp.com/`（www なし）も開き、`www.` へ自動で
   リダイレクトされることを確認。
   （`hexapoint.pages.dev` は Cloudflare の仕様上、完全に無効化することはできませんが、
   `functions/_middleware.js` により `www.hexapoint-jp.com` へ301リダイレクトされるように
   設定済みです — 詳細は 3.5節 参照。プレビューデプロイ用のURL
   （`<ハッシュ>.hexapoint.pages.dev` 等）はこのリダイレクトの対象外で、引き続き
   プレビュー確認に使えます。）

### 3.2b — SSL/TLS モードの確認（1回だけ）

1. そのゾーンのダッシュボード → 左メニュー **SSL/TLS → Overview**。
2. 暗号化モードが **Full** または **Full (strict)** になっていることを確認
   （**Flexible** になっていたら **Full** に変更）。Cloudflare Pages は常に HTTPS で
   応答するため、Flexible のままだとリダイレクトループなど不具合の原因になり得る。
3. 同じ **SSL/TLS** メニュー内 **Edge Certificates** タブで
   **Always Use HTTPS** を **On** にする（http:// でのアクセスを自動的に https:// へ）。

### 3.3 — 独自ドメインで新たに使える機能（無料プランのまま）

| 機能 | 効果 |
|---|---|
| **Crawler Hints** | IndexNow を全自動送信（上記 `/api/indexnow` が不要になります） |
| **Speed Brain** | 次ページを先読み。LCP 平均約 45% 改善。無料プランで既定 ON |
| **Bot Fight Mode / WAF** | 問い合わせフォーム・決済経路の保護を強化 |
| **Email Routing** | `info@hexapoint-jp.com` を既存メールへ無料転送。日本の顧客の信頼度向上 |
| **Always Online** | 障害時もキャッシュ済みページを配信 |
| **Cloudflare Access** | `/admin.html` と `/api/admin/*` の追加保護に使える機能だが、**2026-09-04 に削除済み**（下記参照）。代わりにアプリ内蔵の TOTP（認証アプリの6桁コード）を追加済み |

**Bot Fight Mode を有効化する手順（推奨・決済のあるサイトなので）：**
そのゾーン（`hexapoint-jp.com`）のダッシュボード → 左メニュー **Security → Bots** →
**Bot Fight Mode** のトグルを **On** にする。追加設定は不要、即座に有効。

**Email Routing を設定する手順（任意）：**
1. そのゾーンのダッシュボード → 左メニュー **Email → Email Routing**。
2. **Get started** → 案内に従い、宛先メールアドレス（今使っている実際の受信用メール、
   例えば普段お使いの Gmail アドレス）を **Destination addresses** に追加し、
   届く確認メールのリンクをクリックして承認。
3. **Routing rules** タブ → **Create address** → カスタムアドレス欄に `info` と入力
   （`info@hexapoint-jp.com` になる）→ 転送先に手順2で承認した宛先を選択 → **Save**。
4. Cloudflare が必要な MX / TXT レコードを DNS に自動追加する（確認ダイアログが出れば
   **Enable** をクリックするだけでよい）。

### 3.4 — Turnstile（Bot対策）に新ドメインを許可リスト登録 ⚠️ 忘れると壊れる

問い合わせフォーム・銀行振込フォーム・Stripe注文フォームの3箇所すべてが、
`index.html` に埋め込み済みの同じ Turnstile サイトキー
（`0x4AAAAAAD8H_SMh5X5eLg1u`）を使っています。このサイトキーは
**登録されたホスト名からのアクセスしか許可しない**設定になっているため、
新ドメインを追加登録しないと **3フォームすべてが動かなくなります**
（Turnstile ウィジェットがエラーになるか、送信時に `turnstile_failed` が返る）。

1. Cloudflare ダッシュボード → **Turnstile**。
2. 既存のサイト（このサイトキーに対応するもの）を開く → **Settings**。
3. **Domains** の欄に `www.hexapoint-jp.com` を追加（`hexapoint-jp.com` も念のため追加可）。
   既存の `hexapoint.pages.dev` はそのまま残して問題ありません（プレビュー環境で
   引き続き使えます）。
4. 保存後、`https://www.hexapoint-jp.com/` 上で問い合わせフォームを実際に送信して
   Turnstile が正常に通ることを確認してください。

### 3.5 — `hexapoint.pages.dev` を隠して独自ドメインに一本化する

Cloudflare Pages の仕様上、自動割り当てされる `<プロジェクト名>.pages.dev` は
完全に削除・無効化することができません。代わりに、`functions/_middleware.js`
（全リクエストの前段で必ず実行される Cloudflare Pages Function）で
`hexapoint.pages.dev`（本番エイリアス）へのアクセスを検知し、
`www.hexapoint-jp.com` の同じパスへ 301（恒久）リダイレクトするようにしています。

- コード変更のみで完結しており、Cloudflare 側の追加設定は不要です。
- **プレビューデプロイ用のURL**（`<コミットハッシュ>.hexapoint.pages.dev` や
  `<ブランチ名>.hexapoint.pages.dev` など）はこのリダイレクトの対象外のままです
  — 3.2節の注記どおり、マージ前の動作確認に引き続き使えます。
- 動作確認: シークレットウィンドウで `https://hexapoint.pages.dev/` を開き、
  `https://www.hexapoint-jp.com/` に自動でリダイレクトされることを確認してください。

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
Webhooks で `https://www.hexapoint-jp.com/api/stripe-webhook` を登録（イベント：
`checkout.session.completed`）して発行される Signing secret（`whsec_...`）を設定してください。
テストする場合は Test mode の鍵（`sk_test_...`）と、Test mode で作成した別の Webhook の
`whsec_...` を使います（本番用とは別物です）。

**ドメイン移行時、新しい Webhook エンドポイントへの切り替え手順（詳細）：**

1. `dashboard.stripe.com` にログイン → 右上が **Live mode** になっていることを確認
   （Test mode のままだと本番の Webhook を編集できない）。
2. 左メニュー **Developers**（新UIでは **Workbench**）→ **Webhooks**。
3. **Add endpoint**（または **+ Add destination**）をクリック。
4. **Endpoint URL**: `https://www.hexapoint-jp.com/api/stripe-webhook`
5. **Events to send** → **Select events** → 検索欄に `checkout.session.completed` と入力して
   チェック（`checkout.session.async_payment_succeeded` も既存設定に合わせて追加可）。
6. **Add endpoint** で保存。
7. 作成された endpoint の詳細画面で **Signing secret** の **Reveal**（または **Click to reveal**）
   をクリックし、`whsec_...` をコピー。
8. Cloudflare ダッシュボード → 対象 Pages プロジェクト → **Settings → Environment variables**
   → `STRIPE_WEBHOOK_SECRET`（Production 環境）を編集し、コピーした新しい値に置き換えて保存
   → 保存後は再デプロイが必要な場合あり（Pages は環境変数変更後、次のデプロイから反映されるのが
     基本。すぐ反映したい場合は **Deployments** タブから最新デプロイを **Retry deployment**）。
9. 動作確認：`https://www.hexapoint-jp.com/` で実際に少額のテスト決済（Test mode の鍵に一時的に
   戻すか、Stripe の **Send test webhook** 機能を使う）を行い、新しい endpoint の **Recent deliveries**
   に `200 OK` が記録されることを確認。
10. 新しい endpoint が確実に動作していることを確認できたら、**古い**
    `.../pages.dev/api/stripe-webhook` を指す endpoint は Webhooks 一覧から選んで
    **Delete**（またはまず **Disable** にして数日様子を見てから削除）してよい。

**KV 名前空間のバインド**
`ORDERS_KV`（Settings → Functions → KV namespace bindings）

**注文記録（D1 データベース）**

注文は Google Sheets ではなく Cloudflare D1（本物のデータベース）に記録されます。
Settings → Functions → D1 database bindings で、バインディング名 **`DB`** として
D1 データベースをこの Pages プロジェクトに紐付けてください。バインド後、
`migrations/0001_orders.sql`・`migrations/0002_order_notes.sql`（メモ機能）・
`migrations/0003_finance_features.sql`（Zoho請求書ステータス追跡＋管理操作履歴。
会計/更新/履歴タブに必須）・`migrations/0004_status_reason.sql`・
`migrations/0005_admin_settings.sql`・`migrations/0006_plans.sql`・
`migrations/0007_contact_messages.sql`（お問い合わせタブに必須）を
一度ずつ適用する必要があります
（`wrangler d1 execute <DB名> --file=migrations/0001_orders.sql --remote`、
以降の番号も同様に1つずつ実行）。詳しい手順はチャットで案内します。

**管理画面（`/admin.html` と `/api/admin/*`）の保護**

このサイトは元々、独自ドメインなしの `hexapoint.pages.dev` で運用されていたため
（Access の Self-hosted アプリは自分が所有するゾーンのドメインしか選べず、
`pages.dev` は Cloudflare 自身のゾーンのため対象外でした）、管理画面自体に
パスワードログイン機能を組み込みました（`functions/_shared/admin-auth.js` —
署名付き HttpOnly セッションクッキー方式、サーバー側にセッション情報を保存しない）。

`www.hexapoint-jp.com` を独自ドメインとして接続したことで、一時期 **Cloudflare Access**
（Google ログイン + Google Authenticator）を `/admin.html` と `/api/admin/*` の前段に
重ねて二段構えにしていましたが、**2026-09-04 に削除**しました。

削除理由：管理画面の「パスワードでログイン」ボタンは JS の `fetch()` でバックグラウンド
通信します。Access のセッション（Cookie）が切れた状態でこの `fetch` を叩くと、Access が
Google のログイン画面へリダイレクトしようとしますが、`fetch` はページ遷移ではないため
その別ドメインへのリダイレクトを追えず、ブラウザ側で `Failed to fetch` という分かりにくい
エラーになって完全にログインできなくなる、という問題が発生しました。タブを開きっぱなしに
していると Access セッションだけが裏で切れるため再現しやすく、実用上ロックアウトの
リスクが高いと判断し、Access は使わずに既存のパスワードログイン（`admin-auth.js`・
署名付き HttpOnly セッションクッキー）のみで運用することにしました。

削除の手順（Cloudflare ダッシュボードで実施・コード変更は不要）：
1. `dash.cloudflare.com` → 左メニュー最下部 **Zero Trust**。
2. **Access → Applications** → `HexaPoint Admin`（または同等の名前のアプリ）を開き、
   右上の **Delete** でアプリごと削除。
   （アプリを消さずポリシーだけ残すと再度ロックアウトの原因になるため、アプリごと削除を推奨）
3. 他の Zero Trust アプリで Google ログインを使っていなければ、**Settings → Authentication
   → Login methods** から **Google** を削除してよい（任意・必須ではない）。
4. Google Cloud 側で作成した OAuth クライアント（手順Aで作成したもの）も、他で使っていなければ
   `console.cloud.google.com` → **APIs & Services → Credentials** から削除してよい（任意）。
5. 削除後、シークレットウィンドウで `https://www.hexapoint-jp.com/admin.html` を開き、
   Google のログイン画面を経由せず直接パスワードログイン画面が表示されることを確認。

Access を削除した代わりに、`fetch` で完結する二段階認証（TOTP・認証アプリの6桁コード）を
パスワードログインの中に直接組み込みました（`functions/_shared/totp.js`・
`functions/api/admin/verify-totp.js`）。別ドメインへのリダイレクトが一切発生しないため、
Access で起きた `Failed to fetch` の問題は構造的に起こりません。

**TOTP の設定手順**

1. ランダムな秘密鍵（Base32・20バイト）を1つだけ生成します。チャットで生成してもらった
   ものをそのまま使うか、自分で生成する場合は例えば：
   ```
   node -e "const c=require('crypto');const b=c.randomBytes(20);const a='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let s='';for(const x of b)s+=x.toString(2).padStart(8,'0');let o='';for(let i=0;i+5<=s.length;i+=5)o+=a[parseInt(s.slice(i,i+5),2)];console.log(o);"
   ```
2. その値を Cloudflare Pages → Settings → Environment variables に
   `ADMIN_TOTP_SECRET` として **Secret** で追加（下表参照）。
3. 認証アプリ（Google Authenticator / Authy など）で「手動でキーを入力」を選び：
   - アカウント名: 任意（例 `HexaPoint Admin`）
   - キー: 手順1で生成した Base32 の値
   - 種類: **時間ベース（Time-based）**
   で追加。QRコードは使わず手入力にすることで、秘密鍵が一切ネットワークを
   経由しません。
4. `ADMIN_TOTP_SECRET` を設定していない間は、この second factor は自動的に
   スキップされます（パスワードのみでログイン可能）ので、上記1〜3を終えてから
   有効になります。ロックアウトが心配な場合は、まず自分のテスト用の値で
   1〜3を試し、実際にログインできることを確認してから本番の秘密鍵に置き換えても
   構いません。
5. 万一 `ADMIN_TOTP_SECRET` を紛失・変更したくなった場合は、Cloudflare の
   環境変数を新しい値に上書きし、認証アプリ側も同じ新しい値で登録し直すだけです
   （サーバー側にセッション/秘密鍵の状態は保存されないため、他に手順は不要）。

Cloudflare Pages → Settings → Environment variables に以下を **Secret** として追加してください：

| 変数名 | 値 |
|---|---|
| `ADMIN_PASSWORD` | 管理画面ログイン用のパスワード（長め・使い回さない文字列を推奨） |
| `ADMIN_SESSION_SECRET` | セッション署名専用のランダム文字列（生成例：`openssl rand -hex 32`） |
| `ADMIN_TOTP_SECRET` | 認証アプリ用の Base32 秘密鍵（上記手順1で生成したもの。未設定ならTOTP自体がスキップされる） |

`TURNSTILE_SECRET_KEY` はログインフォームの Bot 対策にもそのまま再利用されるため、
追加設定は不要です（すでに設定済みのはずです）。

ログイン試行はサーバー側でも IP ごとに 15 分あたり最大 5 回まで制限しています
（`ORDERS_KV` を利用、パスワードと TOTP コードそれぞれ別カウントで）。これらの環境変数を
設定し忘れると、管理画面に一切ログインできなくなります（`ADMIN_PASSWORD`／
`ADMIN_SESSION_SECRET` が未設定の間はログイン API が 500 エラーを返します）。

> ⚠️ **Stripe は Checkout（ホスト型決済ページ）方式です。**
> `index.html` に Stripe の SDK は一切読み込まれていません — 「Pay with Stripe」ボタンを押すと
> サーバー側で Checkout Session を作成し、ブラウザを Stripe のページへ直接リダイレクトします。
> 本番決済を正しく受け付けるには、`STRIPE_SECRET_KEY` を **Live** の Secret key
> （`sk_live_...`）にし、Live mode で作成した Webhook の `whsec_...` を
> `STRIPE_WEBHOOK_SECRET` に設定してください。Test 用の鍵のままデプロイすると
> テスト決済しか通りません（実際の入金にはなりません）。

---

## 6. IndexNow の再送信（ドメイン移行後）

新ドメインでも鍵ファイルが正しく公開されているかを確認してから送信します。

1. `https://www.hexapoint-jp.com/c96a412c5d41125143ea5fa42129051f.txt` をブラウザで開き、
   ファイル内容がキー文字列**のみ**（`c96a412c5d41125143ea5fa42129051f`）で表示されることを確認。
2. `https://www.hexapoint-jp.com/api/indexnow?secret=YOUR_SECRET`
   （`YOUR_SECRET` は Cloudflare 環境変数 `INDEXNOW_SECRET` に設定した値）をブラウザで開く。
3. レスポンス JSON の `"ok": true` と `"indexnowStatus": 200`（または `202`）を確認。
   `submitted` 配列に `https://www.hexapoint-jp.com/` が入っていれば成功。

---

## 7. Google Search Console — ドメインプロパティの追加と検証

`www` と apex（www なし）の両方をまとめて管理できる **Domain property** 方式を推奨します
（DNS の TXT レコードでの検証が必要ですが、Cloudflare 上で完結します）。

1. https://search.google.com/search-console にアクセスし、Google アカウントでログイン。
2. 左上の **プロパティを追加**（Add property）をクリック。
3. 表示される2つの選択肢のうち、左側 **ドメイン**（Domain）を選び、`hexapoint-jp.com`
   （`https://` も `www.` も付けない）と入力 → **続行**（Continue）。
4. **TXT レコードをドメインの DNS 設定に追加してください** という画面が出て、
   `google-site-verification=xxxxxxxxxxxxxxxxxxxxxxxxxxxx` のような値が表示される
   → この値全体をコピー。
5. 別タブで Cloudflare ダッシュボード → `hexapoint-jp.com` のゾーン → **DNS → Records** →
   **Add record**。
   - **Type**: `TXT`
   - **Name**: `@`（ルートを表す）
   - **Content**: 手順4でコピーした `google-site-verification=...` の値をそのまま貼り付け
     （引用符は付けない）
   - **TTL**: Auto のまま → **Save**。
6. Search Console のタブに戻り、**確認**（Verify）をクリック。DNS 反映が早ければ即成功、
   反映待ちの場合は数分後に再試行。
7. 検証が成功したら、左メニュー **サイトマップ**（Sitemaps）→
   **新しいサイトマップの追加** に `sitemap.xml` とだけ入力（フルURLは不要）→ **送信**。
8. ステータスが **成功しました**（Success）になるまで数分〜数時間待つ（即結果が出なくても正常）。

> 補足：以前 `hexapoint.pages.dev` を別プロパティとして登録していた場合、それは残したままで
> 問題ありません（Search Console 上で新旧2つのプロパティが並存するだけです）。

---

## 8. Bing Webmaster Tools — Search Console からのインポート

1. https://www.bing.com/webmasters にアクセスし、Microsoft アカウントでログイン。
2. 初回は **Import from Google Search Console**（または **Get Started** → インポートのオプション）
   を選択。
3. Google アカウントへのアクセスを許可 → Search Console に登録済みのプロパティ一覧が表示される
   ので `hexapoint-jp.com`（手順7で追加したドメインプロパティ）にチェックを入れてインポート。
4. インポート完了後、Bing 側でもサイトマップが自動登録されているか
   **Sitemaps** メニューで確認（されていなければ `https://www.hexapoint-jp.com/sitemap.xml`
   を手動で追加）。

---

## 9. 公開後の最終確認チェックリスト

以下がすべて正常に開く・動作することを確認してください。

- [ ] `https://www.hexapoint-jp.com/`（サイト本体が正しく表示される）
- [ ] `https://hexapoint-jp.com/` → `https://www.hexapoint-jp.com/` に自動リダイレクトされる
- [ ] `https://www.hexapoint-jp.com/robots.txt`
- [ ] `https://www.hexapoint-jp.com/sitemap.xml`
- [ ] `https://www.hexapoint-jp.com/og-image.png`
- [ ] `https://www.hexapoint-jp.com/c96a412c5d41125143ea5fa42129051f.txt`（キー文字列のみ表示）
- [ ] 問い合わせフォームを実際に送信 → Turnstile が通り、メールが届く（3.4 節）
- [ ] 銀行振込フォームを実際に送信 → Turnstile が通り、メールが届く
- [ ] Stripe 決済フローをテスト決済で最後まで実行 → 成功ページ表示 → 確認メール到着 →
      Stripe Dashboard の新しい Webhook endpoint に `200 OK` が記録される（5節）
- [ ] `/admin.html` にログインできる、かつ上記テスト注文が一覧に表示される
- [ ] Google Search Console にドメインプロパティを追加し、`sitemap.xml` を送信（7節）
- [ ] Bing Webmaster Tools に Google Search Console からインポート（8節）
- [ ] https://search.google.com/test/rich-results （Rich Results Test）で構造化データを検証

---

## 10. 管理画面の「分析 / Analytics」タブ（Google Search Console 連携）

管理画面（`/admin.html`）に、Google Search Console の検索パフォーマンス
データをそのまま表示する「分析」タブがあります
（`functions/api/admin/search-console.js` ・ `functions/_shared/google.js`）。
Zoho 連携と同じ仕組みで、Cloudflare 側に Service Account の認証情報を
Secret として設定するだけで動きます（管理画面のコード自体は変更不要）。

このタブはすでに `/admin.html` と `/api/admin/*` のパスワードログインの内側にあるため、
追加の認証は不要です。

**前提条件**: 7節「Google Search Console — ドメインプロパティの追加と検証」が
完了している必要があります（TXTレコードでの検証が済み、`sc-domain:hexapoint-jp.com`
というドメインプロパティが Search Console 上に存在する状態）。まだの場合は
先に7節を終わらせてください。

### 手順A — Google Cloud で Service Account を作成

既存の Google Cloud プロジェクト（他の連携ですでに使っているものがあれば）を
流用しても、新規作成しても構いません。

1. https://console.cloud.google.com/ → 対象プロジェクトを選択。
2. 検索バーで **Service Accounts** と入力して開く（または
   **IAM & Admin → Service Accounts**）。
3. **+ Create Service Account** → 名前は任意（例: `search-console-reader`）→
   **Create and Continue** → ロールの割り当てはスキップして構いません
   （Search Console 側の権限は手順Bで別途付与します）→ **Done**。
4. 作成された Service Account の行をクリック → **Keys** タブ →
   **Add Key → Create new key** → 形式は **JSON** を選択 → **Create**。
   → JSON ファイルが自動でダウンロードされます（これが唯一のコピーです。
   紛失した場合はキーを作り直す必要があります）。
5. 検索バーで **Google Search Console API** と入力し、そのAPIのページで
   **Enable** をクリック（プロジェクトで未有効化の場合のみ表示されます）。

### 手順B — Search Console にアクセス権を付与

Search Console 自体には「Viewer専用の招待」という概念はなく、
**Settings → Users and permissions** から直接ユーザーを追加する形になります。

1. https://search.google.com/search-console/ → 対象プロパティ
   （`hexapoint-jp.com` のドメインプロパティ）を開く。
2. 左メニュー **Settings** → **Users and permissions**。
3. **Add user**。
4. ダウンロードした JSON ファイルを開き、`client_email` の値
   （`xxxx@xxxx.iam.gserviceaccount.com` の形式）をコピーしてメールアドレス欄に貼り付け。
5. Permission は **Full**（読み取り専用の API 呼び出しには Full で問題なく、
   Restricted だと弾かれるケースがあるため Full を推奨）→ **Add**。

### 手順C — Cloudflare に環境変数を設定

| 変数名 | 値 | 備考 |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | JSON の `client_email` | そのままコピー |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | JSON の `private_key` | `-----BEGIN PRIVATE KEY-----` から `-----END PRIVATE KEY-----` まで全部（改行込み）をそのまま貼り付けてOK |
| `SEARCH_CONSOLE_SITE_URL` | `sc-domain:hexapoint-jp.com` | 7節で作成したドメインプロパティの識別子。`https://` は付けない |

Cloudflare Pages → Settings → Environment variables で、3つとも **Secret** として
Production 環境に追加 → 保存後は次回デプロイから反映されます
（すぐ反映したい場合は Deployments タブから最新デプロイを **Retry deployment**）。

タブの一番上には**サイトマップの状態**も表示されます（最終読み込み日時・送信数/
インデックス済み数・エラー/警告件数）— 7節で送信した `sitemap.xml` を Google が
実際に読み込めているかをここで確認できます。追加の権限設定は不要です
（`webmasters.readonly` スコープに含まれます）。

その他の機能：
- **前期間比**（クリック数・表示回数の下に「+12% 前期間比」のように表示）— 直前の
  同じ長さの期間と自動比較します。
- **期間指定**（7/28/90日のボタンに加えて、日付を直接指定するカスタム期間も選択可能）。
- **CSVで書き出す** — 現在表示中のデータ一式（サイトマップ状態を除く）をCSVで出力。

### 動作確認

1. `/admin.html` にログイン → 「分析 / Analytics」タブを開く。
2. サイトマップの状態カードに `sitemap.xml` の行が表示され、送信数/インデックス済み数が
   出ていれば成功（送信直後は「未読み込み」のままのことがあり、正常です — Google が
   実際に読みに来るまで数時間〜数日かかることがあります）。
3. クリック数・表示回数などの数値が表示されれば成功
   （集計期間はタブ上部に表示されます — Search Console のデータには
   2〜3日ほどの反映遅延があるため、「今日」までではなく数日前までの期間になります）。
3. 「Google Search Console が未設定です」という表示のままの場合は、上記3つの
   環境変数のいずれかが未設定か、Search Console 側の Users and permissions に
   Service Account が正しく追加されていません。

> 表示されるデータは 30 分ごとにキャッシュされます（`ORDERS_KV` 使用）。
> タブ右上の「更新 / Refresh」ボタンでキャッシュを無視して即時再取得できます。

---

## 11. 管理画面の「システム状況 / Status」タブ（外部サービスの無料枠使用状況）

`/admin.html` に、このサイトが依存している外部サービスの無料枠使用状況をまとめて
表示するタブがあります（`functions/api/admin/status.js`）。表示内容：

| サービス | 表示内容 | 取得方法 |
|---|---|---|
| **Zoho Invoice** | 今年作成した請求書数 | 自社の D1 (`orders` テーブル) を集計 — Zoho への追加API呼び出しなし |
| **Resend** | 本日/今月の送信数 | 自己集計（送信成功のたびに `ORDERS_KV` のカウンタを加算） |
| **Cloudflare D1** | 本日の読み取り/書き込み行数 | Cloudflare GraphQL Analytics API |
| **Cloudflare KV** | 本日の read/write/delete/list 回数 | Cloudflare GraphQL Analytics API |
| **Cloudflare Pages** | 今月のビルド数 | Cloudflare REST API（Deployments一覧） |

⚠️ **Cloudflare の2項目（D1・KV）は技術的な注意点があります**: Cloudflare の
GraphQL Analytics API のフィールド名は今回の実装時点のドキュメントに基づいていますが、
Cloudflare 側で仕様が変わることがあります。もしタブに「エラー: cf_graphql_failed: ...」
のような表示が出たら、そのエラーメッセージ全文をコピーして開発者に共有してください
（Cloudflare 側が返す正確なフィールド名がエラーの中に含まれているので、修正が簡単です）。
Zoho・Resend・Cloudflare Pages の部分にはこの種のリスクはありません。

### 手順A — Cloudflare API Token を作成

これは D1/KV バインディング（`env.DB` / `env.ORDERS_KV`）とは**別物**です。
バインディングはデータの読み書き専用で、使用量そのものを取得する権限は持っていません。

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token**。
2. **Create Custom Token** → **Get started**。
3. Token name: 任意（例: `hexapoint-usage-readonly`）。
4. **Permissions** に以下の2行を追加：
   - `Account` / `Account Analytics` / `Read`
   - `Account` / `Cloudflare Pages` / `Read`
5. **Account Resources**: **Include** → 対象アカウントを選択。
6. **Continue to summary** → **Create Token** → 表示されたトークンをコピー
   （このページを閉じると二度と表示されません）。

### 手順B — 必要なIDを控える

1. **Account ID**: Cloudflare ダッシュボードの任意のゾーン概要ページ、または
   **Workers & Pages** 概要ページの右下に表示されています。
2. **D1 Database ID**: **Workers & Pages → D1** → 対象データベースを開く →
   概要ページに ID（UUID形式）が表示されます。
3. **KV Namespace ID**: **Workers & Pages → KV** → `ORDERS_KV` に紐付けている
   Namespace の行に ID が表示されています。
4. **Pages Project Name**: Pages プロジェクトの設定ページ、または
   `xxxxx.pages.dev` の `xxxxx` の部分（例: `hexapoint`）。

### 手順C — Cloudflare に環境変数を設定

| 変数名 | 値 | 種別 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 手順Aで作成したトークン | Secret |
| `CLOUDFLARE_ACCOUNT_ID` | 手順B-1 | 通常の変数でも可 |
| `CLOUDFLARE_D1_DATABASE_ID` | 手順B-2 | 通常の変数でも可 |
| `CLOUDFLARE_KV_NAMESPACE_ID` | 手順B-3 | 通常の変数でも可 |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | 手順B-4 | 通常の変数でも可 |
| `ZOHO_FREE_PLAN_INVOICE_LIMIT` | （任意）Zoho の実際の年間請求書上限。未設定時は `1000` を仮の目安として使用 | 通常の変数でも可 |

D1・KV・Pages のいずれか1つだけ先に設定しても、その項目だけが動きます
（未設定の項目は「未設定です」と表示されるだけで、他の項目には影響しません）。

### 動作確認

1. `/admin.html` にログイン → 「システム状況 / Status」タブを開く。
2. Zoho・Resend は追加設定なしでもすぐ数字が出ます（Resend は今後の送信分から
   カウントが始まるため、最初は 0 のことがあります）。
3. Cloudflare の3項目は、上記の環境変数を設定した分だけ表示されます。

> データは 15 分ごとにキャッシュされます（`ORDERS_KV` 使用）。
> タブ右上の「更新 / Refresh」ボタンでキャッシュを無視して即時再取得できます。

---

## 12. 管理画面の「予約カレンダー / Calendar」タブ + Google Calendar 連携

このタブには2つの機能があります：

1. **ライブカレンダー（月表示）** — あなたの実際の Google Calendar の予定を
   月カレンダー形式でそのまま表示・追加・編集・削除できます
   （`functions/api/admin/calendar-events.js` ・ `functions/_shared/googlecalendar.js`）。
   ここで追加した予定（私用の予定・急な用事など）は Google Calendar に即座に反映され、
   Cal.com がその Google Calendar を見て予約可否を判断しているため（手順Aで接続）、
   **その時間は自動的にお客様の予約候補から外れます** — 二重に何かを設定する必要はありません。
2. **定期的な対応時間の設定** — 無料相談（4節・Cal.com連携）の毎週の対応可能時間と、
   特定の日だけ休み/特別時間にする「特別な日」を、Cal.com のダッシュボードに
   ログインしなくても編集できます（`functions/api/admin/calendar.js` ・
   `functions/_shared/calcom.js`）。

つまり「①ふだんの対応可能時間（②の定期設定）」から「①の中で今回だけ空けられない時間
（①のライブカレンダーに予定を追加）」を自動的に除いた時間だけが、実際にお客様に提示される
仕組みです。今後の予定はこのタブと Google Calendar の両方を、完全に信頼できる単一の情報源
として使えます。

### 手順A — Google Calendar を Cal.com に接続する（コードの変更不要）

これだけで「Googleカレンダーと連携」が完成します：
1. https://app.cal.com/apps/installed/calendar にアクセス（またはCal.comダッシュボード
   → **Settings → My Availability** 内の連携リンクから）。
2. **Google Calendar** を探して **Install/Connect**。
3. Googleアカウントでログインし、アクセスを許可。
4. 接続後、**Check for conflicts**（既存の予定と重複する時間を自動的に空き時間から除外）
   と、確認済み予約を自動でGoogleカレンダーに追加する設定を有効にしておく
   （通常はインストール時にデフォルトで有効）。

これで今まで通りのCal.com予約フローが、あなたのGoogleカレンダーとリアルタイムで
連動するようになります（既存の予定と自動で衝突回避、確定した相談はスマホの
カレンダーアプリにも表示）。

### 手順B — 管理画面の編集タブに必要な Schedule ID を控える

1. https://app.cal.com/availability にアクセス。
2. 無料相談のイベントタイプが使っているスケジュール（通常は「Working Hours」）を開く。
3. ブラウザのURLを確認: `https://app.cal.com/availability/12345` のような形式になっており、
   末尾の数字（例: `12345`）が Schedule ID。

### 手順C — Google Calendar API 用の Service Account を用意する

10節（Search Console）ですでに Service Account を作っている場合は、**そのまま
同じものを再利用できます**（`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_KEY`
は共通です）。まだ作っていない場合は10節の手順Aを先に行ってください。

1. 同じ Google Cloud プロジェクトで、検索バーに **Google Calendar API** と入力し、
   そのAPIのページで **Enable** をクリック（未有効化の場合のみ表示されます）。
2. それ以外の追加作業（新しいキーの発行など）は不要です。

### 手順D — あなたの Google Calendar を Service Account と共有する

GA4/Search Console と違い、Google Calendar は「プロパティへのアクセス権」ではなく
**カレンダー自体の共有設定**でアクセスを許可します。

1. https://calendar.google.com/ を開く。
2. 左側であなたのメインカレンダー（予定を管理しているカレンダー）にカーソルを合わせ、
   **⋮ → 設定と共有**（Settings and sharing）をクリック。
3. **特定のユーザーとの共有**（Share with specific people）→ **ユーザーを追加**。
4. Service Account の `client_email`（`xxxx@xxxx.iam.gserviceaccount.com` の形式。
   10節でダウンロードしたJSONファイルに記載）を入力。
5. 権限は **予定の変更権限**（Make changes to events）を選択 → **送信**。
6. 同じ設定画面を下にスクロールして **カレンダーの統合**（Integrate calendar）セクションを開き、
   **カレンダー ID**（Calendar ID）の値を控えておく（メインカレンダーの場合は、あなたの
   Googleアカウントのメールアドレスそのものです）。

これで Service Account がこのカレンダーの予定を読み書きできるようになります。

> ⚠️ **重要**: 「共有」しただけでは、そのカレンダーが Service Account にとっての
> "primary"（既定のカレンダー）にはなりません。"primary" は常に Service Account 自身の
> （あなたとは別の）カレンダーを指してしまうため、次の手順Eで**必ず手順D-6のカレンダーIDを
> 明示的に設定**してください。これを忘れると、追加した予定があなたのGoogleカレンダーには
> 一切反映されない（Service Account自身の見えないカレンダーに作成されてしまう）という
> 不具合になります。

### 手順E — Cloudflare に環境変数を設定

| 変数名 | 値 | 備考 |
|---|---|---|
| `CAL_SCHEDULE_ID` | 手順Bで控えた数字のID | `CAL_API_KEY`（4節ですでに設定済みのはず）を再利用します |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service Account の `client_email` | 10節ですでに設定済みなら再設定不要 |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service Account の `private_key` | 同上 |
| `GOOGLE_CALENDAR_ID` | **必須。** 手順D-6で控えたカレンダーID（メインカレンダーなら、あなたのメールアドレスそのもの） | ⚠️ `primary` という文字列は無効です — 必ず実際のメールアドレス/カレンダーIDを設定してください |

Cloudflare Pages → Settings → Environment variables に追加 → 保存後は次回デプロイから
反映されます（すぐ反映したい場合は Deployments タブから最新デプロイを
**Retry deployment**）。

### 動作確認

1. `/admin.html` にログイン → 「予約カレンダー / Calendar」タブを開く。
2. 上部に今月のカレンダーが表示され、Google Calendar に既にある予定が
   マス目の中に表示されていれば、ライブカレンダー機能は成功。
3. 空いている日をクリック（または「+ 予定を追加」）→ タイトル・時間を入力して保存 →
   実際にあなたの Google Calendar（スマホアプリでも可）にその予定が反映されているか確認。
4. その予定を追加した時間帯が、`https://www.hexapoint-jp.com/` の無料相談予約セクションで
   選べなくなっている（Cal.comの空き時間から除外されている）ことを確認
   — 反映まで数分かかる場合があります。
5. 下部の「定期的な対応時間の設定」で曜日ごとの対応可能時間と「特別な日」が
   表示されれば、そちらも成功。編集して **保存する / Save** を押し、同じく
   予約セクションに反映されているか確認してください。

> ⚠️ **技術的な注意**: 上の「定期的な対応時間の設定」が使っている Cal.com の Schedule API
> は今回の実装時点での仕様に基づいており、フィールド名などが実際と異なる可能性があります
> （Google Calendar 側のライブカレンダー機能は標準的な Google Calendar API を使っているため、
> こちらのリスクは低いです）。もしエラーが出た場合（特に「想定外の形式のデータが返って
> きました」と表示された場合）、画面に表示される生のJSON、またはエラーメッセージ全文を
> コピーして開発者に共有してください — 正確な形式が分かれば、修正は簡単です。

### 追加機能: 日本時間・サウジ時間の同時表示 ／ 日本・サウジアラビアの祝日表示

**追加の設定は一切不要です**（手順A〜Eの設定だけで動きます）。

- カレンダー右上に「🇯🇵 JST時刻 ・ 🇸🇦 AST時刻」がリアルタイム表示されます。
- 予定の追加/編集画面で、日本時間の入力に対応するサウジアラビア時間（AST）が
  自動計算されて表示されます（日付をまたぐ場合は「前日」「翌日」も表示）。
- 「今後の予定」リストには、日本時間とサウジアラビア時間の両方が表示されます。
- カレンダーの各マス目に、その日が日本の祝日および/またはサウジアラビアの祝日
  であれば小さく表示されます（`functions/_shared/googlecalendar.js` の
  `listJapanHolidays`/`listSaudiHolidays` が Google の公開祝日カレンダーを参照）。

> ⚠️ **技術的な注意（サウジアラビアの祝日のみ）**: 日本の祝日カレンダーID
> （`ja.japanese#holiday@group.v.calendar.google.com`）は Google の標準的なもので
> 確実に動作しますが、サウジアラビアの祝日カレンダーID
> （`en.sa#holiday@group.v.calendar.google.com`）は今回の実装時点での best-guess
> です。もしカレンダーにサウジアラビアの祝日が一切表示されない場合、この
> カレンダーIDが実際と異なっている可能性があります — その場合は開発者に
> お知らせください（日本側の祝日表示や他の機能には影響しません）。
