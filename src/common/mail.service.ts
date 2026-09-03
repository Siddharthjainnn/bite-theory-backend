import { Injectable, Logger } from '@nestjs/common';

/**
 * Optional transactional email (order confirmation / delivered / cancelled).
 * Uses nodemailer over SMTP. If SMTP env vars are missing, every send is a
 * silent no-op — the app works fine without email configured.
 *
 * Env: SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, MAIL_FROM
 * Gmail works with an App Password (Google Account → Security → App passwords).
 *
 * Requires: npm install nodemailer   (backend repo)
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: any = null;
  private ready = false;

  constructor() {
    const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
      this.logger.log('SMTP not configured — order emails disabled.');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const nodemailer = require('nodemailer');
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      this.ready = true;
    } catch (e) {
      this.logger.warn('nodemailer not installed — run `npm i nodemailer` to enable emails.');
    }
  }

  /** Whether SMTP is configured and emails can actually be sent (#4). */
  get isReady(): boolean { return !!this.ready; }

  /**
   * Awaited send that reports what happened. Only for the admin smoke test —
   * ordinary callers should use send(), which can never throw into a request.
   */
  async sendAndReport(
    to: string, subject: string, html: string,
    headers?: Record<string, string>,
  ) {
    if (!this.ready) return { ok: false, error: 'SMTP not configured' };
    try {
      const info = await this.transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to, subject, html, headers,
      });
      return { ok: true, messageId: info?.messageId ?? null, accepted: info?.accepted ?? [] };
    } catch (e: any) {
      /* Surfaced verbatim: 'Invalid login' means the App Password is wrong,
         'ETIMEDOUT' means the host/port is blocked. Both are unguessable
         without the real message. */
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** Fire-and-forget: never let an email failure break an order. */
  send(to: string | null | undefined, subject: string, html: string) {
    if (!this.ready || !to) return;
    this.transporter
      .sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html })
      .catch((e: any) => this.logger.warn(`Email to ${to} failed: ${e?.message}`));
  }

  orderPlacedHtml(o: {
    orderNumber: string; total: number;
    items: { productName: string; quantity: number; lineTotal: number }[];
    deliveryAddress?: string | null;
  }) {
    const rows = o.items
      .map((i) => `<tr><td style="padding:4px 8px">${i.productName} × ${i.quantity}</td>
        <td style="padding:4px 8px;text-align:right">₹${i.lineTotal}</td></tr>`)
      .join('');
    return `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#0D3B2E">🛎️ Order ${o.orderNumber} confirmed!</h2>
        <p>We've started preparing your food. Track it live in the app.</p>
        <table style="width:100%;border-collapse:collapse;background:#f7f7f5;border-radius:8px">${rows}
          <tr><td style="padding:8px;font-weight:bold;border-top:1px dashed #ccc">Total</td>
              <td style="padding:8px;text-align:right;font-weight:bold;border-top:1px dashed #ccc">₹${o.total}</td></tr>
        </table>
        ${o.deliveryAddress ? `<p style="color:#666;font-size:13px">📍 ${o.deliveryAddress}</p>` : ''}
        <p style="color:#999;font-size:12px">Bites Theory — thanks for ordering!</p>
      </div>`;
  }

  statusHtml(orderNumber: string, title: string, body: string) {
    return `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
        <h2 style="color:#0D3B2E">${title}</h2>
        <p>Order <b>${orderNumber}</b>: ${body}</p>
        <p style="color:#999;font-size:12px">Bites Theory</p>
      </div>`;
  }

  /**
   * Coupon / thank-you email for a bulk send.
   *
   * Deliberately plain HTML with inline styles and no images: Gmail strips
   * <style> blocks, and an image-heavy first email from a new sending domain
   * is a strong spam signal. Table-free single-column layout renders the same
   * in Gmail, Outlook and every phone client.
   */
  couponHtml(o: {
    firstName?: string | null;
    code: string;
    headline: string;
    description?: string | null;
    minOrder?: number | null;
    validUntil?: Date | string | null;
    siteUrl: string;
    unsubscribeUrl: string;
  }) {
    const hi = o.firstName ? `Hi ${o.firstName},` : 'Hi there,';
    const valid = o.validUntil
      ? new Date(o.validUntil).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'long', year: 'numeric',
        })
      : null;

    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0D3B2E">
  <h2 style="color:#0D3B2E;margin:0 0 4px">Thank you for joining Bites Theory</h2>
  <p style="font-size:15px;line-height:1.6;margin:14px 0 6px">${hi}</p>
  <p style="font-size:15px;line-height:1.6;margin:0 0 18px">
    Thanks for signing up with us. Here is a coupon to get you started —
    100% pure veg, freshly cooked, delivered across Indore.
  </p>

  <div style="border:2px dashed #4CAF50;border-radius:14px;padding:18px;text-align:center;background:#e8f5e9">
    <div style="font-size:13px;font-weight:bold;color:#2e7d32;letter-spacing:1px">${o.headline}</div>
    <div style="font-size:30px;font-weight:bold;letter-spacing:4px;color:#0D3B2E;margin:10px 0">${o.code}</div>
    <div style="font-size:12.5px;color:#4a5a52">
      ${o.description ? o.description + '<br>' : ''}
      ${o.minOrder ? `On orders above ₹${o.minOrder}. ` : ''}
      ${valid ? `Valid till ${valid}.` : ''}
    </div>
  </div>

  <p style="text-align:center;margin:24px 0">
    <a href="${o.siteUrl}" style="background:#0D3B2E;color:#ffffff;text-decoration:none;
       padding:13px 30px;border-radius:24px;font-size:15px;font-weight:bold;display:inline-block">
      Order now
    </a>
  </p>

  <p style="font-size:12.5px;color:#6b7d74;line-height:1.6;margin:22px 0 0">
    Apply the code at checkout. Questions? Just reply to this email.
  </p>
  <p style="font-size:11.5px;color:#9aa8a1;line-height:1.6;margin:14px 0 0;border-top:1px solid #e4ebe6;padding-top:12px">
    You are receiving this because you created a Bites Theory account.
    <a href="${o.unsubscribeUrl}" style="color:#9aa8a1">Unsubscribe</a>
  </p>
</div>`;
  }
}
