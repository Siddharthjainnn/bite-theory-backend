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
  ) {}

  async findAll(filters: { userId?: number; deliveryPartnerId?: number; active?: boolean } = {}) {
    const qb = this.repo.createQueryBuilder('o').orderBy('o.placed_at', 'DESC');
    if (filters.userId) qb.andWhere('o.user_id = :uid', { uid: filters.userId });
    if (filters.deliveryPartnerId) qb.andWhere('o.delivery_partner_id = :pid', { pid: filters.deliveryPartnerId });
    if (filters.active) qb.andWhere(`o.status NOT IN ('delivered','cancelled')`);
    const rows = await qb.getMany();
    /* riders must never see the handoff OTP — only the customer gets it (§4.5) */
    if (filters.deliveryPartnerId) rows.forEach((r) => { (r as any).deliveryOtp = null; });
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
      // Log, but never 500 a webhook — Razorpay retries and we stay idempotent.
      console.error('[razorpay-webhook]', e?.message || e);
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
      } catch (e: any) {
        // Don't block the cancellation; flag for manual follow-up instead.
        console.error(`[refund] order ${orderId} failed:`, e?.message || e);
        await this.dataSource.query(
          `INSERT INTO notifications (user_id, order_id, channel, title, body, is_sent)
           VALUES ($1,$2,'in_app','⚠️ Refund pending','We hit a snag starting your refund automatically — our team will process it manually.',true)`,
          [order.userId, orderId]);
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

  async updateStatus(id: number, dto: UpdateOrderStatusDto, isAdmin = false, trustedCaller = false) {
    const order = await this.findOne(id);

    /* ── C1: authorize non-admin status changes ──────────────────────────
       Admin (server key) may drive any order. The rider app must prove it's
       the rider assigned to THIS order via deliveryPartnerId. `trustedCaller`
       is for internal transitions that were ALREADY authorized upstream —
       e.g. cancelByCustomer, which has its own ownership + status checks — so
       they aren't wrongly blocked by the rider rule. The public HTTP /status
       route never sets trustedCaller, so strangers are still locked out. */
    if (!isAdmin && !trustedCaller) {
      if (!order.deliveryPartnerId) {
        throw new ForbiddenException(
          'This order has no assigned rider. Only staff can change its status.');
      }
      if (Number(dto.deliveryPartnerId) !== Number(order.deliveryPartnerId)) {
        throw new ForbiddenException('You are not the rider assigned to this order.');
      }
    }

    /* An order cannot move to (or past) dispatch without a rider attached.
       This is what prevents the "out_for_delivery with NULL rider" bug. */
    if (['assigned_to_delivery', 'out_for_delivery', 'arriving_soon'].includes(dto.status)
        && !order.deliveryPartnerId) {
      throw new BadRequestException(
        'Assign a delivery partner before moving this order out for delivery.');
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

  async remove(id: number) {
    const order = await this.findOne(id);
    await this.repo.remove(order);
    return { deleted: true, id };
  }
}
