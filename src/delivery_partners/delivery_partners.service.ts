import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { haversineKm } from '../common/geo.util';
import { DeliveryPartner } from './delivery-partner.entity';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';
import { signRiderJwt, safeEqual } from '../common/rider-auth.guard';

@Injectable()
export class DeliveryPartnerService {
  constructor(
    @InjectRepository(DeliveryPartner)
    private readonly repo: Repository<DeliveryPartner>,
    private readonly dataSource: DataSource,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  /** Riders the admin can choose from when dispatching an order. */
  async forAssignment() {
    return this.dataSource.query(
      `SELECT dp.id, dp.name, dp.mobile, dp.vehicle_no AS "vehicleNo",
              dp.is_available AS "isAvailable",
              COUNT(o.id) FILTER (
                WHERE o.status NOT IN ('delivered','cancelled')
              )::int AS "activeOrders"
         FROM delivery_partners dp
         LEFT JOIN orders o ON o.delivery_partner_id = dp.id
        WHERE dp.is_active = true
        GROUP BY dp.id
        ORDER BY dp.is_available DESC, "activeOrders" ASC, dp.name ASC`);
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('DeliveryPartner not found');
    return item;
  }

  create(dto: CreateDeliveryPartnerDto) {
    const item = this.repo.create(dto as Partial<DeliveryPartner>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateDeliveryPartnerDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<DeliveryPartner>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }

  async updateLocation(id: number, lat: number, lng: number) {
    const item = await this.findOne(id);
    Object.assign(item, { currentLat: lat, currentLng: lng, locationUpdatedAt: new Date() });
    const saved = await this.repo.save(item);

    /* §3.5 auto "arriving soon": rider within 1 km of an active
       out_for_delivery destination → flip the status automatically. */
    try {
      const rows = await this.dataSource.query(
        `SELECT id, order_number, user_id, delivery_lat, delivery_lng
           FROM orders
          WHERE delivery_partner_id = $1 AND status = 'out_for_delivery'
            AND delivery_lat IS NOT NULL AND delivery_lng IS NOT NULL
          LIMIT 1`, [id]);
      if (rows.length) {
        const o = rows[0];
        const d = haversineKm(lat, lng, Number(o.delivery_lat), Number(o.delivery_lng));
        if (d <= 1) {
          await this.dataSource.query(
            `UPDATE orders SET status = 'arriving_soon', updated_at = now() WHERE id = $1`, [o.id]);
          await this.dataSource.query(
            `INSERT INTO order_status_history (order_id, status, note)
             VALUES ($1,'arriving_soon','Auto: rider within 1 km')`, [o.id]);
          if (o.user_id) {
            await this.dataSource.query(
              `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
               VALUES ($1,$2,'in_app','📍 Arriving soon',$3,true)`,
              [o.user_id, o.id, `Order ${o.order_number}: your rider is almost there!`]);
          }
        }
      }
    } catch { /* never block a location ping on this */ }
    return saved;
  }

  /* ── §4.2/§4.3/§4.4: earnings, COD cash-in-hand, delivery history ── */
  async earnings(id: number) {
    await this.findOne(id); // 404 if no such rider
    const [today] = await this.dataSource.query(
      `SELECT COALESCE(SUM(total),0)::numeric AS amount, COUNT(*)::int AS deliveries
         FROM rider_earnings
        WHERE delivery_partner_id = $1 AND created_at >= date_trunc('day', now())`, [id]);
    const [week] = await this.dataSource.query(
      `SELECT COALESCE(SUM(total),0)::numeric AS amount, COUNT(*)::int AS deliveries
         FROM rider_earnings
        WHERE delivery_partner_id = $1 AND created_at >= date_trunc('week', now())`, [id]);
    /* COD cash in hand = actual CASH the rider collected − deposits.
       Bug #35: an order can be part-paid by wallet, so the rider only
       collects (total − wallet_used) in cash, not the full total. Counting
       the full total overstated the COD cash and mixed wallet money in. */
    /* Single source of truth: rider_cash_ledger. Only ACTUAL cash lands here —
       an order paid by doorstep UPI QR flips to method='online' and never writes
       a ledger row, so it correctly adds ₹0 to the rider's cash. */
    const [cod] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS collected
         FROM rider_cash_ledger WHERE rider_id = $1 AND kind = 'collect'`, [id]);
    const [dep] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS deposited
         FROM rider_cash_deposits WHERE delivery_partner_id = $1`, [id]);
    const history = await this.dataSource.query(
      `SELECT e.order_id AS "orderId", o.order_number AS "orderNumber",
              e.base_fare AS "baseFare", e.distance_pay AS "distancePay",
              e.tip, e.total, e.created_at AS "createdAt",
              /* Bug #64/#65: show the real per-order value + how it was paid,
                 so every delivery no longer displays the same flat payout. */
              o.total AS "orderValue",
              COALESCE(o.wallet_used,0) AS "walletUsed",
              (SELECT method FROM payments WHERE order_id = o.id ORDER BY id DESC LIMIT 1) AS "paymentMethod",
              GREATEST(o.total - COALESCE(o.wallet_used,0), 0) AS "cashToCollect"
         FROM rider_earnings e
         LEFT JOIN orders o ON o.id = e.order_id
        WHERE e.delivery_partner_id = $1
        ORDER BY e.created_at DESC LIMIT 30`, [id]);
    const cashInHand = Math.max(0, Number(cod.collected) - Number(dep.deposited));
    const cap = DeliveryPartnerService.cashCap();
    return {
      today: { amount: Number(today.amount), deliveries: today.deliveries },
      week: { amount: Number(week.amount), deliveries: week.deliveries },
      cashInHand,
      codCollected: Number(cod.collected),
      codDeposited: Number(dep.deposited),
      /* The rider needs to SEE the wall coming, not hit it mid-shift. */
      cashCap: cap,
      cashCapReached: cashInHand >= cap,
      cashHeadroom: Math.max(0, cap - cashInHand),
      history,
    };
  }

  /** ₹ a rider may hold before we stop giving them COD orders. */
  static cashCap(): number {
    const n = Number(process.env.RIDER_CASH_CAP);
    return Number.isFinite(n) && n > 0 ? n : 3000;
  }

  /** Undeposited cash for one rider. Used by the assignment cap. */
  async cashInHand(riderId: number): Promise<number> {
    const [c] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS v
         FROM rider_cash_ledger WHERE rider_id = $1 AND kind = 'collect'`, [riderId]);
    const [d] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS v
         FROM rider_cash_deposits WHERE delivery_partner_id = $1`, [riderId]);
    return Math.max(0, Number(c.v) - Number(d.v));
  }

  /**
   * Owner's morning screen. Who is holding my money, and how long have they
   * been holding it? Sorted worst-first, so the problem rider is always row one.
   */
  async reconciliation() {
    const cap = DeliveryPartnerService.cashCap();
    const rows = await this.dataSource.query(
      `SELECT dp.id, dp.name, dp.mobile, dp.is_active AS "isActive",
              COALESCE(l.collected, 0)::numeric  AS collected,
              COALESCE(d.deposited, 0)::numeric  AS deposited,
              GREATEST(COALESCE(l.collected,0) - COALESCE(d.deposited,0), 0)::numeric AS "cashInHand",
              l.orders_count                      AS "codOrders",
              d.last_deposit_at                   AS "lastDepositAt",
              l.oldest_unsettled                  AS "oldestCashAt"
         FROM delivery_partners dp
         LEFT JOIN (
           SELECT rider_id,
                  SUM(amount)      AS collected,
                  COUNT(*)::int    AS orders_count,
                  MIN(created_at)  AS oldest_unsettled
             FROM rider_cash_ledger WHERE kind = 'collect' GROUP BY rider_id
         ) l ON l.rider_id = dp.id
         LEFT JOIN (
           SELECT delivery_partner_id,
                  SUM(amount)      AS deposited,
                  MAX(created_at)  AS last_deposit_at
             FROM rider_cash_deposits GROUP BY delivery_partner_id
         ) d ON d.delivery_partner_id = dp.id
        ORDER BY "cashInHand" DESC`);

    return rows.map((r: any) => {
      const cash = Number(r.cashInHand);
      const days = r.lastDepositAt
        ? Math.floor((Date.now() - new Date(r.lastDepositAt).getTime()) / 86400000)
        : null;
      return {
        ...r,
        collected: Number(r.collected),
        deposited: Number(r.deposited),
        cashInHand: cash,
        cashCap: cap,
        blocked: cash >= cap,
        daysSinceDeposit: days,
        /* A rider sitting on cash for days is the signal, not the total. */
        risk: cash >= cap ? 'blocked' : (days !== null && days >= 3) || cash >= cap * 0.7 ? 'watch' : 'ok',
      };
    });
  }

  /* §4.3 admin records a cash deposit (route is admin-key protected) */
  async recordDeposit(id: number, amount: number, note?: string) {
    await this.findOne(id);
    if (!(amount > 0)) throw new BadRequestException('Deposit amount must be > 0');
    const [row] = await this.dataSource.query(
      `INSERT INTO rider_cash_deposits (delivery_partner_id, amount, note)
       VALUES ($1,$2,$3) RETURNING *`, [id, amount, note || null]);
    return row;
  }

  async findByMobile(mobile: string) {
    const item = await this.repo.findOne({ where: { mobile } as any });
    if (!item || item.isActive === false) {
      throw new NotFoundException('No active rider found with this mobile number');
    }
    return item;
  }

  /**
   * Rider login. If RIDER_LOGIN_CODE is set on the server, the rider must
   * supply the matching code (a shared secret you hand out to riders) in
   * addition to their mobile number. If it isn't set, we fall back to the
   * old mobile-only lookup so existing riders keep working after deploy.
   */
  async login(mobile: string, code: string) {
    /* P0-3: was mobile + ONE shared code for every rider, and `GET
       /delivery-partners` published every rider's mobile number publicly — so
       anyone could sign in as any rider. The code is now mandatory (fail
       closed), and login returns a signed session token instead of a bare id. */
    const expected = process.env.RIDER_LOGIN_CODE;
    if (!expected) {
      throw new UnauthorizedException(
        'Rider login is not configured on the server (RIDER_LOGIN_CODE).');
    }
    if (!safeEqual(code || '', expected)) {
      throw new UnauthorizedException('Invalid rider access code');
    }

    /* BUGFIX — "Your shift session expired. Please sign in again." right after
       a successful login.
       Root cause: login only needed RIDER_LOGIN_CODE, but every guarded rider
       route verifies the session JWT with RIDER_JWT_SECRET. If that secret is
       missing (or was rotated), signRiderJwt() produced a token that
       verifyRiderJwt() could never validate -> every call 401 -> the rider app
       wiped the session and showed "shift session expired", even though the
       login itself had succeeded. Fail loudly at LOGIN instead of handing out
       a token that is dead on arrival. */
    if (!process.env.RIDER_JWT_SECRET) {
      throw new ServiceUnavailableException(
        'Rider sessions are not configured on the server (RIDER_JWT_SECRET). ' +
        'Ask an admin to set it, then sign in again.');
    }

    const rider = await this.findByMobile(mobile);
    const token = signRiderJwt({
      sub: Number(rider.id), name: rider.name, mobile: rider.mobile,
    });
    return { ...rider, token };
  }

  /** Rider id must come from the verified token, never the URL. */
  assertSelf(riderId: number | null, urlId: number) {
    if (riderId != null && Number(riderId) !== Number(urlId)) {
      throw new UnauthorizedException('You can only act as yourself.');
    }
  }
}
