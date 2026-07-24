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
}
