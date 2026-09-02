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
   （`hexapoint.pages.dev` は接続後も引き続きプレビュー用として動作し続けます — 消す必要はありません。）

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
| **Cloudflare Access** | `/admin.html` と `/api/admin/*` の追加保護として利用可能に（任意・下記5節参照。現状のパスワードログインのままでも問題ありません） |

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
会計/更新/履歴タブに必須）を一度ずつ適用する必要があります
（`wrangler d1 execute <DB名> --file=migrations/0001_orders.sql --remote`、
`0002_order_notes.sql`・`0003_finance_features.sql` も同様に）。詳しい手順はチャットで案内します。

**管理画面（`/admin.html` と `/api/admin/*`）の保護**

このサイトは元々、独自ドメインなしの `hexapoint.pages.dev` で運用されていたため
（Access の Self-hosted アプリは自分が所有するゾーンのドメインしか選べず、
`pages.dev` は Cloudflare 自身のゾーンのため対象外でした）、管理画面自体に
パスワードログイン機能を組み込みました（`functions/_shared/admin-auth.js` —
署名付き HttpOnly セッションクッキー方式、サーバー側にセッション情報を保存しない）。

`www.hexapoint-jp.com` を独自ドメインとして接続した今は、**Cloudflare Access**
（3.3 節）を `/admin.html` と `/api/admin/*` の前段に追加で重ねることも可能になりました
（任意）。ただし現状のパスワードログインは単体でも安全に機能しているため、Access の
追加は必須ではありません。

**Cloudflare Access を追加する手順（Google ログイン + Google Authenticator を使う場合）**

Cloudflare Access 自体には「認証アプリ（TOTP）」を単独のログイン方式として選ぶ機能は
ありません。実際に Google Authenticator を関与させるには、Access のログイン方法として
**Google** を選び、その Google アカウント側で 2 段階認証（Authenticator アプリ）を
有効にしておく、という構成になります。手順は以下のとおりです。

*手順A — Google Cloud で OAuth クライアントを作成*
1. https://console.cloud.google.com/ でプロジェクトを選択（新規でも既存でもOK）。
2. **APIs & Services → OAuth consent screen** → User Type は個人アカウントなら
   **External** を選び、アプリ名（例: `HexaPoint Admin`）とサポートメールを入力して保存。
   公開ステータスは **Testing** のままで問題ありません（**Test users** に自分の
   Gmail アドレスを追加）。
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**。
   - Application type: **Web application**
   - **Authorized redirect URIs** に次を追加（`<team-name>` は手順Bで決める
     Cloudflare Zero Trust のチーム名）：
     `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback`
   - 作成後に表示される **Client ID** と **Client secret** を控えておく。

*手順B — Cloudflare Zero Trust に Google ログインを追加*
1. Cloudflare ダッシュボード → 左メニュー最下部 **Zero Trust**（初回はチーム名の
   設定を求められます。手順Aのリダイレクト URI の `<team-name>` と一致させること）。
2. **Settings → Authentication → Login methods → Add new → Google**。
3. 手順Aで控えた Client ID / Client secret を貼り付けて保存。

*手順C — 保護対象アプリケーションとポリシーを作成*
1. **Access → Applications → Add an application → Self-hosted**。
2. Application name: `HexaPoint Admin`。Session duration は決済のある管理画面なので
   短め（例: `24 hours`）を推奨。
3. Public hostname に `www.hexapoint-jp.com` / Path `/admin.html` を設定し、
   **+ Add public hostname** で同じホスト名 / Path `/api/admin/*` をもう1行追加
   （両方を保護しないと API に直接アクセスされてしまいます）。
4. **Identity providers** で Google のみを選択（他のログイン方式は外す）。
5. **Policies → Add a policy** → Action: **Allow** → Include の Selector を
   **Emails** にし、管理画面へのログインを許可する Google アカウントの
   メールアドレスを追加。
6. 保存して発行。

*手順D — Google アカウント側で Google Authenticator を有効化*
すでに2段階認証を設定済みなら不要です。未設定の場合：
1. https://myaccount.google.com/security → **2段階認証プロセス** を有効化。
2. **認証システムアプリ** を追加し、Google Authenticator アプリでQRコードをスキャン。

*動作確認*
1. シークレットウィンドウで `https://www.hexapoint-jp.com/admin.html` を開く。
2. Cloudflare Access のログイン画面 → **Google でログイン** → 手順Cで許可した
   Gmail を選択 → Google のパスワード → Google Authenticator の6桁コードを入力。
3. 通過すると初めて `admin.html` が表示され、続けて既存のパスワードログイン画面
   （`admin-auth.js`）が出ます — つまり二重の壁になります。
4. 許可していないメールアドレスでログインを試し、Access の段階で
   `Access Denied` になることも確認してください。

> ⚠️ 自分がロックアウトされないよう、Policy の Emails には必ず先に自分の
> Gmail アドレスを追加してから保存してください。万一ロックアウトしても、
> Cloudflare ダッシュボード自体（`dash.cloudflare.com`）へのログインとは別物なので、
> そこから Access の設定はいつでも編集・削除できます。

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
