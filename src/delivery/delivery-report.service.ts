import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SettingsService } from '../settings/settings.service';

/**
 * Delivery report (PRD: Goals and success metrics). Every number is computed
 * from delivered orders in the window, in the store's timezone.
 */
@Injectable()
export class DeliveryReportService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly settings: SettingsService,
  ) {}

  async report(from?: string, to?: string) {
    const tz = (await this.settings.get()).timezone || 'Asia/Kolkata';
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
      new Date(),
    );
    const f =
      from ||
      new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
        new Date(Date.now() - 6 * 864e5),
      );
    const t = to || today;
    if (!iso.test(f) || !iso.test(t))
      throw new BadRequestException('Dates must be YYYY-MM-DD.');

    const WHERE = `o.status = 'delivered' AND o.delivered_at IS NOT NULL
      AND COALESCE(o.fulfillment, 'delivery') = 'delivery'
      AND (o.delivered_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`;
    const MINS = (a: string, b: string) =>
      `EXTRACT(EPOCH FROM (${b} - ${a})) / 60`;

    const [totals] = await this.ds.query(
      `SELECT COUNT(*)::int AS delivered,
              COUNT(o.promised_at)::int AS with_promise,
              COUNT(*) FILTER (WHERE o.delivered_at <= o.promised_at)::int AS on_time,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MINS('o.promised_at', 'o.delivered_at')})
                FILTER (WHERE o.promised_at IS NOT NULL) AS promise_error_median,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MINS('o.ready_at', 'o.picked_up_at')})
                FILTER (WHERE o.ready_at IS NOT NULL AND o.picked_up_at IS NOT NULL) AS food_wait_median,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY ${MINS('o.ready_at', 'o.delivered_at')})
                FILTER (WHERE o.ready_at IS NOT NULL) AS food_age_p90,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MINS('o.placed_at::timestamptz', 'o.delivered_at')}) AS total_time_median,
              COUNT(*) FILTER (WHERE o.delivery_provider = 'porter')::int AS porter,
              COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM trip_stops s WHERE s.trip_id = o.trip_id) > 1)::int AS batched,
              COALESCE(SUM(re.total), 0)::numeric AS rider_pay,
              COALESCE(SUM(o.external_fee), 0)::numeric AS porter_fees,
              COUNT(*) FILTER (WHERE o.late_makegood_at IS NOT NULL)::int AS made_good,
              COUNT(*) FILTER (WHERE o.delay_notified_at IS NOT NULL)::int AS delay_alerts
         FROM orders o
         LEFT JOIN rider_earnings re ON re.order_id = o.id
        WHERE ${WHERE}`,
      [f, t, tz],
    );

    const daily = await this.ds.query(
      `SELECT (o.delivered_at AT TIME ZONE $3)::date::text AS date,
              COUNT(*)::int AS delivered,
              COUNT(o.promised_at)::int AS with_promise,
              COUNT(*) FILTER (WHERE o.delivered_at <= o.promised_at)::int AS on_time,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY ${MINS('o.promised_at', 'o.delivered_at')})
                FILTER (WHERE o.promised_at IS NOT NULL) AS promise_error_median
         FROM orders o WHERE ${WHERE}
        GROUP BY 1 ORDER BY 1`,
      [f, t, tz],
    );

    const riders = await this.ds.query(
      `SELECT dp.id, dp.name, COUNT(o.id)::int AS delivered,
              COUNT(o.promised_at)::int AS with_promise,
              COUNT(*) FILTER (WHERE o.delivered_at <= o.promised_at)::int AS on_time,
              COUNT(DISTINCT o.trip_id)::int AS trips,
              COALESCE(SUM(re.total), 0)::numeric AS earned
         FROM orders o
         JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
         LEFT JOIN rider_earnings re ON re.order_id = o.id
        WHERE ${WHERE}
        GROUP BY dp.id, dp.name ORDER BY delivered DESC`,
      [f, t, tz],
    );

    const [rating] = await this.ds
      .query(
        `SELECT AVG(r.rating)::numeric AS avg, COUNT(*)::int AS n
         FROM reviews r JOIN orders o ON o.id = r.order_id WHERE ${WHERE}`,
        [f, t, tz],
      )
      .catch(() => [{}]);

    const pct = (a: number, b: number) =>
      b > 0 ? Math.round((a / b) * 1000) / 10 : null;
    const num = (v: unknown, d = 1) =>
      v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d;
    const delivered = Number(totals.delivered);
    const cost = Number(totals.rider_pay) + Number(totals.porter_fees);

    return {
      from: f,
      to: t,
      timezone: tz,
      totals: {
        delivered,
        onTimePct: pct(totals.on_time, totals.with_promise),
        withPromise: totals.with_promise,
        promiseErrorMedianMin: num(totals.promise_error_median),
        foodWaitMedianMin: num(totals.food_wait_median),
        foodAgeP90Min: num(totals.food_age_p90),
        totalTimeMedianMin: num(totals.total_time_median),
        porterSharePct: pct(totals.porter, delivered),
        batchedSharePct: pct(totals.batched, delivered),
        costPerDelivery: delivered
          ? Math.round((cost / delivered) * 100) / 100
          : null,
        riderPay: Number(totals.rider_pay),
        porterFees: Number(totals.porter_fees),
        madeGood: totals.made_good,
        delayAlerts: totals.delay_alerts,
        rating: rating?.avg != null ? num(rating.avg, 2) : null,
        ratingCount: rating?.n ?? 0,
      },
      daily: daily.map((d: any) => ({
        date: d.date,
        delivered: d.delivered,
        onTimePct: pct(d.on_time, d.with_promise),
        promiseErrorMedianMin: num(d.promise_error_median),
      })),
      riders: riders.map((r: any) => ({
        id: Number(r.id),
        name: r.name,
        delivered: r.delivered,
        trips: r.trips,
        onTimePct: pct(r.on_time, r.with_promise),
        earned: Number(r.earned),
      })),
    };
  }
}
