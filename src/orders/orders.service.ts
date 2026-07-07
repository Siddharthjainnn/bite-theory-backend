import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from './order.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import {
  CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto, CheckoutDto, CreatePaymentDto,
} from './dto';
import { computeCouponDiscount } from '../coupons/coupon.util';
import { RazorpayService } from './razorpay.service';

const DELIVERY_CHARGE = 30;
const FREE_DELIVERY_ABOVE = 500;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private repo: Repository<Order>,
    @InjectRepository(OrderStatusHistory) private historyRepo: Repository<OrderStatusHistory>,
    @InjectDataSource() private dataSource: DataSource,
    private readonly razorpay: RazorpayService,
  ) {}

  findAll(filters: { userId?: number; deliveryPartnerId?: number; active?: boolean } = {}) {
    const qb = this.repo.createQueryBuilder('o').orderBy('o.placed_at', 'DESC');
    if (filters.userId) qb.andWhere('o.user_id = :uid', { uid: filters.userId });
    if (filters.deliveryPartnerId) qb.andWhere('o.delivery_partner_id = :pid', { pid: filters.deliveryPartnerId });
    if (filters.active) qb.andWhere(`o.status NOT IN ('delivered','cancelled')`);
    return qb.getMany();
  }

  /** Orders ready for a rider to accept: food is (nearly) ready, no partner yet. */
  availableForRiders() {
    return this.repo.createQueryBuilder('o')
      .where('o.delivery_partner_id IS NULL')
      .andWhere(`o.status IN ('preparing_food','food_ready')`)
      .orderBy('o.placed_at', 'ASC')
      .getMany();
  }

  /** Rider accepts an order — atomic claim so two riders can't take the same one. */
  async acceptOrder(orderId: number, partnerId: number) {
    const res = await this.dataSource.query(
      `UPDATE orders SET delivery_partner_id = $1, status = 'assigned_to_delivery', updated_at = now()
        WHERE id = $2 AND delivery_partner_id IS NULL
          AND status IN ('preparing_food','food_ready')
        RETURNING id`, [partnerId, orderId]);
    if (!res[0]?.length && !res.length) throw new BadRequestException('Order already taken by another rider');
    // pg driver returns [rows, count] via dataSource.query for UPDATE..RETURNING in some versions; normalize:
    const rows = Array.isArray(res[0]) ? res[0] : res;
    if (!rows.length) throw new BadRequestException('Order already taken by another rider');
    await this.historyRepo.save(this.historyRepo.create({ orderId, status: 'assigned_to_delivery', note: `Accepted by rider #${partnerId}` }));
    await this.dataSource.query(
      `UPDATE delivery_partners SET is_available = false WHERE id = $1`, [partnerId]);
    return this.findOneFull(orderId);
  }

  async findOne(id: number) {
    const order = await this.repo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /** Order + items in one call (customer order detail). */
  async findOneFull(id: number) {
    const order = await this.findOne(id);
    const items = await this.dataSource.query(
      `SELECT id, product_id AS "productId", product_name AS "productName",
              unit_price AS "unitPrice", quantity, line_total AS "lineTotal"
         FROM order_items WHERE order_id = $1 ORDER BY id`, [id]);
    const history = await this.getHistory(id);
    return { ...order, items, history };
  }

  /** Live tracking payload: order + destination + driver location. */
  async track(id: number) {
    const full = await this.findOneFull(id);
    let partner: any = null;
    if (full.deliveryPartnerId) {
      const rows = await this.dataSource.query(
        `SELECT id, name, mobile, vehicle_no AS "vehicleNo", photo,
                current_lat AS "lat", current_lng AS "lng",
                location_updated_at AS "locationUpdatedAt"
           FROM delivery_partners WHERE id = $1`, [full.deliveryPartnerId]);
      partner = rows[0] || null;
    }
    return { ...full, partner };
  }

  /**
   * Step 1 of online payment. Prices the cart exactly like checkout would
   * (server-side, coupon + wallet aware) and opens a Razorpay order for the
   * remaining payable amount. Returns everything the browser popup needs.
   * Nothing is written to our DB yet.
   */
  async createPaymentOrder(dto: CreatePaymentDto) {
    if (!this.razorpay.isConfigured) {
      throw new BadRequestException('Online payment is not available right now.');
    }
    if (!dto.items?.length) throw new BadRequestException('Cart is empty');

    const priced = await this.priceCart({
      userId: dto.userId,
      items: dto.items,
      couponCode: dto.couponCode,
      useWallet: dto.useWallet,
    });

    if (priced.payable < 1) {
      // wallet already covers it — no online payment needed
      throw new BadRequestException('No online payment needed; wallet covers the order.');
    }

    const receipt = 'rcpt_' + Date.now().toString(36);
    const rzp = await this.razorpay.createOrder(priced.payable, receipt);
    return {
      razorpayOrderId: rzp.id,
      amount: rzp.amount,           // in paise
      currency: rzp.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      payable: priced.payable,      // in rupees, for display
      subtotal: priced.subtotal,
      discount: priced.discount,
      deliveryCharge: priced.deliveryCharge,
      walletUsed: priced.walletUsed,
    };
  }

  /**
   * Shared pricing used by both the payment-order step and final checkout,
   * so the amount charged always matches the order total. Read-only (no writes).
   */
  private async priceCart(input: {
    userId: number; items: { productId: number; quantity: number }[];
    couponCode?: string; useWallet?: boolean;
  }) {
    const ids = input.items.map((i) => i.productId);
    const products = await this.dataSource.query(
      `SELECT id, name, price, offer_price FROM products
        WHERE id = ANY($1) AND status = 'active'`, [ids]);
    const byId = new Map<number, any>(products.map((p: any) => [Number(p.id), p]));

    let subtotal = 0;
    for (const i of input.items) {
      const p = byId.get(Number(i.productId));
      if (!p) throw new BadRequestException(`Product ${i.productId} unavailable`);
      const price = Number(p.offer_price) > 0 && Number(p.offer_price) < Number(p.price)
        ? Number(p.offer_price) : Number(p.price);
      subtotal += price * i.quantity;
    }

    let discount = 0;
    if (input.couponCode) {
      const rows = await this.dataSource.query(
        `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) LIMIT 1`, [input.couponCode.trim()]);
      const result = computeCouponDiscount(rows[0], subtotal);
      if (!result.valid) throw new BadRequestException(result.message);
      discount = result.discount;
    }

    const deliveryCharge = subtotal - discount >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_CHARGE;
    let payable = subtotal - discount + deliveryCharge;

    let walletUsed = 0;
    if (input.useWallet) {
      const u = await this.dataSource.query(
        `SELECT wallet_balance FROM users WHERE id = $1`, [input.userId]);
      const balance = Number(u[0]?.wallet_balance || 0);
      walletUsed = Math.min(balance, payable);
      payable -= walletUsed;
    }

    return { subtotal, discount, deliveryCharge, walletUsed, payable };
  }

  /**
   * Swiggy-style checkout — one atomic transaction:
   * price items from DB, apply coupon, deduct wallet, create
   * order + items + history + payment, bump coupon usage, award points.
   */
  async checkout(dto: CheckoutDto) {
    if (!dto.items?.length) throw new BadRequestException('Cart is empty');

    // For online payments, verify the Razorpay signature BEFORE writing anything.
    // If it doesn't check out, we never create the order — no unpaid ghost orders.
    const isOnline = dto.paymentMethod === 'online';
    if (isOnline) {
      const ok = this.razorpay.verifySignature(
        dto.razorpayOrderId || '',
        dto.razorpayPaymentId || '',
        dto.razorpaySignature || '',
      );
      if (!ok) throw new BadRequestException('Payment verification failed. You were not charged.');
    }

    return this.dataSource.transaction(async (mgr) => {
      /* 1) price items from DB — never trust client prices */
      const ids = dto.items.map((i) => i.productId);
      const products = await mgr.query(
        `SELECT id, name, price, offer_price FROM products
          WHERE id = ANY($1) AND status = 'active'`, [ids]);
      const byId = new Map<number, any>(products.map((p: any) => [Number(p.id), p]));

      let subtotal = 0;
      const lines = dto.items.map((i) => {
        const p = byId.get(Number(i.productId));
        if (!p) throw new BadRequestException(`Product ${i.productId} unavailable`);
        const price = Number(p.offer_price) > 0 && Number(p.offer_price) < Number(p.price)
          ? Number(p.offer_price) : Number(p.price);
        const lineTotal = price * i.quantity;
        subtotal += lineTotal;
        return { productId: Number(p.id), productName: p.name, unitPrice: price, quantity: i.quantity, lineTotal };
      });

      /* 2) coupon (server-side validation) */
      let discount = 0; let couponId: number | null = null;
      if (dto.couponCode) {
        const rows = await mgr.query(
          `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) LIMIT 1`, [dto.couponCode.trim()]);
        const result = computeCouponDiscount(rows[0], subtotal);
        if (!result.valid) throw new BadRequestException(result.message);
        discount = result.discount;
        couponId = Number(rows[0].id);
      }

      /* 3) delivery charge */
      const deliveryCharge = subtotal - discount >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_CHARGE;
      let payable = subtotal - discount + deliveryCharge;

      /* 4) wallet (lock the user row) */
      let walletUsed = 0;
      if (dto.useWallet) {
        const u = await mgr.query(
          `SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`, [dto.userId]);
        if (!u.length) throw new BadRequestException('User not found');
        const balance = Number(u[0].wallet_balance || 0);
        walletUsed = Math.min(balance, payable);
        if (walletUsed > 0) {
          payable -= walletUsed;
          await mgr.query(
            `UPDATE users SET wallet_balance = wallet_balance - $1, updated_at = now() WHERE id = $2`,
            [walletUsed, dto.userId]);
        }
      }

      /* 5) resolve delivery destination */
      let deliveryAddress = dto.deliveryAddress || null;
      let deliveryLat = dto.deliveryLat ?? null;
      let deliveryLng = dto.deliveryLng ?? null;
      if (dto.addressId) {
        const a = await mgr.query(
          `SELECT full_address, landmark, city, pincode, latitude, longitude
             FROM addresses WHERE id = $1 AND user_id = $2`, [dto.addressId, dto.userId]);
        if (!a.length) throw new BadRequestException('Address not found');
        const ad = a[0];
        deliveryAddress = deliveryAddress ||
          [ad.full_address, ad.landmark, ad.city, ad.pincode].filter(Boolean).join(', ');
        deliveryLat = deliveryLat ?? (ad.latitude != null ? Number(ad.latitude) : null);
        deliveryLng = deliveryLng ?? (ad.longitude != null ? Number(ad.longitude) : null);
      }
      if (!dto.addressId && !deliveryAddress) throw new BadRequestException('Delivery address required');

      /* 6) create order */
      const orderNumber = 'BT' + Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 5).toUpperCase();
      const total = payable;
      const [order] = await mgr.query(
        `INSERT INTO orders (order_number, user_id, address_id, coupon_id, subtotal, discount,
             delivery_charge, tax, wallet_used, total, status, delivery_slot,
             delivery_lat, delivery_lng, delivery_address, eta_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'order_received',$10,$11,$12,$13,$14)
         RETURNING *, order_number AS "orderNumber", user_id AS "userId", placed_at AS "placedAt"`,
        [orderNumber, dto.userId, dto.addressId ?? null, couponId, subtotal, discount,
         deliveryCharge, walletUsed, total, dto.deliverySlot ?? null,
         deliveryLat, deliveryLng, deliveryAddress, 35]);
      const orderId = Number(order.id);

      /* 7) items */
      for (const l of lines) {
        await mgr.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, l.productId, l.productName, l.unitPrice, l.quantity, l.lineTotal]);
      }

      /* 8) status history */
      await mgr.query(
        `INSERT INTO order_status_history (order_id, status, note)
         VALUES ($1,'order_received','Order placed')`, [orderId]);

      /* 9) wallet transaction log */
      if (walletUsed > 0) {
        await mgr.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
           VALUES ($1,'debit',$2,$3,$4)`,
          [dto.userId, walletUsed, `Used on order ${orderNumber}`, orderId]);
      }

      /* 10) coupon usage */
      if (couponId) {
        await mgr.query(
          `UPDATE coupons SET used_count = COALESCE(used_count,0) + 1 WHERE id = $1`, [couponId]);
      }

      /* 11) payment row */
      await mgr.query(
        `INSERT INTO payments (order_id, method, amount, status, transaction_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          orderId,
          dto.paymentMethod || 'cod',
          total,
          isOnline ? 'paid' : 'pending',        // COD stays pending until delivered
          isOnline ? (dto.razorpayPaymentId || null) : null,
        ]);

      /* 12) inventory decrement — reduce stock, update status, hide sold-out products */
      for (const l of lines) {
        const inv = await mgr.query(
          `UPDATE inventory
              SET quantity = GREATEST(COALESCE(quantity,0) - $1, 0),
                  stock_status = CASE
                    WHEN COALESCE(quantity,0) - $1 <= 0 THEN 'out_of_stock'
                    WHEN COALESCE(quantity,0) - $1 <= COALESCE(low_threshold, 5) THEN 'low'
                    ELSE 'in_stock' END,
                  updated_at = now()
            WHERE product_id = $2
            RETURNING quantity`,
          [l.quantity, l.productId]);
        const rows = Array.isArray(inv[0]) ? inv[0] : inv;
        if (rows.length && Number(rows[0].quantity) <= 0) {
          // sold out → hide from the storefront (catalog only shows status='active')
          await mgr.query(
            `UPDATE products SET status = 'inactive', updated_at = now() WHERE id = $1`,
            [l.productId]);
        }
      }

      /* 13) referral reward — first order of a referred user pays the referrer ₹50 */
      const REFERRAL_REWARD = 50;
      const ref = await mgr.query(
        `SELECT id, referrer_id FROM referrals
          WHERE referred_user_id = $1 AND COALESCE(is_converted, false) = false
          LIMIT 1 FOR UPDATE`, [dto.userId]);
      if (ref.length) {
        const prior = await mgr.query(
          `SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1 AND id <> $2`,
          [dto.userId, orderId]);
        if (Number(prior[0].n) === 0) {
          const referrerId = Number(ref[0].referrer_id);
          await mgr.query(
            `UPDATE users SET wallet_balance = COALESCE(wallet_balance,0) + $1, updated_at = now()
              WHERE id = $2`, [REFERRAL_REWARD, referrerId]);
          await mgr.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
             VALUES ($1,'credit',$2,'Referral reward — your friend placed their first order!',$3)`,
            [referrerId, REFERRAL_REWARD, orderId]);
          await mgr.query(
            `UPDATE referrals SET is_converted = true, rewarded = true, reward_amount = $1
              WHERE id = $2`, [REFERRAL_REWARD, ref[0].id]);
          await mgr.query(
            `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
             VALUES ($1,$2,'in_app','🎉 You earned ₹${REFERRAL_REWARD}!','Your friend just placed their first order. ₹${REFERRAL_REWARD} has been added to your wallet.',true)`,
            [referrerId, orderId]);
        }
      }

      /* 14) order-confirmed notification for the customer */
      await mgr.query(
        `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
         VALUES ($1,$2,'in_app','🛎️ Order placed!',$3,true)`,
        [dto.userId, orderId,
         `Order ${orderNumber} is confirmed — ₹${total} · we'll start cooking right away.`]);

      /* 15) loyalty: 1 point per ₹100 of subtotal, then auto-upgrade tier */
      const points = Math.floor(subtotal / 100);
      if (points > 0) {
        await mgr.query(
          `INSERT INTO loyalty_points (user_id, points, type, reason, order_id)
           VALUES ($1,$2,'earn',$3,$4)`,
          [dto.userId, points, `Order ${orderNumber}`, orderId]);
        await mgr.query(
          `UPDATE users SET loyalty_points = COALESCE(loyalty_points,0) + $1 WHERE id = $2`,
          [points, dto.userId]);
        // tiers by lifetime points: silver 200 · gold 500 · platinum 1000
        await mgr.query(
          `UPDATE users SET loyalty_level = CASE
             WHEN loyalty_points >= 1000 THEN 'platinum'::loyalty_tier
             WHEN loyalty_points >= 500  THEN 'gold'::loyalty_tier
             WHEN loyalty_points >= 200  THEN 'silver'::loyalty_tier
             ELSE 'bronze'::loyalty_tier
           END
           WHERE id = $1`, [dto.userId]);
      }

      return { ...order, id: orderId, items: lines, pointsEarned: points };
    });
  }

  /* ── legacy admin create ── */
  async create(dto: CreateOrderDto) {
    const order = this.repo.create({ ...dto, status: 'order_received' });
    const saved = await this.repo.save(order);
    await this.historyRepo.save(this.historyRepo.create({ orderId: saved.id, status: 'order_received', note: 'Order placed' }));
    return saved;
  }

  async update(id: number, dto: UpdateOrderDto) {
    const order = await this.findOne(id);
    Object.assign(order, dto);
    return this.repo.save(order);
  }

  async updateStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.findOne(id);
    order.status = dto.status;
    /* lifecycle timestamps */
    const now = new Date();
    if (dto.status === 'order_confirmed' && !order.acceptedAt) order.acceptedAt = now;
    if (dto.status === 'out_for_delivery' && !order.pickedUpAt) order.pickedUpAt = now;
    if (dto.status === 'delivered') {
      order.deliveredAt = now;
      if (order.deliveryPartnerId) {
        await this.dataSource.query(
          `UPDATE delivery_partners SET is_available = true WHERE id = $1`, [order.deliveryPartnerId]);
      }
    }
    if (dto.status === 'cancelled') order.cancelledAt = now;
    const saved = await this.repo.save(order);
    await this.historyRepo.save(this.historyRepo.create({ orderId: id, status: dto.status, note: dto.note }));

    /* COD: collected on the doorstep → mark the payment row paid */
    if (dto.status === 'delivered') {
      await this.dataSource.query(
        `UPDATE payments SET status = 'paid'
          WHERE order_id = $1 AND method = 'cod' AND status = 'pending'`, [id]);
    }

    /* friendly in-app notification for the customer */
    const MSG: Record<string, { title: string; body: string }> = {
      order_confirmed:      { title: '✅ Order confirmed', body: 'The kitchen has accepted your order.' },
      preparing_food:       { title: '👨‍🍳 Cooking started', body: 'Your food is being freshly prepared.' },
      food_ready:           { title: '🍱 Food is ready', body: 'Packed and waiting for a rider.' },
      assigned_to_delivery: { title: '🛵 Rider assigned', body: 'A delivery partner is picking up your order.' },
      out_for_delivery:     { title: '🚀 Out for delivery', body: 'Your order is on its way. Track it live!' },
      delivered:            { title: '🎉 Delivered — enjoy!', body: 'Hope it was delicious. Rate your order?' },
      cancelled:            { title: '❌ Order cancelled', body: 'Your order was cancelled. Any payment will be refunded.' },
    };
    const m = MSG[dto.status];
    if (m && saved.userId) {
      await this.dataSource.query(
        `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
         VALUES ($1,$2,'in_app',$3,$4,true)`,
        [saved.userId, id, m.title, `Order ${saved.orderNumber || '#' + id}: ${m.body}`]);
    }
    return saved;
  }

  getHistory(orderId: number) {
    return this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  async remove(id: number) {
    const order = await this.findOne(id);
    await this.repo.remove(order);
    return { deleted: true, id };
  }
}
