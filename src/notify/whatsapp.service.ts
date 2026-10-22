import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

export interface SendResult {
  ok: boolean;
  id?: string; // Meta message id (wamid)
  code?: number; // Meta error code
  error?: string;
}

/**
 * WhatsAppService — a thin client for Meta's WhatsApp Cloud API.
 *
 * Env (set on Render):
 *   WHATSAPP_TOKEN            permanent System User access token
 *   WHATSAPP_PHONE_NUMBER_ID  the business number's Phone Number ID (not the number itself)
 *   WHATSAPP_APP_SECRET       Meta app secret, verifies webhook signatures
 *   WHATSAPP_VERIFY_TOKEN     any string you choose; typed into the webhook setup
 *   WHATSAPP_API_VERSION      optional, default v25.0
 *   WHATSAPP_TEMPLATE_LANG    optional, default en
 *   WHATSAPP_API_BASE         optional, default https://graph.facebook.com (tests point it at a mock)
 *
 * Unconfigured → every send returns "not configured" and nothing leaves the server.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  get configured(): boolean {
    return !!(
      process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
    );
  }

  private url(): string {
    const base = (
      process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com'
    ).replace(/\/+$/, '');
    const ver = process.env.WHATSAPP_API_VERSION || 'v25.0';
    return `${base}/${ver}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  }

  /** Send an approved template with body variables in order. */
  sendTemplate(
    to: string,
    name: string,
    params: string[],
  ): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' },
        components: params.length
          ? [
              {
                type: 'body',
                parameters: params.map((text) => ({ type: 'text', text })),
              },
            ]
          : [],
      },
    });
  }

  /** Free-form text: only allowed within 24 h of the customer messaging us (e.g. replying to STOP). */
  sendText(to: string, body: string): Promise<SendResult> {
    return this.post({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });
  }

  private async post(payload: unknown): Promise<SendResult> {
    if (!this.configured)
      return { ok: false, error: 'WhatsApp is not configured on the server.' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(this.url(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const data: any = await res.json().catch(() => ({}));
      if (res.ok && data?.messages?.[0]?.id)
        return { ok: true, id: String(data.messages[0].id) };
      const err = data?.error || {};
      return {
        ok: false,
        code: err.code != null ? Number(err.code) : res.status,
        error:
          [err.message, err.error_data?.details].filter(Boolean).join(' — ') ||
          `HTTP ${res.status}`,
      };
    } catch (e: unknown) {
      /* network error / timeout: retryable */
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC(app secret, raw body).
   * No secret configured → only accepted outside production (local testing).
   */
  verifySignature(
    raw: Buffer | undefined,
    header: string | undefined,
  ): boolean {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error(
          'WHATSAPP_APP_SECRET not set: rejecting webhook (fail closed).',
        );
        return false;
      }
      return true;
    }
    if (!raw || !header?.startsWith('sha256=')) return false;
    const expected =
      'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected),
      b = Buffer.from(header);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
