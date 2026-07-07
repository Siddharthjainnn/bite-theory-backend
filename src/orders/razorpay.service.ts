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
}
