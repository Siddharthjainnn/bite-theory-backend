import { ForbiddenException,
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
import { haversineKm } from '../common/geo.util';
import { MailService } from '../common/mail.service';
import { SettingsService } from '../settings/settings.service';
import { ThaliService } from '../thali/thali.service';
import { ScratchService } from '../scratch/scratch.service';
import { FlashService } from '../flash/flash.service';
import { assertTransition, assertRiderMaySet } from './order-status.machine';
import { DeliveryPartnerService } from '../delivery_partners/delivery_partners.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private repo: Repository<Order>,
    @InjectRepository(OrderStatusHistory) private historyRepo: Repository<OrderStatusHistory>,
    @InjectDataSource() private dataSource: DataSource,
    private readonly razorpay: RazorpayService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly thali: ThaliService,
    private readonly scratch: ScratchService,
    private readonly flash: FlashService,
    private readonly partners: DeliveryPartnerService,
  ) {}

  async findAll(filters: { userId?: number; deliveryPartnerId?: number; active?: boolean } = {}) {
    const qb = this.repo.createQueryBuilder('o').orderBy('o.placed_at', 'DESC');
    if (filters.userId) qb.andWhere('o.user_id = :uid', { uid: filters.userId });
    if (filters.deliveryPartnerId) qb.andWhere('o.delivery_partner_id = :pid', { pid: filters.deliveryPartnerId });
    if (filters.active) qb.andWhere(`o.status NOT IN ('delivered','cancelled')`);
    const rows = await qb.getMany();

    /* riders must never see the handoff OTP — only the customer gets it (§4.5) */
    if (filters.deliveryPartnerId) {
      rows.forEach((r) => { (r as any).deliveryOtp = null; });

      /* A rider standing at the door needs to know two things this payload
         didn't carry: is this cash, and how much? Attach the live payment
         state so the app can show "collect ₹420" vs "already paid". */
      if (rows.length) {
        const ids = rows.map((r) => r.id);
        const pays = await this.dataSource.query(
          `SELECT order_id, method, status FROM payments WHERE order_id = ANY($1)`, [ids]);
        const byOrder = new Map<number, any>(
          pays.map((p: any) => [Number(p.order_id), p]));

        const qrs = await this.dataSource.query(
          `SELECT order_id FROM order_qr_payments
            WHERE order_id = ANY($1) AND status = 'active' AND close_by > now()`, [ids]);
        const qrOpen = new Set<number>(qrs.map((q: any) => Number(q.order_id)));

        /* Bug #77: a rider who can't find the door had no way to call the
           customer. Attach the customer's name + mobile — but ONLY for the
           rider assigned to that order, and ONLY while it's still in flight
           (never on delivered/cancelled history), so contact details aren't
           retained beyond the delivery. */
        const custs = await this.dataSource.query(
          `SELECT o.id AS order_id, u.first_name, u.last_name, u.mobile
             FROM orders o JOIN users u ON u.id = o.user_id
            WHERE o.id = ANY($1)
              AND o.delivery_partner_id = $2
              AND o.status NOT IN ('delivered','cancelled')`,
          [ids, filters.deliveryPartnerId]);
        const custByOrder = new Map<number, any>(
          custs.map((c: any) => [Number(c.order_id), c]));

        rows.forEach((r: any) => {
          const p = byOrder.get(Number(r.id));
          const owed = Math.max(Number(r.total) - Number(r.walletUsed || 0), 0);
          r.paymentMethod = p?.method ?? null;
          r.paymentStatus = p?.status ?? null;
          // Cash the rider must physically collect. Zero once paid (incl. by QR).
          r.cashToCollect = (p?.method === 'cod' && p?.status === 'pending') ? owed : 0;
          r.qrOpen = qrOpen.has(Number(r.id));

          const c = custByOrder.get(Number(r.id));
          r.customerName = c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : null;
          r.customerMobile = c?.mobile ?? null;
        });
      }
    }
    return rows;
  }

  /**
   * DISABLED: rider self-accept flow is turned off. Dispatch is admin-only now
   * (see assignRider). Kept returning an empty list so any stale rider client
   * that still polls this endpoint simply sees nothing to pick up.
   */
  async availableForRiders() {
    return [] as Order[];
  }

  /**
   * DISABLED: riders can no longer claim orders themselves. The admin assigns a
   * specific rider via assignRider(). This method is intentionally blocked so an
   * old rider app hitting POST /orders/:id/accept can't create assignments.
   */
  async acceptOrder(_orderId: number, _partnerId: number): Promise<never> {
    throw new ForbiddenException(
      'Self-accept is disabled. Orders are dispatched by the admin.');
  }

  /**
   * Admin dispatch: attach a SPECIFIC rider to an order and move it to
   * assigned_to_delivery. Supports reassigning (frees the previous rider).
   */
  async assignRider(orderId: number, partnerId: number) {
    const order = await this.findOne(orderId);
    if (['delivered', 'cancelled'].includes(order.status)) {
      throw new BadRequestException(`Order is already ${order.status}.`);
    }

    const rider = await this.dataSource.query(
      `SELECT id, name, is_active FROM delivery_partners WHERE id = $1`, [partnerId]);
    if (!rider.length || rider[0].is_active === false) {
      throw new BadRequestException('That rider is not active.');
    }

    /* ── CASH CAP ────────────────────────────────────────────────────────
       A rider already holding a pile of your undeposited cash must not be
       handed another cash order. This is the control that actually forces the
       money back — reports alone never do.

       It only applies to COD. A prepaid order carries no cash risk, so a
       capped-out rider can still deliver those and keep earning. Otherwise you
       punish the rider for a problem they can fix by depositing.

       Admin can override with `force` (see controller) for genuine edge cases. */
    const cod = await this.dataSource.query(
      `SELECT 1 FROM payments
        WHERE order_id = $1 AND method = 'cod' AND status = 'pending' LIMIT 1`, [orderId]);
    if (cod.length) {
      const cash = await this.partners.cashInHand(partnerId);
      const cap = DeliveryPartnerService.cashCap();
      if (cash >= cap) {
        throw new BadRequestException(
          `${rider[0].name} is holding ₹${cash.toFixed(0)} in undeposited cash (cap ₹${cap}). ` +
          `Take their deposit, or assign a rider with room. They can still take prepaid orders.`);
      }
    }

    // reassignment → free the previously assigned rider
    if (order.deliveryPartnerId && Number(order.deliveryPartnerId) !== partnerId) {
      await this.dataSource.query(
        `UPDATE delivery_partners SET is_available = true WHERE id = $1`,
        [order.deliveryPartnerId]);
    }

    order.deliveryPartnerId = partnerId;
    if (!['out_for_delivery', 'arriving_soon'].includes(order.status)) {
      order.status = 'assigned_to_delivery';
    }
    const saved = await this.repo.save(order);

    await this.dataSource.query(
      `UPDATE delivery_partners SET is_available = false WHERE id = $1`, [partnerId]);
    await this.historyRepo.save(this.historyRepo.create({
      orderId,
      status: 'assigned_to_delivery',
      note: `Assigned to ${rider[0].name || 'rider #' + partnerId} by admin`,
    }));

    if (saved.userId) {
      await this.dataSource.query(
        `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
         VALUES ($1,$2,'in_app','🛵 Rider assigned',$3,true)`,
        [saved.userId, orderId,
         `Order ${saved.orderNumber}: ${rider[0].name || 'a rider'} is handling your delivery.`]);
    }
    return this.findOneFull(orderId);
  }

  /**
   * Signature feature: admin attaches (or clears) a short "your food being
   * made" clip on a specific order. Pushes an in-app notification so the
   * customer knows to open their tracking page and watch it.
   */
  async setPrepVideo(orderId: number, prepVideoUrl: string | null) {
    const order = await this.findOne(orderId);
    const url = (prepVideoUrl || '').trim() || null;
    order.prepVideoUrl = url;
    await this.repo.save(order);

    if (url && order.userId) {
      await this.dataSource.query(
        `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
         VALUES ($1,$2,'in_app','🎬 Your food is being made!',$3,true)`,
        [order.userId, orderId,
         `Order ${order.orderNumber}: tap to watch your dish being prepared fresh.`]);
    }
    return this.findOneFull(orderId);
  }

  async findOne(id: number) {
    const order = await this.repo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /** Healthy-day streak: consecutive days (IST) whose delivered orders sum
      to >= 25g protein, computed from product macros. Used by StreakCard. */
  async streak(userId: number) {
    const THRESHOLD = 25; // grams of protein that make a day "healthy"
    const rows = await this.dataSource.query(
      `SELECT DATE(o.placed_at AT TIME ZONE 'Asia/Kolkata') AS day,
              COALESCE(SUM(COALESCE(p.protein, 0) * oi.quantity), 0) AS protein
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE o.user_id = $1 AND o.status = 'delivered'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 90`, [userId]);
    const qualifying = new Set(
      rows.filter((r: { protein: string }) => Number(r.protein) >= THRESHOLD)
          .map((r: { day: string | Date }) => new Date(r.day).toISOString().slice(0, 10)));
    // walk back from today (IST); allow the streak to start yesterday
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    let cursor = new Date(istNow.toISOString().slice(0, 10));
    if (!qualifying.has(cursor.toISOString().slice(0, 10))) {
      cursor = new Date(cursor.getTime() - 86400000); // today not yet earned
    }
    let streak = 0;
    while (qualifying.has(cursor.toISOString().slice(0, 10))) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86400000);
    }
    return { streak, threshold: THRESHOLD, healthyDays: qualifying.size };
  }

  /** Order + items in one call (customer order detail). */
  async findOneFull(id: number) {
    const order = await this.findOne(id);
    const items = await this.dataSource.query(
      `SELECT id, product_id AS "productId", product_name AS "productName",
              unit_price AS "unitPrice", quantity, line_total AS "lineTotal",
              thali_config AS "thaliConfig"
         FROM order_items WHERE order_id = $1 ORDER BY id`, [id]);
    const history = await this.getHistory(id);
    return { ...order, items, history };
  }

  /** Ownership-checked order read (customer sees only their own; admin sees all). */
  async findOneFullOwned(id: number, isAdmin: boolean, authUserId: number | null) {
    const order = await this.findOne(id);
    // When token enforcement is on and the caller isn't admin, they must own it.
    if (!isAdmin && process.env.USER_TOKEN_SECRET) {
      if (!authUserId || Number(order.userId) !== Number(authUserId)) {
        throw new ForbiddenException('Not your order');
      }
    }
    return this.findOneFull(id);
  }

  async trackOwned(id: number, isAdmin: boolean, authUserId: number | null) {
    await this.findOneFullOwned(id, isAdmin, authUserId); // throws if not allowed
    return this.track(id);
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

    /* store pin (kitchen) so the map shows something before a rider is assigned */
    const cfg = await this.settings.get();
    const store = cfg.storeLat != null && cfg.storeLng != null
      ? { lat: Number(cfg.storeLat), lng: Number(cfg.storeLng), address: cfg.storeAddress || null }
      : null;

    /* live ETA: recompute each poll, but HONESTLY — the number must reflect
       which leg the rider is actually on, not just the status flag.

       Key insight: `out_for_delivery`/`arriving_soon` does NOT mean the rider
       has left the restaurant. `picked_up_at` is the real signal. If it's null,
       the rider is still heading to (or waiting at) the kitchen, so the ETA has
       to include: reach-restaurant + remaining-prep + restaurant→home. Only
       after pickup do we count down the short rider→home leg. */
    let etaMinutes = full.etaMinutes ?? null;
    const destLat = full.deliveryLat != null ? Number(full.deliveryLat) : null;
    const destLng = full.deliveryLng != null ? Number(full.deliveryLng) : null;
    const kmph = Number(cfg.avgRiderKmph) || 20;
    const prepMin = Number(cfg.avgPrepMinutes) || 20;
    const minsFromKm = (km: number) => (km / kmph) * 60;
    const hasRider = partner?.lat != null && partner?.lng != null;
    const pickedUp = full.pickedUpAt != null;
    const terminal = ['delivered', 'cancelled'].includes(String(full.status));

    if (destLat != null && destLng != null && !terminal) {
      if (hasRider && pickedUp) {
        /* LEG 2: rider has the food and is driving to the customer.
           Count down purely on the rider's live position → home. */
        const remainKm = haversineKm(Number(partner.lat), Number(partner.lng), destLat, destLng);
        etaMinutes = Math.max(1, Math.round(minsFromKm(remainKm)));
      } else if (store) {
        /* LEG 1: food not yet picked up. Full journey estimate:
           (rider→restaurant if we know where the rider is, else 0)
           + remaining prep time
           + restaurant→home drive. */
        let toRestaurantMin = 0;
        if (hasRider) {
          const toStoreKm = haversineKm(Number(partner.lat), Number(partner.lng), store.lat, store.lng);
          toRestaurantMin = minsFromKm(toStoreKm);
        }

        /* remaining prep = full prep minus however long we've already been
           cooking (since the kitchen accepted, or since the order was placed).
           Never negative, never more than the full prep window. */
        const cookStart = full.acceptedAt ?? full.placedAt ?? null;
        let prepRemaining = prepMin;
        if (cookStart) {
          const elapsedMin = (Date.now() - new Date(cookStart).getTime()) / 60000;
          prepRemaining = Math.max(0, prepMin - elapsedMin);
        }

        const storeToHomeKm = haversineKm(store.lat, store.lng, destLat, destLng);
        etaMinutes = Math.max(
          1,
          Math.round(toRestaurantMin + prepRemaining + minsFromKm(storeToHomeKm)),
        );
      } else if (hasRider) {
        /* no store pin configured but we have a rider fix — best effort:
           straight rider→home, plus prep if not yet picked up. */
        const remainKm = haversineKm(Number(partner.lat), Number(partner.lng), destLat, destLng);
        etaMinutes = Math.max(1, Math.round(minsFromKm(remainKm) + (pickedUp ? 0 : prepMin)));
      }
    }

    return { ...full, etaMinutes, partner, store };
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
    if (!dto.items?.length && !dto.thaliItems?.length) throw new BadRequestException('Cart is empty');
    {
      const storeStatus = await this.settings.status();
      if (!storeStatus.open) {
        throw new BadRequestException(storeStatus.message || 'We are closed right now.');
      }
    }

    const priced = await this.priceCart({
      userId: dto.userId,
      items: dto.items,
      thaliItems: dto.thaliItems,
      couponCode: dto.couponCode,
      useWallet: dto.useWallet,
      tipAmount: dto.tipAmount,
      addressId: dto.addressId,
      deliveryLat: dto.deliveryLat ?? null,
      deliveryLng: dto.deliveryLng ?? null,
    });

    if (priced.payable < 1) {
      // wallet already covers it — no online payment needed
      throw new BadRequestException('No online payment needed; wallet covers the order.');
    }

    const receipt = 'rcpt_' + Date.now().toString(36);
    const rzp = await this.razorpay.createOrder(priced.payable, receipt);

    // Snapshot the cart against this Razorpay order so the webhook can
    // finish checkout even if the customer's browser dies right after paying.
    await this.dataSource.query(
      `INSERT INTO pending_payments (razorpay_order_id, user_id, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (razorpay_order_id) DO UPDATE SET payload = EXCLUDED.payload`,
      [rzp.id, dto.userId, JSON.stringify(dto)]);

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
    thaliItems?: { templateId: number; selections: { optionId: number; qty: number }[] }[];
    couponCode?: string; useWallet?: boolean; tipAmount?: number;
    addressId?: number; deliveryLat?: number | null; deliveryLng?: number | null;
  }) {
    const ids = (input.items || []).map((i) => i.productId);
    const products = await this.dataSource.query(
      `SELECT id, name, price, offer_price FROM products
        WHERE id = ANY($1) AND status = 'active'`, [ids]);
    const byId = new Map<number, any>(products.map((p: any) => [Number(p.id), p]));

    let subtotal = 0;
    for (const i of input.items || []) {
      const p = byId.get(Number(i.productId));
      if (!p) throw new BadRequestException(`Product ${i.productId} unavailable`);
      const price = Number(p.offer_price) > 0 && Number(p.offer_price) < Number(p.price)
        ? Number(p.offer_price) : Number(p.price);
      subtotal += price * i.quantity;
    }
    // customized thalis — same server-side validation as checkout
    for (const ti of input.thaliItems || []) {
      const pc = await this.thali.priceCheck(Number(ti.templateId), ti.selections || []);
      subtotal += pc.total;
    }

    let discount = 0;
    if (input.couponCode) {
      const rows = await this.dataSource.query(
        `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) LIMIT 1`, [input.couponCode.trim()]);
      let usedByUser = 0;
      if (rows[0]) {
        const r = await this.dataSource.query(
          `SELECT COUNT(*)::int AS n FROM coupon_redemptions
            WHERE coupon_id = $1 AND user_id = $2`, [rows[0].id, input.userId]);
        usedByUser = Number(r[0]?.n || 0);
      }
      const result = computeCouponDiscount(rows[0], subtotal, usedByUser);
      if (!result.valid) throw new BadRequestException(result.message);
      discount = result.discount;
    }

    const flashDeal = await this.flash.current();
    if (flashDeal) discount += Math.round(subtotal * Number(flashDeal.discountPct)) / 100;

    const cfg = await this.settings.get();
    if (subtotal < cfg.minOrderAmount) {
      throw new BadRequestException(
        `Minimum order is ₹${cfg.minOrderAmount}. Add ₹${(cfg.minOrderAmount - subtotal).toFixed(0)} more to checkout.`);
    }
    if (cfg.maxOrderAmount > 0 && subtotal > cfg.maxOrderAmount) {
      throw new BadRequestException(
        `Maximum order value is ₹${cfg.maxOrderAmount}. Please split into two orders.`);
    }
    /* destination coords: explicit > saved address */
    let dLat = input.deliveryLat ?? null;
    let dLng = input.deliveryLng ?? null;
    if ((dLat == null || dLng == null) && input.addressId) {
      const a = await this.dataSource.query(
        `SELECT latitude, longitude FROM addresses WHERE id = $1 AND user_id = $2`,
        [input.addressId, input.userId]);
      if (a.length) {
        dLat = dLat ?? (a[0].latitude != null ? Number(a[0].latitude) : null);
        dLng = dLng ?? (a[0].longitude != null ? Number(a[0].longitude) : null);
      }
    }

    /* C3: block payment for an address we can't zone-check (see checkout). */
    if ((Number(cfg.deliveryRadiusKm) || 0) > 0 && (dLat == null || dLng == null)) {
      throw new BadRequestException(
        'We couldn\'t pin your delivery location. Please edit the address and drop a pin on the map.');
    }

    const { deliveryCharge, distanceKm, etaMinutes } =
      this.deliveryPricing(cfg, subtotal - discount, dLat, dLng);
    const tip = Math.max(0, Math.min(Number(input.tipAmount) || 0, 500)); // cap ₹500
    let payable = subtotal - discount + deliveryCharge + tip;

    let walletUsed = 0;
    if (input.useWallet) {
      const u = await this.dataSource.query(
        `SELECT wallet_balance FROM users WHERE id = $1`, [input.userId]);
      const balance = Number(u[0]?.wallet_balance || 0);
      walletUsed = Math.min(balance, payable);
      payable -= walletUsed;
    }

    return { subtotal, discount, deliveryCharge, tip, walletUsed, payable, distanceKm, etaMinutes };
  }

  /**
   * ONE formula for delivery charge / radius / ETA, shared by
   * createPaymentOrder (priceCart) and checkout — so the Razorpay amount
   * and the final order total can never disagree.
   */
  private deliveryPricing(
    cfg: any, netSubtotal: number,
    dLat: number | null, dLng: number | null,
  ): { deliveryCharge: number; distanceKm: number | null; etaMinutes: number } {
    // free-above threshold always wins
    if (netSubtotal >= Number(cfg.freeDeliveryAbove)) {
      return { deliveryCharge: 0, distanceKm: this.distKmOrNull(cfg, dLat, dLng), etaMinutes: this.etaFor(cfg, dLat, dLng) };
    }
    const distanceKm = this.distKmOrNull(cfg, dLat, dLng);
    if (distanceKm == null) {
      // no store pin or no dest coords yet → flat legacy charge, default ETA
      return { deliveryCharge: Number(cfg.deliveryCharge), distanceKm: null, etaMinutes: 35 };
    }
    const radius = Number(cfg.deliveryRadiusKm) || 0;
    if (radius > 0 && distanceKm > radius) {
      throw new BadRequestException(
        `Sorry, you're ${distanceKm.toFixed(1)} km away — outside our ${radius} km delivery zone.`);
    }
    const freeKm = Number(cfg.freeDeliveryWithinKm) || 0;
    const deliveryCharge = distanceKm <= freeKm
      ? 0
      : Math.round(Number(cfg.baseDeliveryCharge) + distanceKm * Number(cfg.perKmCharge));
    return { deliveryCharge, distanceKm, etaMinutes: this.etaFor(cfg, dLat, dLng) };
  }

  private distKmOrNull(cfg: any, dLat: number | null, dLng: number | null): number | null {
    if (cfg.storeLat == null || cfg.storeLng == null || dLat == null || dLng == null) return null;
    return haversineKm(Number(cfg.storeLat), Number(cfg.storeLng), Number(dLat), Number(dLng));
  }

  private etaFor(cfg: any, dLat: number | null, dLng: number | null): number {
    const d = this.distKmOrNull(cfg, dLat, dLng);
    if (d == null) return 35;
    const kmph = Number(cfg.avgRiderKmph) || 20;
    return Math.round((Number(cfg.avgPrepMinutes) || 20) + (d / kmph) * 60);
  }

  /**
   * Swiggy-style checkout — one atomic transaction:
   * price items from DB, apply coupon, deduct wallet, create
   * order + items + history + payment, bump coupon usage, award points.
   */
  async checkout(dto: CheckoutDto, opts: { skipSignatureCheck?: boolean } = {}) {
    if (!dto.items?.length && !dto.thaliItems?.length) throw new BadRequestException('Cart is empty');
    {
      const storeStatus = await this.settings.status();
      if (!storeStatus.open) {
        throw new BadRequestException(storeStatus.message || 'We are closed right now.');
      }
    }

    // For online payments, verify the Razorpay signature BEFORE writing anything.
    // If it doesn't check out, we never create the order — no unpaid ghost orders.
    // (The webhook path skips this: its authenticity is proven by the webhook
    //  signature verified in the controller instead.)
    const isOnline = dto.paymentMethod === 'online';
    if (isOnline && !opts.skipSignatureCheck) {
      const ok = this.razorpay.verifySignature(
        dto.razorpayOrderId || '',
        dto.razorpayPaymentId || '',
        dto.razorpaySignature || '',
      );
      if (!ok) throw new BadRequestException('Payment verification failed. You were not charged.');
    }

    // Also confirm HOW MUCH was paid: the signature proves the payment is
    // genuine, but not that it covers this cart. Fetch the Razorpay order
    // amount so we can compare it against the server-priced payable below.
    const paidAmountPaise = isOnline
      ? await this.razorpay.fetchOrderAmountPaise(dto.razorpayOrderId || '')
      : 0;

    return this.dataSource.transaction(async (mgr) => {
      /* 0) idempotency — if this payment already produced an order (browser
         handler AND webhook can both land here), return the existing order
         instead of double-charging inventory/wallet/coupons. */
      if (isOnline && dto.razorpayPaymentId) {
        const dupe = await mgr.query(
          `SELECT order_id FROM payments WHERE transaction_id = $1 LIMIT 1`,
          [dto.razorpayPaymentId]);
        if (dupe.length) return this.findOneFull(Number(dupe[0].order_id));
      }

      /* 1) price items from DB — never trust client prices */
      const ids = (dto.items || []).map((i) => i.productId);
      const products = await mgr.query(
        `SELECT id, name, price, offer_price FROM products
          WHERE id = ANY($1) AND status = 'active'`, [ids]);
      const byId = new Map<number, any>(products.map((p: any) => [Number(p.id), p]));

      let subtotal = 0;
      const lines = (dto.items || []).map((i) => {
        const p = byId.get(Number(i.productId));
        if (!p) throw new BadRequestException(`Product ${i.productId} unavailable`);
        const price = Number(p.offer_price) > 0 && Number(p.offer_price) < Number(p.price)
          ? Number(p.offer_price) : Number(p.price);
        const lineTotal = price * i.quantity;
        subtotal += lineTotal;
        return { productId: Number(p.id), productName: p.name, unitPrice: price, quantity: i.quantity, lineTotal };
      });

      /* 1t) customized thalis — price & validate via ThaliService (portion
         model: max_qty per option, section portion limits, availability).
         The client's thali total is never trusted; the kitchen snapshot is
         built here from the SERVER's breakdown. */
      const thaliLines: { name: string; total: number; config: unknown }[] = [];
      for (const ti of dto.thaliItems || []) {
        const pc = await this.thali.priceCheck(Number(ti.templateId), ti.selections || []);
        subtotal += pc.total;
        thaliLines.push({
          name: pc.templateName,
          total: pc.total,
          config: {
            templateId: pc.templateId,
            basePrice: pc.basePrice,
            total: pc.total,
            items: pc.breakdown.map((b) => ({
              section: b.section, name: b.name, qty: b.qty,
              unitPrice: b.unitPrice, lineTotal: b.lineTotal,
            })),
          },
        });
      }

      /* 1b) stock check — reject before charging, never oversell.
         FOR UPDATE locks the rows so two simultaneous checkouts can't
         both grab the last plate. */
      const invRows = await mgr.query(
        `SELECT product_id, quantity, stock_status FROM inventory
          WHERE product_id = ANY($1) FOR UPDATE`, [ids]);
      const invBy = new Map<number, any>(invRows.map((r: any) => [Number(r.product_id), r]));
      for (const l of lines) {
        const row = invBy.get(l.productId);
        if (!row) continue; // untracked item — allow
        if (row.stock_status === 'out_of_stock' || Number(row.quantity) < l.quantity) {
          throw new BadRequestException(
            `"${l.productName}" has only ${Math.max(0, Number(row.quantity))} left. Please reduce the quantity.`);
        }
      }

      /* 2) coupon (server-side validation) */
      let discount = 0; let couponId: number | null = null;
      let assignmentId: number | null = null;
      if (dto.couponCode) {
        const rows = await mgr.query(
          `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) LIMIT 1`, [dto.couponCode.trim()]);
        let usedByUser = 0;
        let assigned = false;
        if (rows[0]) {
          const r = await mgr.query(
            `SELECT COUNT(*)::int AS n FROM coupon_redemptions
              WHERE coupon_id = $1 AND user_id = $2`, [rows[0].id, dto.userId]);
          usedByUser = Number(r[0]?.n || 0);
          // admin-gifted, unused assignment → bypass usage limits (§coupon assign)
          const a = await mgr.query(
            `SELECT id FROM coupon_assignments
              WHERE coupon_id = $1 AND user_id = $2 AND is_used = false
              ORDER BY id LIMIT 1`, [rows[0].id, dto.userId]);
          if (a[0]) { assigned = true; assignmentId = Number(a[0].id); }
        }
        const result = computeCouponDiscount(rows[0], subtotal, usedByUser, assigned);
        if (!result.valid) throw new BadRequestException(result.message);
        discount = result.discount;
        couponId = Number(rows[0].id);
      }

      /* 2b) flash deal — server re-checks the window AT ORDER TIME, so an
         expired deal can never apply even if the client still shows it */
      const deal = await this.flash.current();
      if (deal) discount += Math.round(subtotal * Number(deal.discountPct)) / 100;

      /* 3) delivery charge + rider tip */
      const cfg = await this.settings.get();
      if (subtotal < cfg.minOrderAmount)
        throw new BadRequestException(`Minimum order is ₹${cfg.minOrderAmount}.`);
      if (cfg.maxOrderAmount > 0 && subtotal > cfg.maxOrderAmount)
        throw new BadRequestException(`Maximum order value is ₹${cfg.maxOrderAmount}.`);
      let deliveryCharge = subtotal - discount >= cfg.freeDeliveryAbove ? 0 : cfg.deliveryCharge;
      const tip = Math.max(0, Math.min(Number(dto.tipAmount) || 0, 500));
      let payable = subtotal - discount + deliveryCharge + tip;

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

      /* 4b) online payments: paid amount must match the priced total */
      if (isOnline && Math.abs(Math.round(payable * 100) - paidAmountPaise) > 0) {
        throw new BadRequestException(
          'Paid amount does not match the order total. Please retry payment; contact support if you were charged.',
        );
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

      /* C3: if we enforce a delivery zone but this address has no coordinates,
         we can't verify it's deliverable — refuse rather than let the customer
         pay for a place we may not serve. (deliveryPricing silently skips the
         radius check when lat/lng are null, which is the loophole this closes.) */
      if ((Number(cfg.deliveryRadiusKm) || 0) > 0 && (deliveryLat == null || deliveryLng == null)) {
        throw new BadRequestException(
          'We couldn\'t pin your delivery location. Please edit the address and drop a pin on the map.');
      }

      /* 5b) distance: SAME formula as priceCart (radius reject, tiered charge, ETA) */
      const dp = this.deliveryPricing(cfg, subtotal - discount, deliveryLat, deliveryLng);
      const distanceKm = dp.distanceKm;
      const etaMinutes = dp.etaMinutes;
      if (dp.deliveryCharge !== deliveryCharge) {
        payable += dp.deliveryCharge - deliveryCharge; // adjust payable by the delta
        deliveryCharge = dp.deliveryCharge;
      }

      /* re-check online payment amount if the charge changed after address resolution */
      if (isOnline && Math.abs(Math.round(payable * 100) - paidAmountPaise) > 0) {
        throw new BadRequestException(
          'Paid amount does not match the order total. Please retry payment; contact support if you were charged.');
      }

      /* 6) create order */
      const orderNumber = 'BT' + Date.now().toString(36).toUpperCase() +
        Math.random().toString(36).slice(2, 5).toUpperCase();
      const total = payable;
      /* Mint the delivery OTP AT CREATION so the customer's tracking page always
         shows it, and the rider's "delivered" handoff always has something to
         match against. (Fixes the "invalid OTP" race from lazy minting.) */
      const deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
      const [order] = await mgr.query(
        `INSERT INTO orders (order_number, user_id, address_id, coupon_id, subtotal, discount,
             delivery_charge, tax, wallet_used, total, status, delivery_slot,
             delivery_lat, delivery_lng, delivery_address, eta_minutes, distance_km,
             tip, delivery_instructions, cooking_note, delivery_otp)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'order_received',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *, order_number AS "orderNumber", user_id AS "userId", placed_at AS "placedAt"`,
        [orderNumber, dto.userId, dto.addressId ?? null, couponId, subtotal, discount,
         deliveryCharge, walletUsed, total, dto.deliverySlot ?? null,
         deliveryLat, deliveryLng, deliveryAddress, etaMinutes, distanceKm,
         tip, dto.deliveryInstructions?.trim() || null, dto.cookingNote?.trim() || null,
         deliveryOtp]);
      const orderId = Number(order.id);

      /* 7) items */
      for (const l of lines) {
        await mgr.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orderId, l.productId, l.productName, l.unitPrice, l.quantity, l.lineTotal]);
      }
      for (const tl of thaliLines) {
        await mgr.query(
          `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total, thali_config)
           VALUES ($1,NULL,$2,$3,1,$3,$4)`,
          [orderId, tl.name, tl.total, JSON.stringify(tl.config)]);
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
        await mgr.query(
          `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id)
           VALUES ($1, $2, $3)`, [couponId, dto.userId, orderId]);
        // burn the admin gift so it can't be reused
        if (assignmentId) {
          await mgr.query(
            `UPDATE coupon_assignments
                SET is_used = true, order_id = $1, used_at = now()
              WHERE id = $2`, [orderId, assignmentId]);
        }
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

          /* 13b) milestone: 3 converted referrals → one-time ₹100 bonus.
             Idempotent via the unique wallet-transaction reason. */
          const MILESTONE_N = 3;
          const MILESTONE_BONUS = 100;
          const MILESTONE_REASON = 'Referral milestone — 3 dost aa gaye! 🎁';
          const conv = await mgr.query(
            `SELECT COUNT(*)::int AS n FROM referrals
              WHERE referrer_id = $1 AND is_converted = true`, [referrerId]);
          if (Number(conv[0].n) >= MILESTONE_N) {
            const already = await mgr.query(
              `SELECT 1 FROM wallet_transactions
                WHERE user_id = $1 AND reason = $2 LIMIT 1`,
              [referrerId, MILESTONE_REASON]);
            if (!already.length) {
              await mgr.query(
                `UPDATE users SET wallet_balance = COALESCE(wallet_balance,0) + $1, updated_at = now()
                  WHERE id = $2`, [MILESTONE_BONUS, referrerId]);
              await mgr.query(
                `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
                 VALUES ($1,'credit',$2,$3,$4)`,
                [referrerId, MILESTONE_BONUS, MILESTONE_REASON, orderId]);
              await mgr.query(
                `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
                 VALUES ($1,$2,'in_app','🏆 3 referrals complete!','Bonus ₹100 wallet mein aa gaya. Aise hi dosto ko khilao! 🎁',true)`,
                [referrerId, orderId]);
            }
          }
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

      /* 16) online: mark the pending-payment snapshot consumed */
      if (isOnline && dto.razorpayOrderId) {
        await mgr.query(
          `UPDATE pending_payments SET status = 'consumed', consumed_at = now()
            WHERE razorpay_order_id = $1`, [dto.razorpayOrderId]);
      }

      /* 17) confirmation email (fire-and-forget, optional) */
      const u = await mgr.query(`SELECT email FROM users WHERE id = $1`, [dto.userId]);
      this.mail.send(
        u[0]?.email,
        `Order ${orderNumber} confirmed — Bites Theory`,
        this.mail.orderPlacedHtml({ orderNumber, total, items: lines, deliveryAddress }),
      );

      return { ...order, id: orderId, items: lines, pointsEarned: points };
    });
  }

  /**
   * Razorpay webhook (payment.captured). The controller has already verified
   * the webhook signature against the raw body. This is the safety net for
   * "money captured but browser died before checkout" — if no order exists
   * for this payment yet, we create it from the pending snapshot.
   * Always resolves (webhook must get a 200 or Razorpay retries forever).
   */
  async handleRazorpayWebhook(event: any) {
    try {
      /* Doorstep QR paid — flip cod -> online and let the rider go. */
      if (event?.event === 'qr_code.credited') {
        const p = event?.payload?.payment?.entity;
        const q = event?.payload?.qr_code?.entity;
        const orderId = Number(p?.notes?.orderId ?? q?.notes?.orderId ?? 0);
        if (!orderId || !q?.id) return { ok: true, ignored: 'qr without orderId' };
        return await this.settleQrPayment(
          orderId, String(q.id), p?.id ? String(p.id) : null, Number(p?.amount ?? 0),
        );
      }

      if (event?.event !== 'payment.captured') return { ok: true, ignored: event?.event };
      const payment = event?.payload?.payment?.entity;
      const paymentId: string = payment?.id;
      const rzpOrderId: string = payment?.order_id;
      if (!paymentId || !rzpOrderId) return { ok: true, ignored: 'no payment entity' };

      // Order already created by the browser flow? Then we're done.
      const existing = await this.dataSource.query(
        `SELECT order_id FROM payments WHERE transaction_id = $1 LIMIT 1`, [paymentId]);
      if (existing.length) return { ok: true, orderId: Number(existing[0].order_id) };

      // Recover the cart snapshot saved at create-payment time.
      const rows = await this.dataSource.query(
        `SELECT payload FROM pending_payments
          WHERE razorpay_order_id = $1 AND status = 'pending' LIMIT 1`, [rzpOrderId]);
      if (!rows.length) return { ok: true, ignored: 'no pending snapshot' };

      const snap = typeof rows[0].payload === 'string'
        ? JSON.parse(rows[0].payload) : rows[0].payload;

      const order = await this.checkout(
        {
          ...snap,
          paymentMethod: 'online',
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: paymentId,
        } as CheckoutDto,
        { skipSignatureCheck: true },
      );
      return { ok: true, orderId: (order as any).id, recovered: true };
    } catch (e: any) {
      /* P1: DO NOT silently swallow this. We already returned 200 to Razorpay,
         so it will never retry — the money is captured and there is no order.
         Park it in failed_payments so ops can see it and reconcile, instead of
         the customer discovering it themselves. */
      console.error('[razorpay-webhook]', e?.message || e);
      try {
        const p = event?.payload?.payment?.entity;
        await this.dataSource.query(
          `INSERT INTO failed_payments
             (razorpay_payment_id, razorpay_order_id, amount_paise, error, payload)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (razorpay_payment_id) DO NOTHING`,
          [p?.id ?? null, p?.order_id ?? null, p?.amount ?? null,
           String(e?.message || e).slice(0, 500), JSON.stringify(event ?? {})]);
      } catch (inner: any) {
        // last resort — this one really is unrecoverable, so make it loud
        console.error('[razorpay-webhook] FAILED TO DEAD-LETTER', inner?.message || inner);
      }
      return { ok: true, error: e?.message };
    }
  }

  /**
   * Customer cancels their own order. Allowed only before the kitchen has
   * started cooking. Ownership is enforced (userId must match), and the
   * cancel path triggers the same refund logic as an admin cancel.
   */
  async cancelByCustomer(orderId: number, userId: number) {
    const order = await this.findOne(orderId);
    if (Number(order.userId) !== Number(userId)) {
      throw new BadRequestException('This order does not belong to you.');
    }
    const cancellable = ['order_received', 'order_confirmed'];
    if (!cancellable.includes(order.status)) {
      throw new BadRequestException(
        'This order is already being prepared and can no longer be cancelled. Please contact support.',
      );
    }
    return this.updateStatus(orderId, { status: 'cancelled', note: 'Cancelled by customer' }, false, true);
  }

  /**
   * Money back on cancellation:
   *  - online paid amount → real Razorpay refund (payments.status → 'refunded')
   *  - wallet portion     → credited back to the wallet
   * Idempotent: checks current payment status / existing wallet credit first.
   */
  private async refundOnCancel(orderId: number) {
    const order = await this.findOne(orderId);

    // 1) online refund via Razorpay
    const pay = await this.dataSource.query(
      `SELECT id, amount, transaction_id FROM payments
        WHERE order_id = $1 AND method = 'online' AND status = 'paid'
          AND transaction_id IS NOT NULL LIMIT 1`, [orderId]);
    if (pay.length) {
      try {
        const refund = await this.razorpay.refundPayment(pay[0].transaction_id, Number(pay[0].amount));
        await this.dataSource.query(
          `UPDATE payments SET status = 'refunded' WHERE id = $1`, [pay[0].id]);
        await this.dataSource.query(
          `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
           VALUES ($1,$2,'in_app','💸 Refund initiated',$3,true)`,
          [order.userId, orderId,
           `₹${pay[0].amount} refund started (ref ${refund?.id || ''}). It usually reaches your account in 5–7 working days.`]);

        /* S13 — cancellation refunds moved real money but wrote NO audit row,
           so they were invisible to any refund report and impossible to
           reconcile later. Log them exactly like an admin refund. */
        await this.dataSource.query(
          `INSERT INTO audit_logs (actor, action, entity, entity_id, details)
           VALUES ('system', 'order.refund', 'orders', $1, $2)`,
          [orderId, JSON.stringify({
            amount: Number(pay[0].amount),
            full: Number(pay[0].amount),
            partial: false,
            reason: 'Automatic refund on order cancellation',
            razorpayRefundId: refund?.id ?? null,
          })]);
      } catch (e: any) {
        // Don't block the cancellation; flag for manual follow-up instead.
        console.error(`[refund] order ${orderId} failed:`, e?.message || e);
        await this.dataSource.query(
          `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
           VALUES ($1,$2,'in_app','⚠️ Refund pending','We hit a snag starting your refund automatically — our team will process it manually.',true)`,
          [order.userId, orderId]);

        /* S13 — a FAILED auto-refund used to exist only in the server console.
           Nobody could find the customer who is owed money. Record it so it
           shows up in Admin → Refunds as needing manual action. */
        await this.dataSource.query(
          `INSERT INTO audit_logs (actor, action, entity, entity_id, details)
           VALUES ('system', 'order.refund_failed', 'orders', $1, $2)`,
          [orderId, JSON.stringify({
            amount: Number(pay[0].amount),
            reason: 'Automatic refund on cancellation FAILED — needs manual refund',
            error: String(e?.message || e).slice(0, 300),
          })]);
      }
    }

    // 2) wallet portion back to wallet (guard against double-credit)
    const walletUsed = Number(order.walletUsed || 0);
    if (walletUsed > 0) {
      const already = await this.dataSource.query(
        `SELECT 1 FROM wallet_transactions
          WHERE order_id = $1 AND type = 'credit' AND reason LIKE 'Refund%' LIMIT 1`, [orderId]);
      if (!already.length) {
        await this.dataSource.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance,0) + $1, updated_at = now()
            WHERE id = $2`, [walletUsed, order.userId]);
        await this.dataSource.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
           VALUES ($1,'credit',$2,$3,$4)`,
          [order.userId, walletUsed, `Refund for cancelled order ${order.orderNumber}`, orderId]);
      }
    }

    /* ── C2: reverse everything checkout consumed, so a cancel can't be
       farmed for free stock/coupons/referral cash. All steps are guarded by
       a single "reversal already done" marker so a double-cancel can't
       double-restore. */
    const reversed = await this.dataSource.query(
      `SELECT 1 FROM order_status_history
        WHERE order_id = $1 AND note = 'cancel-reversal-done' LIMIT 1`, [orderId]);
    if (!reversed.length) {
      // 3) restore inventory for every line, and re-activate products that
      //    were auto-hidden when they sold out.
      const items = await this.dataSource.query(
        `SELECT product_id, quantity FROM order_items WHERE order_id = $1`, [orderId]);
      for (const it of items) {
        await this.dataSource.query(
          `UPDATE inventory
              SET quantity = COALESCE(quantity,0) + $1,
                  stock_status = CASE
                    WHEN COALESCE(quantity,0) + $1 <= 0 THEN 'out_of_stock'
                    WHEN COALESCE(quantity,0) + $1 <= COALESCE(low_threshold, 5) THEN 'low'
                    ELSE 'in_stock' END,
                  updated_at = now()
            WHERE product_id = $2`, [Number(it.quantity), it.product_id]);
        // if it was hidden for being sold out and now has stock, show it again
        await this.dataSource.query(
          `UPDATE products p SET status = 'active', updated_at = now()
            FROM inventory i
           WHERE p.id = $1 AND i.product_id = p.id
             AND p.status = 'inactive' AND COALESCE(i.quantity,0) > 0`, [it.product_id]);
      }

      // 4) give back the coupon: drop its redemption row and decrement usage.
      if (order.couponId) {
        const del = await this.dataSource.query(
          `DELETE FROM coupon_redemptions WHERE order_id = $1 RETURNING id`, [orderId]);
        if (del.length) {
          await this.dataSource.query(
            `UPDATE coupons SET used_count = GREATEST(COALESCE(used_count,0) - 1, 0)
              WHERE id = $1`, [order.couponId]);
        }
      }

      // 5) reverse the referral reward if THIS order triggered it — claw back
      //    the ₹50 and re-open the referral so it can convert on a real order.
      const refRewards = await this.dataSource.query(
        `SELECT user_id, amount FROM wallet_transactions
          WHERE order_id = $1 AND type = 'credit'
            AND reason LIKE 'Referral reward%'`, [orderId]);
      for (const rr of refRewards) {
        await this.dataSource.query(
          `UPDATE users SET wallet_balance = GREATEST(COALESCE(wallet_balance,0) - $1, 0),
                            updated_at = now() WHERE id = $2`,
          [Number(rr.amount), rr.user_id]);
        await this.dataSource.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, reason, order_id)
           VALUES ($1,'debit',$2,'Referral reward reversed — friend''s first order was cancelled',$3)`,
          [rr.user_id, Number(rr.amount), orderId]);
      }
      await this.dataSource.query(
        `UPDATE referrals SET is_converted = false, rewarded = false, reward_amount = 0
          WHERE referred_user_id = $1 AND rewarded = true
            AND EXISTS (SELECT 1 FROM wallet_transactions
                        WHERE order_id = $2 AND reason LIKE 'Referral reward%')`,
        [order.userId, orderId]);

      // 6) reverse loyalty points earned on this order (and recompute tier).
      const lp = await this.dataSource.query(
        `SELECT COALESCE(SUM(points),0)::int AS pts FROM loyalty_points
          WHERE order_id = $1 AND type = 'earn'`, [orderId]);
      const earned = Number(lp[0]?.pts || 0);
      if (earned > 0) {
        await this.dataSource.query(
          `INSERT INTO loyalty_points (user_id, points, type, reason, order_id)
           VALUES ($1, $2, 'redeem', $3, $4)`,
          [order.userId, -earned, `Reversed — order ${order.orderNumber} cancelled`, orderId]);
        await this.dataSource.query(
          `UPDATE users SET loyalty_points = GREATEST(COALESCE(loyalty_points,0) - $1, 0)
            WHERE id = $2`, [earned, order.userId]);
        await this.dataSource.query(
          `UPDATE users SET loyalty_level = CASE
             WHEN loyalty_points >= 1000 THEN 'platinum'::loyalty_tier
             WHEN loyalty_points >= 500  THEN 'gold'::loyalty_tier
             WHEN loyalty_points >= 200  THEN 'silver'::loyalty_tier
             ELSE 'bronze'::loyalty_tier END
           WHERE id = $1`, [order.userId]);
      }

      // mark done so a second cancel can't restore twice
      await this.dataSource.query(
        `INSERT INTO order_status_history (order_id, status, note)
         VALUES ($1, 'cancelled', 'cancel-reversal-done')`, [orderId]);
    }
  }

  /* ── legacy admin create ── */
  async create(dto: CreateOrderDto) {
    const order = this.repo.create({
      ...dto,
      status: 'order_received',
      /* mint OTP at creation, same as checkout */
      deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
    });
    const saved = await this.repo.save(order);
    await this.historyRepo.save(this.historyRepo.create({ orderId: saved.id, status: 'order_received', note: 'Order placed' }));
    return saved;
  }

  async update(id: number, dto: UpdateOrderDto) {
    const order = await this.findOne(id);
    Object.assign(order, dto);
    return this.repo.save(order);
  }

  async updateStatus(
    id: number,
    dto: UpdateOrderStatusDto,
    isAdmin = false,
    trustedCaller = false,
    riderId: number | null = null,
  ) {
    const order = await this.findOne(id);

    /* ── P0-1: the lifecycle is a state machine, not a free-for-all ───────
       Applies to EVERYONE, admin included. `delivered` and `cancelled` are
       terminal, so no caller can walk a delivered order back to `cancelled`
       and trigger refundOnCancel() after the food is gone. Post-delivery
       money movement is an explicit, audited admin action: adminRefund(). */
    assertTransition(order.status, dto.status);

    /* ── P0-1: authorize non-admin status changes ─────────────────────────
       The rider's identity now comes from a SIGNED TOKEN (req.riderId), never
       from dto.deliveryPartnerId — that field was a sequential primary key we
       hand to every customer in the /track payload, i.e. not a secret.
       `trustedCaller` is for internal transitions already authorized upstream
       (cancelByCustomer, which does its own ownership + status checks). */
    if (!isAdmin && !trustedCaller) {
      if (!riderId) {
        throw new ForbiddenException('Rider sign-in required to change this order.');
      }
      if (!order.deliveryPartnerId) {
        throw new ForbiddenException(
          'This order has no assigned rider. Only staff can change its status.');
      }
      if (Number(riderId) !== Number(order.deliveryPartnerId)) {
        throw new ForbiddenException('You are not the rider assigned to this order.');
      }
      // A rider can drive a delivery. A rider cannot cancel or refund one.
      assertRiderMaySet(dto.status);
    }

    /* An order cannot move to (or past) dispatch without a rider attached.
       This is what prevents the "out_for_delivery with NULL rider" bug. */
    if (['assigned_to_delivery', 'out_for_delivery', 'arriving_soon'].includes(dto.status)
        && !order.deliveryPartnerId) {
      throw new BadRequestException(
        'Assign a delivery partner before moving this order out for delivery.');
    }

    /* Don't let the rider take cash while the customer is mid-scan. Without
       this, both happen and the customer pays twice. */
    if (dto.status === 'delivered' && !isAdmin) {
      const liveQr = await this.dataSource.query(
        `SELECT 1 FROM order_qr_payments
          WHERE order_id = $1 AND status = 'active' AND close_by > now() LIMIT 1`, [id]);
      if (liveQr.length) {
        throw new BadRequestException(
          'A UPI QR is open for this order. Wait for the payment to land, or cancel the QR to take cash instead.');
      }
    }

    /* Bug #93 — the ₹3,000 COD cap was only checked when an order was
       ASSIGNED. A rider sitting at ₹2,900 could still collect a ₹500 COD order
       and walk away holding ₹3,400: the app showed the warning but never
       enforced it. Check again at the moment cash actually changes hands. */
    if (dto.status === 'delivered' && !isAdmin && order.deliveryPartnerId) {
      const codPending = await this.dataSource.query(
        `SELECT 1 FROM payments
          WHERE order_id = $1 AND method = 'cod' AND status = 'pending' LIMIT 1`, [id]);
      if (codPending.length) {
        const cash = await this.partners.cashInHand(Number(order.deliveryPartnerId));
        const cap = DeliveryPartnerService.cashCap();
        const collecting = Math.max(
          Number(order.total) - Number(order.walletUsed || 0), 0);
        if (cash + collecting > cap) {
          throw new BadRequestException(
            `Cash limit reached. You are holding ₹${cash.toFixed(0)} and this ` +
            `order adds ₹${collecting.toFixed(0)} (cap ₹${cap}). Ask the ` +
            `customer to pay by UPI QR, or deposit your cash at the kitchen first.`);
        }
      }
    }

    /* ── delivered gating (§4.5 OTP / §3.4 geofence) — admin key bypasses ── */
    if (dto.status === 'delivered' && !isAdmin) {
      if (order.deliveryOtp) {
        const given = (dto.otp || '').trim();
        const expected = String(order.deliveryOtp).trim();
        if (!given || given !== expected) {
          throw new BadRequestException(
            'Wrong OTP. Ask the customer for the 4-digit code on their tracking page.');
        }
      } else if (order.deliveryLat != null && order.deliveryLng != null
                 && dto.riderLat != null && dto.riderLng != null) {
        // legacy orders without OTP: geofence 150m
        const d = haversineKm(dto.riderLat, dto.riderLng,
          Number(order.deliveryLat), Number(order.deliveryLng));
        if (d > 0.15) {
          throw new BadRequestException(
            `You're ${(d * 1000).toFixed(0)}m from the customer. Get closer to mark delivered.`);
        }
      }
    }

    order.status = dto.status;
    /* lifecycle timestamps */
    const now = new Date();
    if (dto.status === 'order_confirmed' && !order.acceptedAt) order.acceptedAt = now;
    if (dto.status === 'out_for_delivery' && !order.pickedUpAt) {
      order.pickedUpAt = now;
      /* OTP is already minted at order creation — nothing to do here.
         (Safety net for any legacy row that somehow has none.) */
      if (!order.deliveryOtp) {
        order.deliveryOtp = String(Math.floor(1000 + Math.random() * 9000));
      }
    }
    if (dto.status === 'delivered') {
      order.deliveredAt = now;
      if (order.deliveryPartnerId) {
        await this.dataSource.query(
          `UPDATE delivery_partners SET is_available = true WHERE id = $1`, [order.deliveryPartnerId]);
        /* §3.3: clear rider's last position so it doesn't leak into idle state */
        await this.dataSource.query(
          `UPDATE delivery_partners SET current_lat = NULL, current_lng = NULL WHERE id = $1`,
          [order.deliveryPartnerId]);
        /* §4.1/§4.2: credit the rider — base fare + distance pay + THE TIP.
           ON CONFLICT (order_id) keeps this idempotent under retries. */
        const cfg = await this.settings.get();
        const distancePay = order.distanceKm != null
          ? Number(order.distanceKm) * Number(cfg.riderPerKmPay) : 0;
        const tip = Number((order as any).tip) || 0;
        const totalPay = Number(cfg.riderBaseFare) + distancePay + tip;
        await this.dataSource.query(
          `INSERT INTO rider_earnings
             (delivery_partner_id, order_id, base_fare, distance_pay, tip, total)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (order_id) DO NOTHING`,
          [order.deliveryPartnerId, id, cfg.riderBaseFare,
           Math.round(distancePay * 100) / 100, tip, Math.round(totalPay * 100) / 100]);
      }
    }
    if (dto.status === 'cancelled') {
      order.cancelledAt = now;
      // free the assigned rider so they don't stay is_available=false forever
      if (order.deliveryPartnerId) {
        await this.dataSource.query(
          `UPDATE delivery_partners SET is_available = true WHERE id = $1`,
          [order.deliveryPartnerId]);
      }
    }
    const saved = await this.repo.save(order);

    /* cancelled → give the money back (online refund + wallet credit) */
    if (dto.status === 'cancelled') {
      await this.refundOnCancel(id);
    }
    await this.historyRepo.save(this.historyRepo.create({ orderId: id, status: dto.status, note: dto.note }));
    if (dto.status === 'delivered') {
      // scratch card minted at delivery — reward decided server-side, once per order
      this.scratch.createForOrder(id, Number(order.userId)).catch(() => {});
    }

    /* COD: collected on the doorstep → mark the payment row paid.
       If the customer paid by QR, the row is already method='online'/'paid', so
       this UPDATE matches nothing and the rider is correctly credited with ZERO
       cash. Cash-in-hand only moves when actual cash actually moved. */
    if (dto.status === 'delivered') {
      const cash = await this.dataSource.query(
        `UPDATE payments SET status = 'paid'
          WHERE order_id = $1 AND method = 'cod' AND status = 'pending'
        RETURNING amount`, [id]);

      if (cash.length && order.deliveryPartnerId) {
        await this.dataSource.query(
          `INSERT INTO rider_cash_ledger (rider_id, order_id, kind, amount, note)
           VALUES ($1,$2,'collect',$3,$4)
           ON CONFLICT (order_id) DO NOTHING`,
          [order.deliveryPartnerId, id, Number(cash[0].amount),
           `Cash collected for ${order.orderNumber || '#' + id}`]);
      }

      // Any QR still hanging open is now moot — close it so it can't be paid
      // after the fact.
      this.cancelDoorstepQr(id).catch(() => {});
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

      /* email on the big moments (optional, no-op if SMTP unset) */
      if (dto.status === 'delivered' || dto.status === 'cancelled') {
        const u = await this.dataSource.query(
          `SELECT email FROM users WHERE id = $1`, [saved.userId]);
        this.mail.send(
          u[0]?.email,
          `${m.title} — Bites Theory`,
          this.mail.statusHtml(saved.orderNumber || `#${id}`, m.title, m.body),
        );
      }
    }
    return saved;
  }

  getHistory(orderId: number) {
    return this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  /* ═══════════════ DOORSTEP UPI QR — pay online at the door ═══════════════
     The rider shows a QR for the EXACT amount owed. The customer scans with any
     UPI app. Razorpay's `qr_code.credited` webhook flips the payment from cod to
     online, automatically. The rider never touches cash, so their cash-in-hand
     never moves. */

  /** Rupees the customer still owes at the door (wallet already deducted). */
  private cashToCollect(order: Order): number {
    return Math.max(Number(order.total) - Number(order.walletUsed || 0), 0);
  }

  /** The single open COD payment row for this order, or null. */
  private async pendingCodPayment(orderId: number) {
    const rows = await this.dataSource.query(
      `SELECT id, amount, status, method FROM payments
        WHERE order_id = $1 AND method = 'cod' AND status = 'pending' LIMIT 1`,
      [orderId]);
    return rows[0] || null;
  }

  /**
   * Rider taps "Customer wants to pay online" → mint a QR.
   *
   * Safe by construction:
   *  - amount is computed SERVER-side from the order; the rider never sends it
   *  - fixed_amount:true → Razorpay rejects any other amount
   *  - single_use → the QR dies after one payment; a screenshot is worthless
   *  - a partial unique index means at most ONE active QR per order can exist,
   *    so a double-tap returns the SAME QR instead of minting a second payable one
   */
  async createDoorstepQr(orderId: number, riderId: number | null) {
    const order = await this.findOne(orderId);

    if (order.status === 'cancelled') {
      throw new BadRequestException('This order is cancelled.');
    }
    const cod = await this.pendingCodPayment(orderId);
    if (!cod) {
      throw new BadRequestException(
        'Nothing to collect — this order is already paid.');
    }

    /* BUGFIX — 500 on POST /orders/:id/collect/qr.
       order_qr_payments has a UNIQUE index on (order_id) WHERE status='active',
       but NOTHING ever retired an expired row. The SELECT below skips expired
       QRs (close_by > now()), so the code happily tried to INSERT a fresh one —
       and the still-'active' expired row tripped the unique index, surfacing as
       a raw Postgres error = 500. Once a rider's QR aged past close_by, that
       order could NEVER get another QR.
       Retire anything past close_by first, then the insert is safe. */
    await this.dataSource.query(
      `UPDATE order_qr_payments
          SET status = 'closed'
        WHERE order_id = $1 AND status = 'active' AND close_by <= now()`,
      [orderId]);

    // Re-use a live QR rather than minting another one.
    const live = await this.dataSource.query(
      `SELECT razorpay_qr_id AS "qrId", image_url AS "imageUrl",
              amount_paise AS "amountPaise", close_by AS "closeBy"
         FROM order_qr_payments
        WHERE order_id = $1 AND status = 'active' AND close_by > now()
        LIMIT 1`, [orderId]);
    if (live.length) {
      return { ...live[0], amount: Number(live[0].amountPaise) / 100, reused: true };
    }

    const amount = this.cashToCollect(order);
    const qr = await this.razorpay.createQrCode(amount, orderId);

    try {
      await this.dataSource.query(
        `INSERT INTO order_qr_payments
           (order_id, razorpay_qr_id, amount_paise, image_url, status, close_by, created_by_rider)
         VALUES ($1,$2,$3,$4,'active', to_timestamp($5), $6)`,
        [orderId, qr.id, qr.amountPaise, qr.imageUrl, qr.closeBy, riderId]);
    } catch (e: any) {
      /* Belt and braces: if two taps race, one loses the unique index. Return
         the QR that won instead of a 500. */
      if (String(e?.code) === '23505') {
        const won = await this.dataSource.query(
          `SELECT razorpay_qr_id AS "qrId", image_url AS "imageUrl",
                  amount_paise AS "amountPaise", close_by AS "closeBy"
             FROM order_qr_payments
            WHERE order_id = $1 AND status = 'active'
            LIMIT 1`, [orderId]);
        if (won.length) {
          return { ...won[0], amount: Number(won[0].amountPaise) / 100, reused: true };
        }
      }
      throw e;
    }

    return {
      qrId: qr.id,
      imageUrl: qr.imageUrl,
      amount,
      amountPaise: qr.amountPaise,
      closeBy: new Date(qr.closeBy * 1000).toISOString(),
      reused: false,
    };
  }

  /**
   * Rider's poll loop AND the customer's tracking page hit this.
   * Falls back to asking Razorpay directly if the webhook hasn't landed yet —
   * a doorstep rider cannot stand there waiting on our webhook queue.
   */
  async collectStatus(orderId: number) {
    const order = await this.findOne(orderId);
    const owed = this.cashToCollect(order);

    const paid = await this.dataSource.query(
      `SELECT 1 FROM payments
        WHERE order_id = $1 AND status = 'paid' LIMIT 1`, [orderId]);
    if (paid.length) {
      return { paid: true, method: 'online', amount: owed, qr: null };
    }

    const qrs = await this.dataSource.query(
      `SELECT razorpay_qr_id AS "qrId", image_url AS "imageUrl", status,
              amount_paise AS "amountPaise", close_by AS "closeBy"
         FROM order_qr_payments
        WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [orderId]);
    const qr = qrs[0] || null;

    // Webhook slow or lost? Ask Razorpay directly. This is the safety net that
    // keeps the rider from being stranded at the door.
    if (qr && qr.status === 'active') {
      const live = await this.razorpay.fetchQrCode(qr.qrId);
      if (live && Number(live.payments_count_received) > 0) {
        await this.settleQrPayment(orderId, qr.qrId, null, Number(live.payments_amount_received));
        return { paid: true, method: 'online', amount: owed, qr: null, viaPoll: true };
      }
    }

    return { paid: false, method: 'cod', amount: owed, qr };
  }

  /** Rider aborts the QR — customer decided to pay cash after all. */
  async cancelDoorstepQr(orderId: number) {
    const rows = await this.dataSource.query(
      `SELECT razorpay_qr_id AS "qrId" FROM order_qr_payments
        WHERE order_id = $1 AND status = 'active' LIMIT 1`, [orderId]);
    if (!rows.length) return { ok: true, nothingToCancel: true };

    await this.razorpay.closeQrCode(rows[0].qrId);
    await this.dataSource.query(
      `UPDATE order_qr_payments SET status = 'closed'
        WHERE razorpay_qr_id = $1 AND status = 'active'`, [rows[0].qrId]);
    return { ok: true, closed: rows[0].qrId };
  }

  /**
   * The money actually landed. Convert cod → online, atomically and idempotently.
   *
   * THE DANGEROUS CASE, and why this is a transaction:
   * the customer scans and pays at the same moment the rider taps "collected
   * cash". Without this, the customer pays TWICE and we keep both. Here, if the
   * COD row is already 'paid' (rider took cash first), we do NOT silently keep
   * the money — we auto-refund the QR payment and raise an incident.
   */
  async settleQrPayment(
    orderId: number,
    qrId: string,
    razorpayPaymentId: string | null,
    amountPaise: number,
  ) {
    return this.dataSource.transaction(async (mgr) => {
      // idempotency — this payment already booked?
      if (razorpayPaymentId) {
        const dupe = await mgr.query(
          `SELECT 1 FROM payments WHERE transaction_id = $1 LIMIT 1`, [razorpayPaymentId]);
        if (dupe.length) return { ok: true, alreadySettled: true };
      }

      // Lock the order row so the rider's "delivered" cannot interleave.
      const orows = await mgr.query(
        `SELECT id, total, wallet_used, order_number, user_id
           FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
      if (!orows.length) return { ok: true, ignored: 'no such order' };
      const o = orows[0];
      const owedPaise = Math.round(
        Math.max(Number(o.total) - Number(o.wallet_used || 0), 0) * 100);

      const cod = await mgr.query(
        `SELECT id, status FROM payments
          WHERE order_id = $1 AND method = 'cod' LIMIT 1`, [orderId]);

      /* ── DOUBLE COLLECTION ── rider already took cash, and now UPI money has
         landed too. Give it straight back and page a human. Keeping it is theft
         and it is exactly the kind of thing that ends up on Twitter. */
      if (cod.length && cod[0].status === 'paid' && razorpayPaymentId) {
        await mgr.query(
          `INSERT INTO payment_incidents (order_id, kind, details)
           VALUES ($1, 'double_collection', $2)`,
          [orderId, JSON.stringify({ qrId, razorpayPaymentId, amountPaise })]);
        this.razorpay.refundPayment(razorpayPaymentId, amountPaise / 100)
          .catch((e) => console.error('[qr double-collect refund]', e?.message));
        await mgr.query(
          `UPDATE order_qr_payments SET status='paid', paid_at=now(),
                  razorpay_payment_id=$2
            WHERE razorpay_qr_id = $1`, [qrId, razorpayPaymentId]);
        return { ok: true, doubleCollection: true, autoRefunded: true };
      }

      // Amount sanity. fixed_amount:true should make this impossible — so if it
      // ever fires, something is genuinely wrong and a human must look.
      if (amountPaise !== owedPaise) {
        await mgr.query(
          `INSERT INTO payment_incidents (order_id, kind, details)
           VALUES ($1, 'amount_mismatch', $2)`,
          [orderId, JSON.stringify({ qrId, razorpayPaymentId, amountPaise, owedPaise })]);
      }

      // cod -> online. The rider's cash-in-hand is never touched.
      if (cod.length) {
        await mgr.query(
          `UPDATE payments
              SET method = 'online', status = 'paid', transaction_id = $2
            WHERE id = $1 AND status = 'pending'`,
          [cod[0].id, razorpayPaymentId]);
      } else {
        await mgr.query(
          `INSERT INTO payments (order_id, method, amount, status, transaction_id)
           VALUES ($1,'online',$2,'paid',$3)`,
          [orderId, amountPaise / 100, razorpayPaymentId]);
      }

      await mgr.query(
        `UPDATE order_qr_payments
            SET status='paid', paid_at=now(), razorpay_payment_id=$2
          WHERE razorpay_qr_id = $1`, [qrId, razorpayPaymentId]);

      await mgr.query(
        `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
         VALUES ($1,$2,'in_app','✅ Payment received',$3,true)`,
        [o.user_id, orderId,
         `We received ₹${(amountPaise / 100).toFixed(2)} for order ${o.order_number || '#' + orderId}. No cash needed — thank you!`]);

      return { ok: true, settled: true, orderId, amountPaise };
    });
  }

  /**
   * P0-1 replacement path: post-delivery money movement.
   *
   * The ONLY legitimate way to return money on a delivered order. Deliberate,
   * admin-only, audited, and it does NOT touch order status, inventory,
   * coupons, referral cash or rider earnings — the food was made, delivered
   * and paid for. Reversing those was what made the old cancel-after-delivery
   * bug so expensive.
   *
   * Idempotent: the `status = 'paid'` filter means a second call finds nothing.
   */
  /**
   * S13 — everything the admin needs to manage refunds in one call:
   *   1. `refunds`   — what has ALREADY been refunded (from audit_logs, the
   *                    money source of truth), newest first.
   *   2. `refundable` — orders with a captured online payment that has NOT been
   *                    refunded yet, so an admin can act without hunting.
   *
   * Deliberately reads audit_logs instead of introducing a refunds table: the
   * audit row is written inside the same flow that calls Razorpay, so the list
   * can never disagree with what actually happened.
   */
  /** True if audit_logs has the `actor` column (see 2026-07-16-audit-actor.sql). */
  private async auditHasActor(): Promise<boolean> {
    try {
      const r = await this.dataSource.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'audit_logs' AND column_name = 'actor' LIMIT 1`);
      return r.length > 0;
    } catch { return false; }
  }

  async listRefunds(q?: string) {
    const term = (q || '').trim();

    /* BUGFIX — GET /orders/refunds/list returned 500.
       Root cause: audit_logs.actor did not exist. The column was declared on
       the entity and written by raw SQL in the refund path, but no migration
       ever created it (audit_logs predates the migrations folder), and the
       refund path had never run in production — so nothing surfaced the gap
       until this screen tried to SELECT a.actor.
       2026-07-16-audit-actor.sql adds it. This guard means a missing column can
       degrade the actor name rather than take the whole page down. */
    const hasActor = await this.auditHasActor();
    const actorCol = hasActor ? 'a.actor' : `'system'`;

    const refunds = await this.dataSource.query(
      `SELECT a.id,
              a.entity_id                         AS "orderId",
              o.order_number                      AS "orderNumber",
              o.total                             AS "orderTotal",
              o.status                            AS "orderStatus",
              u.first_name || ' ' || COALESCE(u.last_name,'') AS "customer",
              u.mobile                            AS "customerMobile",
              (a.details->>'amount')::numeric     AS amount,
              (a.details->>'partial')::boolean    AS partial,
              a.details->>'reason'                AS reason,
              a.details->>'razorpayRefundId'      AS "razorpayRefundId",
              (a.action = 'order.refund_failed')  AS failed,
              a.details->>'error'                 AS error,
              ${actorCol}                         AS actor,
              a.created_at                        AS "createdAt"
         FROM audit_logs a
         LEFT JOIN orders o ON o.id = a.entity_id
         LEFT JOIN users  u ON u.id = o.user_id
        WHERE a.action IN ('order.refund', 'order.refund_failed')
          AND ($1 = '' OR o.order_number ILIKE '%' || $1 || '%'
                       OR u.mobile ILIKE '%' || $1 || '%'
                       OR u.first_name ILIKE '%' || $1 || '%')
        ORDER BY a.created_at DESC
        LIMIT 200`, [term]);

    const refundable = await this.dataSource.query(
      `SELECT o.id                                AS "orderId",
              o.order_number                      AS "orderNumber",
              o.total                             AS "orderTotal",
              o.status                            AS "orderStatus",
              o.placed_at                         AS "placedAt",
              u.first_name || ' ' || COALESCE(u.last_name,'') AS "customer",
              u.mobile                            AS "customerMobile",
              p.amount                            AS "paidAmount",
              p.transaction_id                    AS "transactionId"
         FROM orders o
         JOIN payments p ON p.order_id = o.id
                        AND p.method = 'online'
                        AND p.status = 'paid'
                        AND p.transaction_id IS NOT NULL
         LEFT JOIN users u ON u.id = o.user_id
        WHERE o.deleted_at IS NULL
          AND ($1 = '' OR o.order_number ILIKE '%' || $1 || '%'
                       OR u.mobile ILIKE '%' || $1 || '%'
                       OR u.first_name ILIKE '%' || $1 || '%')
        ORDER BY o.placed_at DESC
        LIMIT 100`, [term]);

    const totalRefunded = refunds
      .filter((r: any) => !r.failed)
      .reduce((sum: number, r: any) => sum + Number(r.amount || 0), 0);
    const failedCount = refunds.filter((r: any) => r.failed).length;

    return {
      refunds,
      refundable,
      summary: {
        count: refunds.length,
        totalRefunded: Math.round(totalRefunded * 100) / 100,
        refundableCount: refundable.length,
        failedCount,
      },
    };
  }

  async adminRefund(orderId: number, reason: string, amountRupees?: number) {
    const order = await this.findOne(orderId);
    if (!reason || !reason.trim()) {
      throw new BadRequestException('A refund reason is required (it goes in the audit log).');
    }

    const pay = await this.dataSource.query(
      `SELECT id, amount, transaction_id FROM payments
        WHERE order_id = $1 AND method = 'online' AND status = 'paid'
          AND transaction_id IS NOT NULL LIMIT 1`, [orderId]);

    if (!pay.length) {
      throw new BadRequestException(
        'No captured online payment to refund on this order (already refunded, or COD).');
    }

    const full = Number(pay[0].amount);
    const amount = amountRupees && amountRupees > 0 ? Math.min(amountRupees, full) : full;
    const isPartial = amount < full;

    const refund = await this.razorpay.refundPayment(pay[0].transaction_id, amount);

    // Only a FULL refund closes out the payment row; a partial leaves it 'paid'
    // so the remainder is still reconcilable.
    if (!isPartial) {
      await this.dataSource.query(
        `UPDATE payments SET status = 'refunded' WHERE id = $1`, [pay[0].id]);
    }

    await this.dataSource.query(
      `INSERT INTO audit_logs (actor, action, entity, entity_id, details)
       VALUES ('admin', 'order.refund', 'orders', $1, $2)`,
      [orderId, JSON.stringify({
        amount, full, partial: isPartial, reason, razorpayRefundId: refund?.id ?? null,
      })]);

    await this.dataSource.query(
      `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
       VALUES ($1,$2,'in_app','💸 Refund initiated',$3,true)`,
      [order.userId, orderId,
       `₹${amount} refund started (ref ${refund?.id || ''}). It usually reaches your account in 5–7 working days.`]);

    return { ok: true, orderId, amount, partial: isPartial, razorpayRefundId: refund?.id ?? null };
  }

  /**
   * P1: orders are financial records — never hard-delete them. You will need
   * this row for a chargeback dispute six months from now.
   */
  async remove(id: number) {
    const order = await this.findOne(id);
    await this.dataSource.query(
      `UPDATE orders SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
    await this.dataSource.query(
      `INSERT INTO audit_logs (actor, action, entity, entity_id, details)
       VALUES ('admin', 'order.soft_delete', 'orders', $1, $2)`,
      [id, JSON.stringify({ status: order.status, orderNumber: order.orderNumber })]);
    return { deleted: true, softDeleted: true, id };
  }
}
