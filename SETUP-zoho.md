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

> **ملاحظة:** إن كنت أنشأت حساب Zoho Invoice ومؤسسة بعملة JPY بالفعل من محاولة سابقة،
> يمكنك تخطي الخطوة 1 مباشرة للخطوة 2. الخطوة 2 أدناه أُعيد كتابتها بالكامل لتستخدم
> طريقة **Server-based Application** بدل **Self Client** — في محاولة سابقة واجهنا خطأ
> `invalid_code` متكررًا وغير قابل للتفسير مع Self Client رغم تجربة كل الاحتمالات
> (منطقة الحساب، الجلسة، التوقيت، إعادة الإنشاء بالكامل...)، وهذه الطريقة البديلة
> تعتمد على تدفق OAuth قياسي بموافقة فعلية عبر المتصفح بدل زر "توليد كود" الفوري الذي
> بدا معطلاً لهذا الحساب تحديدًا — وهي الطريقة الأكثر موثوقية والمستخدمة فعليًا من
> غالبية تكاملات Zoho الاحترافية.

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

## الخطوة 2 — إنشاء Server-based Application في Zoho API Console

هذا التدفق يمر بموافقة فعلية عبر المتصفح مرة واحدة فقط (تسجيل دخولك وموافقتك
الشخصية)، ثم يعطينا Refresh Token دائم نستخدمه بعدها من السيرفر تلقائيًا للأبد
بدون أي تدخل بشري إضافي — نفس النتيجة النهائية التي كان يفترض أن يعطينا إياها
Self Client، لكن عبر آلية مختلفة تمامًا لا تعتمد على زر "Generate Code" الفوري.

### 2.1 — إنشاء الـ Client

1. اذهب إلى `https://api-console.zoho.<DC>/` (بنفس الـ `<DC>` من الخطوة 1.4، على
   الأغلب `com`) وسجّل دخول بنفس حساب Zoho.
2. اضغط **ADD CLIENT**.
3. اختر البطاقة الأولى **Server-based Applications** (وليس Self Client هذه المرة).
4. املأ:
   - **Client Name**: `HexaPoint Site`
   - **Homepage URL**: `https://www.hexapoint-jp.com`
   - **Authorized Redirect URIs**: `https://www.hexapoint-jp.com`
     (نفس القيمة في الحقلين، والنطاق الحقيقي الحالي للموقع الآن)
5. اضغط **CREATE**.
6. في صفحة الـ Client الناتجة، تبويب **Client Secret** يعرض:
   - **Client ID** (يبدأ بـ `1000.`)
   - **Client Secret**
   انسخهما — هما `ZOHO_CLIENT_ID` و `ZOHO_CLIENT_SECRET`. دائمان، يمكن الرجوع
   إليهما لاحقًا من نفس الصفحة.

### 2.2 — الموافقة عبر المتصفح والحصول على الكود

1. **جهّز** رابط الموافقة بنفسك بلصق الـ `CLIENT_ID` الذي نسخته للتو مكان
   `<CLIENT_ID>` في هذا الرابط (لا تفتحه بعد):

   ```
   https://accounts.zoho.com/oauth/v2/auth?scope=ZohoInvoice.fullaccess.all&client_id=<CLIENT_ID>&response_type=code&access_type=offline&redirect_uri=https://www.hexapoint-jp.com&prompt=consent
   ```

   (استبدل `accounts.zoho.com` بـ `accounts.zoho.<DC>` إن كان حسابك في منطقة غير `com`.)

2. الصق الرابط الكامل (بعد التعديل) في متصفحك وافتحه.
3. سجّل دخول (إن لم تكن مسجلاً) بنفس حساب Zoho، ثم ستظهر شاشة موافقة رسمية من
   Zoho تسألك السماح للتطبيق "HexaPoint Site" بالوصول لـ Zoho Invoice — اضغط
   **Accept**.
4. سيُعيد المتصفح توجيهك لرابط مثل:
   `https://www.hexapoint-jp.com/?code=1000.xxxxxxxx...&location=us&accounts-server=https://accounts.zoho.com`
   — **الصفحة قد تظهر فارغة أو "غير موجودة" (طبيعي، لا يوجد شيء فعلي بهذا
   المسار)، هذا لا يهم**. المهم هو محتوى **شريط عنوان المتصفح نفسه**.
5. انسخ من شريط العنوان القيمة الكاملة لباراميتر `code=` (تبدأ بـ `1000.` وتنتهي
   عادة عند علامة `&location=`). هذا الكود صالح لدقائق قليلة فقط ولاستخدام واحد
   — تابع للخطوة التالية فورًا.

### 2.3 — تبديل الكود بـ Refresh Token

نفّذ فورًا (يجب أن يتطابق `redirect_uri` هنا حرفيًا مع ما استخدمته في رابط
الموافقة أعلاه — هذا إلزامي لهذا النوع من الـ Client، بخلاف Self Client):

```powershell
$r = Invoke-RestMethod -Method Post -Uri "https://accounts.zoho.com/oauth/v2/token" -Body @{
  grant_type    = "authorization_code"
  client_id     = "<CLIENT_ID>"
  client_secret = "<CLIENT_SECRET>"
  redirect_uri  = "https://www.hexapoint-jp.com"
  code          = "<CODE_FROM_URL_BAR>"
}
$r | Format-List
```

الاستجابة تحتوي `access_token` (مؤقت، صالح لساعة، نستخدمه فورًا في 2.4) و
**`refresh_token`** — هذا هو `ZOHO_REFRESH_TOKEN` المطلوب، دائم.

### 2.4 — الحصول على Organization ID عبر نفس الـ access_token

```powershell
Invoke-RestMethod -Uri "https://www.zohoapis.com/invoice/v3/organizations" `
  -Headers @{ Authorization = "Zoho-oauthtoken <ACCESS_TOKEN>" }
```

الاستجابة فيها مصفوفة `organizations` — انسخ `organization_id`، وتأكد أن
`currency_code` بجانبها = `JPY`. هذه القيمة هي `ZOHO_ORGANIZATION_ID`.

### استكشاف الأخطاء الشائعة في هذه الخطوة

| الخطأ | السبب المرجّح | الحل |
|---|---|---|
| شاشة موافقة Zoho لا تظهر، أو خطأ "invalid redirect_uri" | قيمة Redirect URI في 2.1 لا تطابق حرفيًا ما في رابط 2.2 | تأكد أن كلاهما بالضبط `https://www.hexapoint-jp.com` (بدون `/` في النهاية) |
| `invalid_code` عند التبديل | تأخرت في نسخ الكود من شريط العنوان، أو نسيت `redirect_uri` في طلب 2.3 | كرر من 2.2 (رابط موافقة جديد) وبادل فورًا، مع التأكد من وجود `redirect_uri` في الطلب |
| `invalid_client` | الـ Client ID/Secret خطأ، أو نطاق `accounts.zoho.<DC>` غير مطابق لمكان إنشاء الـ Client | تأكد من تطابق `<DC>` في كل الروابط |

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
