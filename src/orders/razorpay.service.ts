import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Razorpay = require('razorpay');

/**
 * Thin wrapper around the Razorpay SDK.
 * Reads keys from env: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 * In TEST mode the key id starts with rzp_test_ and no real money moves.
 */
@Injectable()
export class RazorpayService {
  private readonly keyId = process.env.RAZORPAY_KEY_ID || '';
  private readonly keySecret = process.env.RAZORPAY_KEY_SECRET || '';
  private readonly webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  private client: any;

  private get instance() {
    if (!this.keyId || !this.keySecret) {
      throw new InternalServerErrorException(
        'Razorpay keys not configured on the server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).',
      );
    }
    if (!this.client) {
      this.client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    }
    return this.client;
  }

  get isConfigured() {
    return !!(this.keyId && this.keySecret);
  }

  /** Create a Razorpay order for the given rupee amount. Returns { id, amount, currency }. */
  async createOrder(amountRupees: number, receipt: string) {
    const amountPaise = Math.round(amountRupees * 100);
    if (amountPaise < 100) {
      throw new BadRequestException('Amount must be at least ₹1 for online payment');
    }
    try {
      const order = await this.instance.orders.create({
        amount: amountPaise,
        currency: 'INR',
        receipt,
        payment_capture: 1,
      });
      return { id: order.id, amount: order.amount, currency: order.currency };
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.error?.description || 'Could not create Razorpay order',
      );
    }
  }

  /**
   * Fetch a Razorpay order and return its amount in paise.
   * Used at checkout to confirm the amount actually paid matches the
   * server-priced cart total (signature alone doesn't prove the amount).
   */
  async fetchOrderAmountPaise(orderId: string): Promise<number> {
    try {
      const order = await this.instance.orders.fetch(orderId);
      return Number(order.amount);
    } catch {
      throw new BadRequestException('Could not verify payment amount with Razorpay');
    }
  }

  /**
   * Verify the signature Razorpay returns to the browser after payment.
   * signature === HMAC_SHA256(order_id + "|" + payment_id, key_secret)
   */
  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!orderId || !paymentId || !signature) return false;
    const expected = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    // constant-time compare
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /**
   * Verify a webhook payload signature.
   * signature === HMAC_SHA256(raw_request_body, webhook_secret)
   * The webhook secret is the one YOU type when creating the webhook in the
   * Razorpay dashboard — it is NOT the key secret.
   */
  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (!this.webhookSecret || !signature || !rawBody) return false;
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  /* ───────────────── Doorstep UPI QR (pay-on-delivery, no cash) ─────────────────
     NOTE: QR Codes is an ON-DEMAND Razorpay feature. Raise a request with
     Razorpay support to enable it, or these calls will fail with a 400. */

  /**
   * Mint a single-use, fixed-amount UPI QR for one order.
   *
   * `fixed_amount: true` is what makes this safe: Razorpay itself rejects any
   * payment that is not EXACTLY this amount, so the customer cannot underpay
   * and we can never be tricked into marking an order paid for ₹1.
   * `single_use` means the QR closes itself after one payment — it can't be
   * screenshotted and reused by a second customer.
   *
   * orderId is stamped into `notes` so the webhook can find its way home.
   */
  async createQrCode(amountRupees: number, orderId: number, ttlMinutes = 30) {
    const amountPaise = Math.round(amountRupees * 100);
    if (amountPaise < 100) {
      throw new BadRequestException('QR amount must be at least ₹1.');
    }
    // Razorpay requires close_by comfortably in the future (min 15m, max 2h for
    // single_use). 30m is a sane doorstep window.
    const ttl = Math.min(Math.max(ttlMinutes, 16), 115);
    const closeBy = Math.floor(Date.now() / 1000) + ttl * 60;
    try {
      const qr = await this.instance.qrCode.create({
        type: 'upi_qr',
        name: (process.env.STORE_NAME || 'Bites Theory').slice(0, 50),
        usage: 'single_use',
        fixed_amount: true,
        payment_amount: amountPaise,
        description: `Order #${orderId}`,
        close_by: closeBy,
        notes: { orderId: String(orderId), source: 'doorstep' },
      });
      return {
        id: qr.id as string,
        imageUrl: qr.image_url as string,
        amountPaise,
        closeBy,
      };
    } catch (e: any) {
      /* BUGFIX — "Pay online (UPI QR)" failed with an opaque message, so there
         was no way to tell WHY. Razorpay's real reason lives in e.error.*
         (description/reason/code) or e.message. Surface it, and log the full
         payload server-side so Render logs show the truth.

         Most common causes in practice:
          - QR Codes not enabled on the Razorpay account (it's a separate
            product from Checkout — has to be activated).
          - TEST-mode keys: qrCode.create is not supported on many test
            accounts, so this 400s no matter what the code does.
          - close_by outside Razorpay's allowed window for single_use QRs. */
      const rz = e?.error || {};
      const reason =
        rz.description || rz.reason || rz.code || e?.message ||
        'Could not create the UPI QR code.';
      // eslint-disable-next-line no-console
      console.error('[razorpay.createQrCode] failed', {
        orderId, amountPaise, closeBy,
        keyMode: this.keyId.startsWith('rzp_test_') ? 'TEST' : 'LIVE',
        error: rz, message: e?.message,
      });
      throw new InternalServerErrorException(
        `UPI QR failed: ${reason}. If this persists, check that QR Codes are ` +
        `enabled on the Razorpay account (they are separate from Checkout, and ` +
        `are often unavailable on test keys).`,
      );
    }
  }

  /** Close a QR (rider fell back to cash, or order cancelled). Best-effort. */
  async closeQrCode(qrId: string) {
    try { return await this.instance.qrCode.close(qrId); } catch { return null; }
  }

  /** Poll a QR directly — the safety net when a webhook is slow or lost. */
  async fetchQrCode(qrId: string) {
    try { return await this.instance.qrCode.fetch(qrId); } catch { return null; }
  }

  /**
   * Refund a captured payment (full refund by default).
   * amountRupees, if given, does a partial refund.
   * Returns the Razorpay refund object ({ id, status, ... }).
   */
  async refundPayment(paymentId: string, amountRupees?: number) {
    try {
      const opts: any = { speed: 'normal' };
      if (amountRupees && amountRupees > 0) opts.amount = Math.round(amountRupees * 100);
      return await this.instance.payments.refund(paymentId, opts);
    } catch (e: any) {
      throw new InternalServerErrorException(
        e?.error?.description || 'Refund request to Razorpay failed',
      );
    }
  }
}
