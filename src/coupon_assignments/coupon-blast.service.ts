import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MailService } from '../common/mail.service';

/**
 * Bulk coupon send.
 *
 * DESIGN NOTES
 *
 * 1. coupon_assignments IS the ledger. A user is "already sent" if a row
 *    exists for (coupon_id, user_id). The audience query excludes those, so
 *    the job is naturally resumable and a double-click can never send twice.
 *
 * 2. Batched by design, not for elegance. Render times out long requests and
 *    Gmail caps a free account near 500/day, so one HTTP call handles one
 *    small batch and reports what remains. The admin screen drives the loop.
 *
 * 3. Assign first, then email. If the email fails the customer still has the
 *    coupon on their account, which is the recoverable failure. The reverse
 *    would promise a discount the system does not honour.
 */

export type Segment = 'all' | 'never_ordered' | 'lapsed_30' | 'recent_30';

const SEGMENT_SQL: Record<Segment, string> = {
  /* Everyone with a usable address. */
  all: `TRUE`,
  /* Signed up, never bought — the warmest untapped audience and the only
     segment where a first-order discount is not just margin given away. */
  never_ordered: `NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)`,
  /* Bought once, then went quiet. */
  lapsed_30: `EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
              AND NOT EXISTS (SELECT 1 FROM orders o2 WHERE o2.user_id = u.id
                              AND o2.placed_at > now() - interval '30 days')`,
  recent_30: `EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id
                      AND o.placed_at > now() - interval '30 days')`,
};

@Injectable()
export class CouponBlastService {
  private readonly logger = new Logger(CouponBlastService.name);

  constructor(
    private readonly ds: DataSource,
    private readonly mail: MailService,
  ) {}

  private sql(segment: Segment, couponId: number) {
    if (!SEGMENT_SQL[segment]) throw new BadRequestException('Unknown segment');
    return `
      FROM users u
      WHERE u.email IS NOT NULL AND u.email <> ''
        AND (u.status IS NULL OR u.status::text = 'active')
        AND ${SEGMENT_SQL[segment]}
        AND NOT EXISTS (
          SELECT 1 FROM coupon_assignments ca
          WHERE ca.user_id = u.id AND ca.coupon_id = ${couponId}
        )`;
  }

  /** How many are still to receive this coupon, by segment. */
  async audience(couponId: number, segment: Segment) {
    const [row] = await this.ds.query(
      `SELECT COUNT(*)::int AS remaining ${this.sql(segment, couponId)}`,
    );
    const [[total], [done]] = await Promise.all([
      this.ds.query(
        `SELECT COUNT(*)::int AS c FROM users u
         WHERE u.email IS NOT NULL AND u.email <> ''
           AND (u.status IS NULL OR u.status::text = 'active')
           AND ${SEGMENT_SQL[segment]}`,
      ),
      this.ds.query(
        `SELECT COUNT(*)::int AS c FROM coupon_assignments WHERE coupon_id = $1`,
        [couponId],
      ),
    ]);
    return {
      segment,
      remaining: row?.remaining ?? 0,
      inSegment: total?.c ?? 0,
      alreadySent: done?.c ?? 0,
    };
  }

  /** Counts for every segment at once, for the admin picker. */
  async allSegments(couponId: number) {
    const keys = Object.keys(SEGMENT_SQL) as Segment[];
    const out = await Promise.all(keys.map((k) => this.audience(couponId, k)));
    return out;
  }

  /**
   * Assign + email one batch. Returns what remains so the caller can loop.
   * `limit` is capped at 100: bigger batches risk a Render request timeout
   * mid-send, which would leave assignments made and emails unsent.
   */
  async sendBatch(opts: {
    couponId: number;
    segment: Segment;
    limit: number;
    headline?: string;
    siteUrl?: string;
    dryRun?: boolean;
  }) {
    const limit = Math.min(Math.max(1, opts.limit || 25), 100);

    const [coupon] = await this.ds.query(
      `SELECT id, code, description, min_order, valid_until, is_active
       FROM coupons WHERE id = $1`, [opts.couponId],
    );
    if (!coupon) throw new BadRequestException('Coupon not found');
    if (!coupon.is_active) throw new BadRequestException('Coupon is not active');
    if (!this.mail.isReady) throw new BadRequestException('SMTP is not configured');

    const users = await this.ds.query(
      `SELECT u.id, u.email, u.first_name ${this.sql(opts.segment, opts.couponId)}
       ORDER BY u.id LIMIT ${limit}`,
    );

    if (opts.dryRun) {
      return {
        dryRun: true, wouldSend: users.length,
        sample: users.slice(0, 3).map((u: any) => u.email),
      };
    }

    const site = opts.siteUrl || 'https://www.bitestheory.com';
    const headline = opts.headline || 'YOUR WELCOME COUPON';
    let sent = 0;
    const failed: { email: string; error: string }[] = [];

    for (const u of users) {
      // Assign first: a delivered coupon with a failed email is recoverable,
      // a delivered email with no coupon is not.
      await this.ds.query(
        `INSERT INTO coupon_assignments (coupon_id, user_id, note, is_used, created_at)
         VALUES ($1, $2, 'bulk email campaign', false, now())`,
        [opts.couponId, u.id],
      );

      const res = await this.mail.sendAndReport(
        u.email,
        `Thank you for joining Bites Theory — here is your coupon`,
        this.mail.couponHtml({
          firstName: u.first_name,
          code: coupon.code,
          headline,
          description: coupon.description,
          minOrder: coupon.min_order ? Number(coupon.min_order) : null,
          validUntil: coupon.valid_until,
          siteUrl: site,
          unsubscribeUrl: `${site}/account/profile`,
        }),
        /* Gmail and Outlook surface a native unsubscribe from this header.
           Its absence is a documented spam signal on bulk sends. */
        { 'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=unsubscribe>` },
      );

      if (res.ok) sent++;
      else failed.push({ email: u.email, error: String(res.error) });

      // Gentle pacing so a batch never looks like a burst to the provider.
      await new Promise((r) => setTimeout(r, 350));
    }

    const after = await this.audience(opts.couponId, opts.segment);
    this.logger.log(`Coupon ${coupon.code}: sent ${sent}, failed ${failed.length}, ${after.remaining} left`);
    return { sent, failed, remaining: after.remaining, alreadySent: after.alreadySent };
  }
}
