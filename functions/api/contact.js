// Cloudflare Pages Function
// Endpoint: POST /api/contact
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();
    const name = (data.name || "").toString().trim().slice(0, 200);
    const email = (data.email || "").toString().trim().slice(0, 200);
    const service = (data.service || "").toString().trim().slice(0, 200);
    const message = (data.message || "").toString().trim().slice(0, 5000);
    const turnstileToken = (data.turnstileToken || "").toString();

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!name || !email || !message || !emailRe.test(email)) {
      return json({ ok: false, error: "invalid_input" }, 400);
    }

    if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) {
      return json({ ok: false, error: "server_not_configured" }, 500);
    }

    // ----- Verify Cloudflare Turnstile token -----
    if (!env.TURNSTILE_SECRET_KEY) {
      return json({ ok: false, error: "turnstile_not_configured" }, 500);
    }
    if (!turnstileToken) {
      return json({ ok: false, error: "turnstile_missing" }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const verifyForm = new FormData();
    verifyForm.append("secret", env.TURNSTILE_SECRET_KEY);
    verifyForm.append("response", turnstileToken);
    if (ip) verifyForm.append("remoteip", ip);

    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: verifyForm }
    );
    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      console.error("Turnstile failed:", verifyData["error-codes"]);
      return json({ ok: false, error: "turnstile_failed" }, 403);
    }
    // ------------------------------------------------

    const receivedAt = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date());

    const { html, text } = buildEmail({ name, email, service, message, receivedAt });

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: env.CONTACT_TO,
        reply_to: email,
        subject: `【HexaPoint】お問い合わせ / New inquiry — ${name}`,
        html,
        text,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      console.error("Resend error:", resendRes.status, detail);
      return json({ ok: false, error: "resend_error" }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    console.error("Contact function error:", err);
    return json({ ok: false, error: "server_error" }, 500);
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Email-safe HTML: table-based layout, inline styles only, no external CSS/fonts,
// mirrors the HexaPoint site palette (ink / paper / emerald / mint).
function buildEmail({ name, email, service, message, receivedAt }) {
  const INK = "#0e1633";
  const PAPER = "#fbf9f6";
  const MINT = "#fff1df";
  const MINT_2 = "#ffd9b0";
  const EMERALD = "#f5912a";
  const EMERALD_DEEP = "#e8631f";
  const LINE = "#e3e0da";
  const SERIF = "'Hiragino Mincho ProN','Yu Mincho',Georgia,serif";
  const SANS = "'Hiragino Kaku Gothic ProN','Yu Gothic','Helvetica Neue',Arial,sans-serif";

  const row = (labelJp, labelEn, value) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};">
        <div style="font-family:${SANS};font-size:11px;letter-spacing:.06em;color:${INK};opacity:.55;margin-bottom:3px;">
          ${labelJp} / ${labelEn}
        </div>
        <div style="font-family:${SANS};font-size:15px;font-weight:600;color:${INK};">
          ${esc(value)}
        </div>
      </td>
    </tr>`;

  const html = `<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${PAPER};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
        style="max-width:600px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${LINE};">

        <!-- accent bar -->
        <tr><td style="height:6px;background:linear-gradient(90deg,${EMERALD},${EMERALD_DEEP});"></td></tr>

        <!-- header -->
        <tr>
          <td style="padding:32px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;letter-spacing:.12em;color:${EMERALD_DEEP};font-weight:700;">
              HEXAPOINT
            </div>
            <div style="font-family:${SERIF};font-size:24px;color:${INK};margin-top:6px;">
              新しいお問い合わせ<span style="opacity:.5;font-size:16px;"> / New Inquiry</span>
            </div>
            <div style="font-family:${SANS};font-size:12px;color:${INK};opacity:.5;margin-top:8px;">
              ${esc(receivedAt)} 受信
            </div>
          </td>
        </tr>

        <!-- info card -->
        <tr>
          <td style="padding:16px 36px 0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("お名前", "Name", name)}
              ${row("メール", "Email", email)}
              ${row("ご希望のサービス", "Service", service || "—")}
            </table>
          </td>
        </tr>

        <!-- message -->
        <tr>
          <td style="padding:24px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:11px;letter-spacing:.06em;color:${INK};opacity:.55;margin-bottom:8px;">
              ご相談内容 / MESSAGE
            </div>
            <div style="font-family:${SANS};font-size:14px;line-height:1.8;color:${INK};background:${MINT};
                        border:1px solid ${MINT_2};border-radius:14px;padding:18px 20px;white-space:pre-wrap;">
              ${esc(message).replace(/\n/g, "<br>")}
            </div>
          </td>
        </tr>

        <!-- reply button -->
        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <a href="mailto:${encodeURIComponent(email)}"
               style="display:inline-block;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;
                      background:${EMERALD_DEEP};text-decoration:none;padding:13px 26px;border-radius:999px;">
              ${esc(name)} 様に返信する / Reply →
            </a>
          </td>
        </tr>

        <tr><td style="height:1px;background:${LINE};"></td></tr>

        <!-- footer -->
        <tr>
          <td style="padding:18px 36px 28px 36px;">
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.45;line-height:1.6;">
              このメールは hexapoint.pages.dev のお問い合わせフォームから自動送信されました。<br>
              This message was sent automatically from the contact form on hexapoint.pages.dev.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `新しいお問い合わせ / New Inquiry\n` +
    `${receivedAt}\n\n` +
    `お名前 / Name: ${name}\n` +
    `メール / Email: ${email}\n` +
    `サービス / Service: ${service || "—"}\n\n` +
    `メッセージ / Message:\n${message}\n`;

  return { html, text };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
