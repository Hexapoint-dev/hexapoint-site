# HexaPoint — ربط Zoho Invoice (فوترة تلقائية بعد الدفع عبر Stripe)

هذا الملف توثيق فقط — ليس جزءًا من الموقع المنشور (حذفه لا يؤثر على عمل الموقع).

الكود جاهز بالفعل في `functions/_shared/zoho.js` وتم ربطه في `functions/_shared/stripe.js`.
كل ما تبقى هو إنشاء حساب Zoho Invoice وضبط متغيرات البيئة في Cloudflare.

---

## كيف يعمل الربط

بعد أن يدفع العميل عبر Stripe وتُؤكَّد عملية الدفع (سواء عبر التحويل الفوري من
المتصفح في `stripe-confirm-order.js`، أو عبر الـ webhook الاحتياطي في
`stripe-webhook.js` — كلاهما يمر عبر نفس الدالة `confirmStripeSession()`):

1. يتم البحث في Zoho عن جهة اتصال (Contact) بنفس بريد العميل، أو إنشاء واحدة جديدة إن لم توجد.
2. يتم إنشاء فاتورة (Invoice) في Zoho ببند واحد = اسم الباقة (basic / maintenance / annual) والمبلغ بالين الياباني.
3. يتم تسجيل دفعة (Payment) على نفس الفاتورة فورًا بحيث تظهر في Zoho بحالة **Paid** وليس **Unpaid**.

هذا **لا يحدث** لطلبات التحويل البنكي (`bank-order.js`) لأن الدفع فيها لم يتم فعليًا بعد —
تمامًا كما طلبت: الفوترة فقط بعد إتمام الدفع عبر Stripe.

العملية **لا تُفشل الدفع أبدًا**: أي خطأ من Zoho (توكن منتهي، حساب غير مُهيأ، حد الخطة
المجانية...) يُسجَّل في السجلات فقط (`console.error`) والعميل لا يشعر بأي شيء — نفس
فلسفة التعامل مع Resend الموجودة حاليًا.

كما أن العملية **idempotent**: إعادة محاولة تأكيد نفس الطلب (retry من Stripe) لا تُنشئ
فاتورة مكررة، بفضل مفتاح `invoiced:<orderID>` في `ORDERS_KV`.

افتراضيًا، Zoho **لا** يرسل الفاتورة بالبريد للعميل (لأن الموقع أصلاً يرسل بريد تأكيد
جميل عبر Resend فور الدفع) — الفاتورة تُنشأ فقط لتبقى في سجلات Zoho المحاسبية. إن رغبت
لاحقًا أن يستلم العميل نسخة PDF من Zoho أيضًا، فعّل `ZOHO_AUTO_EMAIL_INVOICE` (انظر أدناه).

---

## الخطوة 1 — إنشاء حساب Zoho Invoice (الباقة المجانية)

1. اذهب إلى https://www.zoho.com/invoice/ واضغط **GET STARTED FREE** (أو سجّل دخول
   إن كان لديك حساب Zoho من قبل).
2. أكمل التسجيل (بريد + كلمة مرور، أو "Sign in with Google").
3. عند إنشاء المؤسسة (Organization) لأول مرة سيظهر نموذج يطلب: اسم الشركة،
   نوع النشاط (Industry)، **العملة الأساسية (Base Currency)**، المنطقة الزمنية.
   اختر **Japanese Yen — JPY** في حقل العملة الأساسية.

   > ⚠️ **مهم جدًا:** الموقع يُسعّر كل الباقات بالين الياباني (`priceJPY` في
   > `functions/_shared/plans.js`). الباقة المجانية من Zoho Invoice **لا تدعم
   > تعدد العملات** (Multi-Currency ميزة مدفوعة فقط) — أي فاتورة تُنشأ عبر الـ
   > API ستُحسب بعملة المؤسسة الأساسية دون أي تحويل. لو اخترت عملة غير JPY هنا
   > عن طريق الخطأ، **لا يمكن تغييرها لاحقًا من الإعدادات** — الحل الوحيد هو حذف
   > هذه المؤسسة (Settings → Organization Profile → Delete Organization) وإنشاء
   > مؤسسة جديدة من الصفر بعملة JPY الصحيحة قبل متابعة الخطوات التالية.

4. بعد الدخول للوحة التحكم، انظر لرابط المتصفح (address bar). سيكون مثل
   `https://invoice.zoho.com/app#/...` أو `https://invoice.zoho.eu/app#/...` إلخ.
   الجزء بعد `zoho.` هو الـ **Data Center** الخاص بحسابك:
   - `zoho.com` → أمريكا (الأشيع/الافتراضي)
   - `zoho.eu` → أوروبا
   - `zoho.in` → الهند
   - `zoho.com.au` → أستراليا
   - `zoho.jp` → اليابان
   اكتبه جانبًا — ستحتاجه في كل خطوة قادمة (وهو قيمة `ZOHO_DC`).

**لن تحتاج للبحث عن Organization ID يدويًا** — في الخطوة 2 سنحصل عليه تلقائيًا
عبر استدعاء API، وهو أدق من البحث في الواجهة (لأن مكان "Organization Profile"
يتغيّر أحيانًا بين تحديثات Zoho).

---

## الخطوة 2 — إنشاء Self Client في Zoho API Console

بما أن الفوترة تحدث تلقائيًا من السيرفر (بدون أي إنسان يضغط "تسجيل الدخول" في كل
مرة)، نحتاج "Self Client" — طريقة Zoho الرسمية للوصول من سيرفر إلى سيرفر بدون
واجهة OAuth تفاعلية.

### 2.1 — الحصول على Client ID و Client Secret

1. اذهب إلى `https://api-console.zoho.<DC>/` — استبدل `<DC>` بما لاحظته في
   الخطوة 1.4 (مثلًا `api-console.zoho.com` أو `api-console.zoho.eu`).
2. سجّل دخول بنفس حساب Zoho المستخدم لإنشاء المؤسسة في الخطوة 1.
3. إن كانت أول مرة تستخدم فيها API Console، ستظهر صفحة ترحيبية — اضغط
   **GET STARTED**.
4. اضغط **ADD CLIENT** (زر في الأعلى، عادة بجانب "All Clients").
5. ستظهر 4 بطاقات: Server-based Applications, Client-based Applications,
   Mobile-based Applications, **Self Client**. اختر **Self Client**.
6. اكتب أي اسم في **Client Name** (مثلًا `HexaPoint Site`) واضغط **CREATE**.
7. بعد الإنشاء مباشرة، ستنتقل لصفحة الـ Client وسترى تبويب **Client Secret**
   مفتوحًا افتراضيًا، فيه:
   - **Client ID**: يبدأ بـ `1000.` متبوعًا بحروف/أرقام طويلة.
   - **Client Secret**: سلسلة أطول من الحروف والأرقام.

   > هذان الحقلان **دائمان** — يمكنك الرجوع إليهما لاحقًا من نفس الصفحة (API
   > Console → Self Client الذي أنشأته → تبويب Client Secret) دون الحاجة لإعادة
   > إنشاء شيء، خلافًا للكود في الخطوة التالية الذي ينتهي خلال دقائق.

انسخ القيمتين الآن — هما `ZOHO_CLIENT_ID` و `ZOHO_CLIENT_SECRET`.

### 2.2 — توليد Authorization Code (صالح لدقائق فقط، استخدام واحد)

1. في نفس صفحة الـ Self Client، اضغط تبويب **Generate Code**.
2. املأ الحقول:
   - **Scope**: انسخ والصق بالضبط: `ZohoInvoice.fullaccess.all`
   - **Time Duration**: اختر أعلى قيمة متاحة في القائمة (عادة `10 minutes`).
   - **Scope Description**: أي نص، مثلًا `HexaPoint site integration`.
3. اضغط **CREATE**.
4. سيظهر مربع فيه **Authorization Code** طويل (يبدأ بـ `1000.` أيضًا). **انسخه
   فورًا** — صالح لمرة استخدام واحدة فقط ولفترة قصيرة (الدقائق التي اخترتها)، وإن
   انتهت المهلة أو استُخدم مرة، يجب توليد كود جديد بإعادة نفس الخطوات 2.2.

### 2.3 — تبديل الكود بـ Refresh Token (خلال نفس الدقائق)

بمجرد نسخ الكود، بادله فورًا عبر الطرفية بطلب POST. استبدل القيم بين `<>`
واحرص أن يكون النطاق `accounts.zoho.<DC>` بنفس الـ DC المستخدم في الخطوة 2.1
(وليس بالضرورة `.com` إن كان حسابك في منطقة أخرى):

**PowerShell** (هذا هو الشِل الافتراضي في بيئتك):

```powershell
$r = Invoke-RestMethod -Method Post -Uri "https://accounts.zoho.com/oauth/v2/token" -Body @{
  grant_type    = "authorization_code"
  client_id     = "<CLIENT_ID>"
  client_secret = "<CLIENT_SECRET>"
  code          = "<AUTHORIZATION_CODE>"
}
$r | Format-List
```

**bash / curl** (بديل):

```bash
curl -X POST "https://accounts.zoho.com/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "code=<AUTHORIZATION_CODE>"
```

سيعيد الطلب JSON يحتوي:
- `access_token` — مؤقت (ساعة تقريبًا)، لكن سنستخدمه فورًا في الخطوة التالية لجلب الـ Organization ID.
- **`refresh_token`** — هذا هو المطلوب (`ZOHO_REFRESH_TOKEN`)، **دائم** ولا ينتهي
  إلا إذا ألغيته يدويًا من Zoho أو أعدت توليد كود جديد لنفس الـ Self Client (كل
  عملية تبديل ناجحة تصدر refresh token جديد يُلغي الأقدم ضمنيًا في بعض الحالات —
  لذلك بعد نجاح هذه الخطوة، استخدم القيمة التي حصلت عليها هنا مباشرة في Cloudflare
  ولا تكرر 2.2/2.3 لاحقًا بلا داعٍ).

### 2.4 — الحصول على Organization ID عبر نفس الـ access_token

بدل البحث في واجهة Zoho، استخدم الـ `access_token` الذي ظهر للتو (صالح لساعة):

**PowerShell:**

```powershell
Invoke-RestMethod -Uri "https://www.zohoapis.com/invoice/v3/organizations" `
  -Headers @{ Authorization = "Zoho-oauthtoken <ACCESS_TOKEN>" }
```

**bash / curl:**

```bash
curl -H "Authorization: Zoho-oauthtoken <ACCESS_TOKEN>" \
  "https://www.zohoapis.com/invoice/v3/organizations"
```

(استبدل `zohoapis.com` بـ `zohoapis.<DC>` إن كان حسابك في منطقة غير `.com`.)

الاستجابة تحتوي مصفوفة `organizations`، كل عنصر فيه `organization_id` —
انسخ قيمة المؤسسة التي أنشأتها (غالبًا الوحيدة الظاهرة إن كان الحساب جديدًا)،
تأكد أن `currency_code` بجانبها يساوي `JPY` (تأكيد إضافي أن الخطوة 1.3 نُفذت بشكل صحيح).

هذه القيمة هي `ZOHO_ORGANIZATION_ID`.

### استكشاف الأخطاء الشائعة في هذه الخطوة

| الخطأ | السبب المرجّح | الحل |
|---|---|---|
| `invalid_code` | الكود انتهت مدته أو استُخدم مرة سابقًا | ارجع لـ 2.2 وولّد كودًا جديدًا، ونفّذ 2.3 فورًا |
| `invalid_client` | الـ Client ID/Secret خطأ، أو استخدمت نطاق `accounts.zoho.<DC>` مختلف عن الذي أنشأت فيه الـ Self Client | تأكد أن كل الروابط (api-console, accounts, zohoapis) تستخدم نفس `<DC>` من الخطوة 1.4 |
| استجابة فارغة/404 من `/organizations` | الـ access_token انتهى (مرّت أكثر من ساعة) أو النطاق `zohoapis.<DC>` خطأ | كرر 2.3 للحصول على access_token جديد (لا حاجة لكود جديد إن ما زال الطلب يعمل، وإلا كرر 2.2 أيضًا) |

---

## الخطوة 3 — إضافة متغيرات البيئة في Cloudflare Pages

اذهب إلى Cloudflare Dashboard → مشروع Pages → **Settings → Environment variables**،
وأضف التالي (كلها **Secret**، ماعدا `ZOHO_DC` يمكن أن يكون Plain text):

| المتغير | القيمة |
|---|---|
| `ZOHO_CLIENT_ID` | من الخطوة 2.1 |
| `ZOHO_CLIENT_SECRET` | من الخطوة 2.1 |
| `ZOHO_REFRESH_TOKEN` | من الخطوة 2.3 |
| `ZOHO_ORGANIZATION_ID` | من الخطوة 2.4 |
| `ZOHO_DC` | *(اختياري)* افتراضيًا `com` — غيّره فقط إن كان حسابك في منطقة أخرى (`eu`, `in`, `com.au`, `jp`, `ca`...) |
| `ZOHO_AUTO_EMAIL_INVOICE` | *(اختياري)* `true` لجعل Zoho يرسل نسخة الفاتورة بالبريد للعميل أيضًا. اتركه فارغًا/`false` للاكتفاء ببريد Resend الحالي. |

الموقع يعيد استخدام نفس KV namespace الموجود (`ORDERS_KV`) لتخزين access token
مؤقتًا (مدته ساعة تقريبًا) — لا حاجة لأي KV إضافي.

---

## الخطوة 4 — الاختبار

1. تأكد أن `STRIPE_SECRET_KEY` و`STRIPE_WEBHOOK_SECRET` في وضع **Test mode** مؤقتًا (مفاتيح `sk_test_...`).
2. نفّذ عملية دفع تجريبية كاملة من الموقع (بطاقة اختبار Stripe: `4242 4242 4242 4242`، أي تاريخ مستقبلي، أي CVC).
3. بعد نجاح الدفع، تحقق من:
   - **Cloudflare Pages → مشروعك → Functions logs**: يجب ألا تظهر رسالة `Zoho invoice creation failed` أو `zoho_token_refresh_failed`.
   - **Zoho Invoice → Invoices**: يجب أن تظهر فاتورة جديدة بحالة **Paid**، وباسم العميل التجريبي.
4. بعد التأكد أن كل شيء يعمل، أعد `STRIPE_SECRET_KEY` و`STRIPE_WEBHOOK_SECRET` إلى مفاتيح **Live** كما هو موضّح في `SETUP-cloudflare.md`.

---

## ملاحظات حول حدود الباقة المجانية

حدود Zoho Invoice المجانية (عدد الفواتير/العملاء شهريًا) تتغير من وقت لآخر من جهة
Zoho نفسها — راجع صفحة الأسعار الرسمية (zoho.com/invoice/pricing) قبل الإطلاق للتأكد
أن حجم طلباتك المتوقع لا يتجاوزها. إذا تجاوزت الحد، الـ API سيرجع خطأ وسيُسجَّل في
اللوغ فقط (`Zoho invoice creation failed`) دون أي تأثير على تجربة الدفع نفسها للعميل —
فقط لن تُنشأ فاتورة لتلك الطلبية، ويمكنك إنشاءها يدويًا من سجل الطلبات في `/admin.html`.
