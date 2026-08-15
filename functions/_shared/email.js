// Shared helper: sends an order-confirmation email through Resend.
// Used by both paypal-capture-order.js (immediate confirmation) and
// paypal-webhook.js (reliable fallback confirmation).

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendOrderConfirmation(env, { buyer, plan, orderID, amount }) {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) {
    console.error("Resend not configured, skipping order confirmation email");
    return { ok: false, error: "not_configured" };
  }

  const receivedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

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

        <tr><td style="height:6px;background:linear-gradient(90deg,${EMERALD},${EMERALD_DEEP});"></td></tr>

        <tr>
          <td style="padding:32px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;letter-spacing:.12em;color:${EMERALD_DEEP};font-weight:700;">
              HEXAPOINT
            </div>
            <div style="font-family:${SERIF};font-size:24px;color:${INK};margin-top:6px;">
              新しいお支払い<span style="opacity:.5;font-size:16px;"> / New Payment</span>
            </div>
            <div style="font-family:${SANS};font-size:12px;color:${INK};opacity:.5;margin-top:8px;">
              ${esc(receivedAt)} 受信
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 36px 0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("プラン", "Plan", `${plan.nameJa} / ${plan.nameEn}`)}
              ${row("金額", "Amount", `¥${Number(amount).toLocaleString("ja-JP")}`)}
              ${row("注文ID", "Order ID", orderID)}
              ${row("お名前", "Name", buyer.name)}
              ${row("メール", "Email", buyer.email)}
              ${row("電話番号（日本）", "Phone (Japan)", buyer.phone)}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:11px;letter-spacing:.06em;color:${INK};opacity:.55;margin-bottom:8px;">
              ご住所 / ADDRESS
            </div>
            <div style="font-family:${SANS};font-size:14px;line-height:1.8;color:${INK};background:${MINT};
                        border:1px solid ${MINT_2};border-radius:14px;padding:18px 20px;white-space:pre-wrap;">
              ${esc(buyer.address).replace(/\n/g, "<br>")}
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <a href="mailto:${encodeURIComponent(buyer.email)}"
               style="display:inline-block;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;
                      background:${EMERALD_DEEP};text-decoration:none;padding:13px 26px;border-radius:999px;">
              ${esc(buyer.name)} 様に連絡する / Contact buyer →
            </a>
          </td>
        </tr>

        <tr><td style="height:1px;background:${LINE};"></td></tr>

        <tr>
          <td style="padding:18px 36px 28px 36px;">
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.45;line-height:1.6;">
              このメールは hexapoint.pages.dev の支払いフォームから自動送信されました。<br>
              This message was sent automatically after a successful payment on hexapoint.pages.dev.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `新しいお支払い / New Payment\n${receivedAt}\n\n` +
    `プラン / Plan: ${plan.nameJa} / ${plan.nameEn}\n` +
    `金額 / Amount: ¥${Number(amount).toLocaleString("ja-JP")}\n` +
    `注文ID / Order ID: ${orderID}\n\n` +
    `お名前 / Name: ${buyer.name}\n` +
    `メール / Email: ${buyer.email}\n` +
    `電話番号 / Phone: ${buyer.phone}\n` +
    `ご住所 / Address: ${buyer.address}\n`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: env.CONTACT_TO,
        reply_to: buyer.email,
        subject: `【HexaPoint】新規お支払い / New payment — ${plan.nameJa}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend order confirmation error:", res.status, detail);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Order confirmation email request failed:", err);
    return { ok: false, error: String(err) };
  }
}

// Sent when a Client chooses "Bank Transfer" in the order modal, instead of
// PayPal. Unlike sendOrderConfirmation(), no money has actually moved yet —
// this just tells the owner a bank-transfer order is expected, so they know
// to watch for the incoming transfer and can follow up with the Client.
export async function sendBankOrderNotification(env, { buyer, plan, orderID, amount }) {
  if (!env.RESEND_API_KEY || !env.CONTACT_TO || !env.CONTACT_FROM) {
    console.error("Resend not configured, skipping bank order notification email");
    return { ok: false, error: "not_configured" };
  }

  const receivedAt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  const INK = "#0e1633";
  const PAPER = "#fbf9f6";
  const MINT = "#fff1df";
  const MINT_2 = "#ffd9b0";
  const EMERALD = "#f5912a";
  const EMERALD_DEEP = "#e8631f";
  const CORAL = "#e63548";
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

        <tr><td style="height:6px;background:linear-gradient(90deg,${CORAL},${EMERALD_DEEP});"></td></tr>

        <tr>
          <td style="padding:32px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;letter-spacing:.12em;color:${EMERALD_DEEP};font-weight:700;">
              HEXAPOINT
            </div>
            <div style="font-family:${SERIF};font-size:24px;color:${INK};margin-top:6px;">
              銀行振込のご注文<span style="opacity:.5;font-size:16px;"> / Bank Transfer Order</span>
            </div>
            <div style="display:inline-block;margin-top:10px;font-family:${SANS};font-size:12px;font-weight:700;
                        color:#fff;background:${CORAL};padding:5px 12px;border-radius:999px;">
              入金確認待ち / AWAITING PAYMENT CONFIRMATION
            </div>
            <div style="font-family:${SANS};font-size:12px;color:${INK};opacity:.5;margin-top:10px;">
              ${esc(receivedAt)} 受信
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 36px 0 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${row("プラン", "Plan", `${plan.nameJa} / ${plan.nameEn}`)}
              ${row("予定金額", "Expected amount", `¥${Number(amount).toLocaleString("ja-JP")}`)}
              ${row("注文ID", "Order ID", orderID)}
              ${row("お名前", "Name", buyer.name)}
              ${row("メール", "Email", buyer.email)}
              ${row("電話番号（日本）", "Phone (Japan)", buyer.phone)}
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:11px;letter-spacing:.06em;color:${INK};opacity:.55;margin-bottom:8px;">
              ご住所 / ADDRESS
            </div>
            <div style="font-family:${SANS};font-size:14px;line-height:1.8;color:${INK};background:${MINT};
                        border:1px solid ${MINT_2};border-radius:14px;padding:18px 20px;white-space:pre-wrap;">
              ${esc(buyer.address).replace(/\n/g, "<br>")}
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:16px 36px 8px 36px;">
            <div style="font-family:${SANS};font-size:13px;line-height:1.8;color:${INK};opacity:.75;">
              銀行口座への入金をご確認のうえ、対応をお願いします。入金が確認できない場合は、
              お客様へ振込明細のご提示をお願いしてください。
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:24px 36px 32px 36px;">
            <a href="mailto:${encodeURIComponent(buyer.email)}"
               style="display:inline-block;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;
                      background:${EMERALD_DEEP};text-decoration:none;padding:13px 26px;border-radius:999px;">
              ${esc(buyer.name)} 様に連絡する / Contact buyer →
            </a>
          </td>
        </tr>

        <tr><td style="height:1px;background:${LINE};"></td></tr>

        <tr>
          <td style="padding:18px 36px 28px 36px;">
            <div style="font-family:${SANS};font-size:11px;color:${INK};opacity:.45;line-height:1.6;">
              このメールは hexapoint.pages.dev の注文フォーム（銀行振込選択時）から自動送信されました。<br>
              This message was sent automatically when a Client chose bank transfer on hexapoint.pages.dev.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text =
    `銀行振込のご注文 / Bank Transfer Order\n${receivedAt}\n` +
    `状態 / Status: 入金確認待ち / AWAITING PAYMENT CONFIRMATION\n\n` +
    `プラン / Plan: ${plan.nameJa} / ${plan.nameEn}\n` +
    `予定金額 / Expected amount: ¥${Number(amount).toLocaleString("ja-JP")}\n` +
    `注文ID / Order ID: ${orderID}\n\n` +
    `お名前 / Name: ${buyer.name}\n` +
    `メール / Email: ${buyer.email}\n` +
    `電話番号 / Phone: ${buyer.phone}\n` +
    `ご住所 / Address: ${buyer.address}\n`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.CONTACT_FROM,
        to: env.CONTACT_TO,
        reply_to: buyer.email,
        subject: `【HexaPoint】銀行振込のご注文 / Bank transfer order — ${plan.nameJa}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend bank order notification error:", res.status, detail);
      return { ok: false, error: `resend_${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Bank order notification email request failed:", err);
    return { ok: false, error: String(err) };
  }
}
