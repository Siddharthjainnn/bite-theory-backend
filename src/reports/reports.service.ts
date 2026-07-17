import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Reporting — the "what is actually happening in my business?" module.
 *
 * DESIGN PRINCIPLES
 * -----------------
 * 1. EVERY report shares ONE filter shape (date range + optional dimensions).
 *    A report that can't be filtered the same way as its neighbour is a report
 *    people stop trusting, because two screens disagree.
 *
 * 2. Revenue counts DELIVERED orders only, unless a report is explicitly about
 *    cancellations. Counting cancelled orders as revenue is the single most
 *    common way a food dashboard lies to its owner.
 *
 * 3. All aggregation happens in SQL, never in JS. Pulling 50k rows to count
 *    them in Node is how a dashboard becomes a 30-second page load.
 *
 * 4. Money is rounded once, at the edge. Postgres numeric keeps the precision;
 *    we round on the way out so totals always reconcile with invoices.
 */

export interface ReportFilters {
  from?: string;          // ISO date, inclusive
  to?: string;            // ISO date, inclusive (end of that day)
  categoryId?: number;
  productId?: number;
  paymentMethod?: string; // 'online' | 'cod'
  status?: string;
  riderId?: number;
  couponCode?: string;
}

@Injectable()
export class ReportsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Shared WHERE builder. Every report uses this so filters mean exactly the
   * same thing everywhere — "last week" on Sales is the same "last week" on
   * Items.
   */
  private where(f: ReportFilters, opts: { deliveredOnly?: boolean; alias?: string } = {}) {
    const a = opts.alias || 'o';
    const conds: string[] = [`${a}.deleted_at IS NULL`];
    const params: any[] = [];
    let i = 1;

    if (f.from) { conds.push(`${a}.placed_at >= $${i++}`); params.push(f.from); }
    // inclusive end-of-day: '2026-07-16' must include 23:59
    if (f.to) { conds.push(`${a}.placed_at < ($${i++}::date + INTERVAL '1 day')`); params.push(f.to); }
    if (opts.deliveredOnly) conds.push(`${a}.status = 'delivered'`);
    else if (f.status) { conds.push(`${a}.status = $${i++}`); params.push(f.status); }
    if (f.riderId) { conds.push(`${a}.delivery_partner_id = $${i++}`); params.push(f.riderId); }

    return { sql: conds.join(' AND '), params, next: i };
  }

  /* ═══════════════ 1. HEADLINE SUMMARY ═══════════════ */

  /** The numbers an owner checks first thing in the morning. */
  async summary(f: ReportFilters) {
    const w = this.where(f);
    const [row] = await this.dataSource.query(
      `SELECT
         COUNT(*)                                                        ::int AS "totalOrders",
         COUNT(*) FILTER (WHERE o.status = 'delivered')                  ::int AS "delivered",
         COUNT(*) FILTER (WHERE o.status = 'cancelled')                  ::int AS "cancelled",
         COUNT(*) FILTER (WHERE o.status NOT IN ('delivered','cancelled'))::int AS "inFlight",
         COALESCE(SUM(o.total)    FILTER (WHERE o.status = 'delivered'), 0) AS revenue,
         COALESCE(SUM(o.discount) FILTER (WHERE o.status = 'delivered'), 0) AS discounts,
         COALESCE(SUM(o.tax)      FILTER (WHERE o.status = 'delivered'), 0) AS tax,
         COALESCE(SUM(o.delivery_charge) FILTER (WHERE o.status = 'delivered'), 0) AS "deliveryFees",
         COALESCE(SUM(o.tip)      FILTER (WHERE o.status = 'delivered'), 0) AS tips,
         COALESCE(SUM(o.wallet_used) FILTER (WHERE o.status = 'delivered'), 0) AS "walletUsed",
         COALESCE(AVG(o.total)    FILTER (WHERE o.status = 'delivered'), 0) AS "avgOrderValue",
         COUNT(DISTINCT o.user_id)                                       ::int AS "uniqueCustomers"
       FROM orders o WHERE ${w.sql}`, w.params);

    const r = (n: any) => Math.round(Number(n || 0) * 100) / 100;
    return {
      ...row,
      revenue: r(row.revenue), discounts: r(row.discounts), tax: r(row.tax),
      deliveryFees: r(row.deliveryFees), tips: r(row.tips), walletUsed: r(row.walletUsed),
      avgOrderValue: r(row.avgOrderValue),
      /* Cancellation rate is the number nobody wants to look at and everybody
         needs to. Over ~5% usually means a kitchen or stock problem. */
      cancelRate: row.totalOrders
        ? Math.round((row.cancelled / row.totalOrders) * 1000) / 10
        : 0,
    };
  }

  /* ═══════════════ 2. SALES OVER TIME ═══════════════ */

  /** Revenue + order count per day — the shape of the business. */
  async salesByDay(f: ReportFilters) {
    const w = this.where(f);
    return this.dataSource.query(
      `SELECT to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
              COUNT(*)                                       ::int AS orders,
              COUNT(*) FILTER (WHERE o.status='delivered')   ::int AS delivered,
              COUNT(*) FILTER (WHERE o.status='cancelled')   ::int AS cancelled,
              ROUND(COALESCE(SUM(o.total) FILTER (WHERE o.status='delivered'),0), 2) AS revenue
         FROM orders o WHERE ${w.sql}
        GROUP BY day ORDER BY day`, w.params);
  }

  /**
   * Orders by hour of day — "at which time how many orders".
   * Explicitly in IST: storing UTC and reporting UTC would put your dinner rush
   * at 2pm and make the whole report useless for staffing.
   */
  async ordersByHour(f: ReportFilters) {
    const w = this.where(f);
    return this.dataSource.query(
      `SELECT EXTRACT(HOUR FROM o.placed_at AT TIME ZONE 'Asia/Kolkata')::int AS hour,
              COUNT(*)                                    ::int AS orders,
              ROUND(COALESCE(SUM(o.total) FILTER (WHERE o.status='delivered'),0), 2) AS revenue
         FROM orders o WHERE ${w.sql}
        GROUP BY hour ORDER BY hour`, w.params);
  }

  /** Orders by weekday — which days actually pay the rent. */
  async ordersByWeekday(f: ReportFilters) {
    const w = this.where(f);
    return this.dataSource.query(
      `SELECT to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata', 'Dy') AS weekday,
              EXTRACT(ISODOW FROM o.placed_at AT TIME ZONE 'Asia/Kolkata')::int AS dow,
              COUNT(*)::int AS orders,
              ROUND(COALESCE(SUM(o.total) FILTER (WHERE o.status='delivered'),0), 2) AS revenue
         FROM orders o WHERE ${w.sql}
        GROUP BY weekday, dow ORDER BY dow`, w.params);
  }

  /* ═══════════════ 3. PRODUCTS ═══════════════ */

  /** Best sellers — by quantity AND revenue, because they disagree more often
   *  than people expect (cheap items win on volume, thalis win on money). */
  async topItems(f: ReportFilters, limit = 20) {
    const w = this.where(f, { deliveredOnly: true });
    let sql = `SELECT oi.product_id AS "productId", oi.product_name AS "productName",
                      c.name AS category,
                      SUM(oi.quantity)::int AS "unitsSold",
                      ROUND(SUM(oi.line_total), 2) AS revenue,
                      COUNT(DISTINCT oi.order_id)::int AS orders,
                      ROUND(AVG(oi.unit_price), 2) AS "avgPrice"
                 FROM order_items oi
                 JOIN orders o   ON o.id = oi.order_id
                 LEFT JOIN products p ON p.id = oi.product_id
                 LEFT JOIN categories c ON c.id = p.category_id
                WHERE ${w.sql}`;
    const params = [...w.params];
    let i = w.next;
    if (f.categoryId) { sql += ` AND p.category_id = $${i++}`; params.push(f.categoryId); }
    if (f.productId) { sql += ` AND oi.product_id = $${i++}`; params.push(f.productId); }
    sql += ` GROUP BY oi.product_id, oi.product_name, c.name
             ORDER BY "unitsSold" DESC LIMIT $${i}`;
    params.push(limit);
    return this.dataSource.query(sql, params);
  }

  /** Items nobody orders — the other half of the menu question. */
  async deadItems(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `SELECT p.id AS "productId", p.name AS "productName", c.name AS category,
              p.price, p.status,
              COALESCE(SUM(oi.quantity), 0)::int AS "unitsSold"
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id AND ${w.sql}
        GROUP BY p.id, p.name, c.name, p.price, p.status
       HAVING COALESCE(SUM(oi.quantity), 0) = 0
        ORDER BY p.name`, w.params);
  }

  /** Revenue by category — where the money actually comes from. */
  async salesByCategory(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `SELECT COALESCE(c.name, 'Uncategorised') AS category,
              SUM(oi.quantity)::int AS "unitsSold",
              ROUND(SUM(oi.line_total), 2) AS revenue,
              COUNT(DISTINCT oi.order_id)::int AS orders
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${w.sql}
        GROUP BY c.name ORDER BY revenue DESC`, w.params);
  }

  /* ═══════════════ 4. CUSTOMERS ═══════════════ */

  /**
   * Repeat vs one-time customers.
   *
   * This is THE number for a food business: acquiring a customer costs money,
   * the second order is where you start earning. A high one-time share means
   * the food or the delivery isn't bringing people back.
   */
  async repeatCustomers(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    const [row] = await this.dataSource.query(
      `WITH per_customer AS (
         SELECT o.user_id, COUNT(*)::int AS orders, SUM(o.total) AS spent
           FROM orders o WHERE ${w.sql}
          GROUP BY o.user_id)
       SELECT COUNT(*)                                   ::int AS customers,
              COUNT(*) FILTER (WHERE orders = 1)         ::int AS "oneTime",
              COUNT(*) FILTER (WHERE orders > 1)         ::int AS repeat,
              COUNT(*) FILTER (WHERE orders >= 5)        ::int AS loyal,
              ROUND(COALESCE(AVG(orders), 0), 2)         AS "avgOrdersPerCustomer",
              ROUND(COALESCE(AVG(spent), 0), 2)          AS "avgLifetimeValue"
         FROM per_customer`, w.params);
    return {
      ...row,
      repeatRate: row.customers ? Math.round((row.repeat / row.customers) * 1000) / 10 : 0,
    };
  }

  /** Top customers by spend — who to look after. */
  async topCustomers(f: ReportFilters, limit = 20) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `SELECT u.id AS "userId",
              TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS name,
              u.mobile, u.email, u.loyalty_level AS "loyaltyLevel",
              COUNT(*)::int AS orders,
              ROUND(SUM(o.total), 2) AS spent,
              ROUND(AVG(o.total), 2) AS "avgOrder",
              MAX(o.placed_at) AS "lastOrder"
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE ${w.sql}
        GROUP BY u.id ORDER BY spent DESC LIMIT $${w.next}`,
      [...w.params, limit]);
  }

  /** New vs returning customers per day — is the base growing? */
  async newVsReturning(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `WITH firsts AS (
         SELECT user_id, MIN(placed_at) AS first_order
           FROM orders WHERE status = 'delivered' AND deleted_at IS NULL
          GROUP BY user_id)
       SELECT to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE o.placed_at = fr.first_order)::int AS "newCustomers",
              COUNT(*) FILTER (WHERE o.placed_at > fr.first_order)::int AS returning
         FROM orders o JOIN firsts fr ON fr.user_id = o.user_id
        WHERE ${w.sql}
        GROUP BY day ORDER BY day`, w.params);
  }

  /* ═══════════════ 5. PAYMENTS ═══════════════ */

  /** Online vs COD — split by count and by money. */
  async paymentBreakdown(f: ReportFilters) {
    const w = this.where(f);
    return this.dataSource.query(
      `SELECT COALESCE(p.method, 'unknown') AS method,
              p.status,
              COUNT(*)::int AS orders,
              ROUND(COALESCE(SUM(p.amount), 0), 2) AS amount
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE ${w.sql}
        GROUP BY p.method, p.status ORDER BY amount DESC`, w.params);
  }

  /* ═══════════════ 6. COUPONS & REFERRALS ═══════════════ */

  /** Which coupons are actually working — and what they cost you. */
  async couponPerformance(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `SELECT c.code, c.discount_type AS "discountType", c.discount_value AS "discountValue",
              COUNT(*)::int AS orders,
              ROUND(SUM(o.discount), 2) AS "discountGiven",
              ROUND(SUM(o.total), 2) AS revenue,
              ROUND(AVG(o.total), 2) AS "avgOrder",
              COUNT(DISTINCT o.user_id)::int AS customers
         FROM orders o JOIN coupons c ON c.id = o.coupon_id
        WHERE ${w.sql}
        GROUP BY c.code, c.discount_type, c.discount_value
        ORDER BY orders DESC`, w.params);
  }

  /** Referral funnel: invited → converted → rewarded. */
  async referralReport(f: ReportFilters) {
    const conds = ['1=1']; const params: any[] = []; let i = 1;
    if (f.from) { conds.push(`r.created_at >= $${i++}`); params.push(f.from); }
    if (f.to) { conds.push(`r.created_at < ($${i++}::date + INTERVAL '1 day')`); params.push(f.to); }

    const [totals] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS invited,
              COUNT(*) FILTER (WHERE r.is_converted)::int AS converted,
              COUNT(*) FILTER (WHERE r.rewarded)::int AS rewarded,
              ROUND(COALESCE(SUM(r.reward_amount) FILTER (WHERE r.rewarded), 0), 2) AS "rewardPaid"
         FROM referrals r WHERE ${conds.join(' AND ')}`, params);

    const top = await this.dataSource.query(
      `SELECT TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS name,
              u.mobile, u.referral_code AS code,
              COUNT(*)::int AS invited,
              COUNT(*) FILTER (WHERE r.is_converted)::int AS converted,
              ROUND(COALESCE(SUM(r.reward_amount) FILTER (WHERE r.rewarded),0), 2) AS earned
         FROM referrals r JOIN users u ON u.id = r.referrer_id
        WHERE ${conds.join(' AND ')}
        GROUP BY u.id, u.first_name, u.last_name, u.mobile, u.referral_code
        ORDER BY converted DESC, invited DESC LIMIT 20`, params);

    return {
      ...totals,
      conversionRate: totals.invited
        ? Math.round((totals.converted / totals.invited) * 1000) / 10
        : 0,
      topReferrers: top,
    };
  }

  /* ═══════════════ 7. OPERATIONS ═══════════════ */

  /**
   * Kitchen + delivery speed, measured from the timestamps you already record.
   * Percentiles, not just averages: the average hides the one order that took
   * 90 minutes, and that's the order that lost you a customer.
   */
  async operations(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    const [row] = await this.dataSource.query(
      `SELECT
         ROUND(AVG(EXTRACT(EPOCH FROM (o.picked_up_at - o.placed_at))/60)::numeric, 1) AS "avgPrepMins",
         ROUND(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.picked_up_at))/60)::numeric, 1) AS "avgDeliveryMins",
         ROUND(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.placed_at))/60)::numeric, 1) AS "avgTotalMins",
         ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (
           ORDER BY EXTRACT(EPOCH FROM (o.delivered_at - o.placed_at))/60)::numeric, 1) AS "p90TotalMins",
         ROUND(AVG(o.distance_km)::numeric, 2) AS "avgDistanceKm"
       FROM orders o
       WHERE ${w.sql} AND o.delivered_at IS NOT NULL AND o.picked_up_at IS NOT NULL`,
      w.params);
    return row;
  }

  /** Per-rider performance. */
  async riderReport(f: ReportFilters) {
    const w = this.where(f, { deliveredOnly: true });
    return this.dataSource.query(
      `SELECT dp.id AS "riderId", dp.name, dp.mobile, dp.vehicle_no AS "vehicleNo",
              COUNT(*)::int AS deliveries,
              ROUND(COALESCE(SUM(o.tip), 0), 2) AS tips,
              ROUND(COALESCE(SUM(o.distance_km), 0), 2) AS "totalKm",
              ROUND(AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.picked_up_at))/60)::numeric, 1) AS "avgDeliveryMins"
         FROM orders o JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
        WHERE ${w.sql} AND o.delivered_at IS NOT NULL
        GROUP BY dp.id, dp.name, dp.mobile, dp.vehicle_no
        ORDER BY deliveries DESC`, w.params);
  }

  /** Cancellations — how many, and what they cost. */
  async cancellations(f: ReportFilters) {
    const w = this.where(f);
    return this.dataSource.query(
      `SELECT to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS day,
              COUNT(*)::int AS cancelled,
              ROUND(COALESCE(SUM(o.total), 0), 2) AS "lostValue"
         FROM orders o
        WHERE ${w.sql} AND o.status = 'cancelled'
        GROUP BY day ORDER BY day DESC`, w.params);
  }

  /* ═══════════════ 8. RAW EXPORT ═══════════════ */

  /**
   * Flat order rows for CSV/Excel. Deliberately denormalised and wide — the
   * whole point is that someone can pivot it in Excel without needing us.
   */
  async orderExport(f: ReportFilters, limit = 5000) {
    const w = this.where(f);
    let sql = `SELECT o.order_number AS "Order", o.invoice_no AS "Invoice",
                      to_char(o.placed_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS "Placed",
                      o.status AS "Status",
                      TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) AS "Customer",
                      u.mobile AS "Mobile",
                      o.subtotal AS "Subtotal", o.discount AS "Discount",
                      o.delivery_charge AS "Delivery", o.tax AS "Tax",
                      o.cgst AS "CGST", o.sgst AS "SGST",
                      o.tip AS "Tip", o.wallet_used AS "Wallet", o.total AS "Total",
                      p.method AS "PaymentMethod", p.status AS "PaymentStatus",
                      c.code AS "Coupon",
                      dp.name AS "Rider",
                      o.distance_km AS "DistanceKm",
                      to_char(o.delivered_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI') AS "Delivered"
                 FROM orders o
                 LEFT JOIN users u ON u.id = o.user_id
                 LEFT JOIN payments p ON p.order_id = o.id
                 LEFT JOIN coupons c ON c.id = o.coupon_id
                 LEFT JOIN delivery_partners dp ON dp.id = o.delivery_partner_id
                WHERE ${w.sql}`;
    const params = [...w.params];
    let i = w.next;
    if (f.paymentMethod) { sql += ` AND p.method = $${i++}`; params.push(f.paymentMethod); }
    if (f.couponCode) { sql += ` AND c.code = $${i++}`; params.push(f.couponCode); }
    sql += ` ORDER BY o.placed_at DESC LIMIT $${i}`;
    params.push(limit);
    return this.dataSource.query(sql, params);
  }

  /** Everything the dashboard needs, in ONE round trip. */
  async dashboard(f: ReportFilters) {
    const [summary, byDay, byHour, byWeekday, topItems, categories,
           repeat, payments, coupons, ops] = await Promise.all([
      this.summary(f), this.salesByDay(f), this.ordersByHour(f),
      this.ordersByWeekday(f), this.topItems(f, 10), this.salesByCategory(f),
      this.repeatCustomers(f), this.paymentBreakdown(f),
      this.couponPerformance(f), this.operations(f),
    ]);
    return { summary, byDay, byHour, byWeekday, topItems, categories, repeat, payments, coupons, ops };
  }
}
