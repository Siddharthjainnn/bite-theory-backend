import { Injectable, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { haversineKm } from '../common/geo.util';
import { DeliveryPartner } from './delivery-partner.entity';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';

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
    /* COD cash in hand = COD totals delivered − deposits recorded by admin */
    const [cod] = await this.dataSource.query(
      `SELECT COALESCE(SUM(o.total),0)::numeric AS collected
         FROM orders o
         JOIN payments p ON p.order_id = o.id AND p.method = 'cod'
        WHERE o.delivery_partner_id = $1 AND o.status = 'delivered'`, [id]);
    const [dep] = await this.dataSource.query(
      `SELECT COALESCE(SUM(amount),0)::numeric AS deposited
         FROM rider_cash_deposits WHERE delivery_partner_id = $1`, [id]);
    const history = await this.dataSource.query(
      `SELECT e.order_id AS "orderId", o.order_number AS "orderNumber",
              e.base_fare AS "baseFare", e.distance_pay AS "distancePay",
              e.tip, e.total, e.created_at AS "createdAt"
         FROM rider_earnings e
         LEFT JOIN orders o ON o.id = e.order_id
        WHERE e.delivery_partner_id = $1
        ORDER BY e.created_at DESC LIMIT 30`, [id]);
    return {
      today: { amount: Number(today.amount), deliveries: today.deliveries },
      week: { amount: Number(week.amount), deliveries: week.deliveries },
      cashInHand: Math.max(0, Number(cod.collected) - Number(dep.deposited)),
      codCollected: Number(cod.collected),
      codDeposited: Number(dep.deposited),
      history,
    };
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
    const expected = process.env.RIDER_LOGIN_CODE;
    if (expected && code !== expected) {
      throw new UnauthorizedException('Invalid rider access code');
    }
    return this.findByMobile(mobile);
  }
}
