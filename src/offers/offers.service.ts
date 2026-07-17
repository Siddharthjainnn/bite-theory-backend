import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Offer } from './offer.entity';
import { evaluateOffer, secondsLeft, OfferRow } from './offer.util';
import { AuditService } from '../audit_logs/audit.service';

@Injectable()
export class OffersService {
  constructor(
    @InjectRepository(Offer) private readonly repo: Repository<Offer>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /* ─────────── public ─────────── */

  /**
   * Offers that are live RIGHT NOW, newest-ending first so the most urgent
   * countdown leads.
   *
   * `endsAt` is sent as an absolute ISO timestamp and the client counts down
   * from it — never a "secondsLeft" number the client decrements. A client
   * clock that's 10 minutes fast would otherwise show an expired offer as
   * live, and the customer would tap it and get rejected at checkout.
   */
  async live(userId?: number) {
    const rows = await this.dataSource.query(
      `SELECT o.id, o.title, o.subtitle, o.offer_type AS "offerType",
              o.reward_value AS "rewardValue", o.max_discount AS "maxDiscount",
              o.free_product_id AS "freeProductId", o.min_order AS "minOrder",
              o.starts_at AS "startsAt", o.ends_at AS "endsAt",
              o.usage_limit AS "usageLimit", o.used_count AS "usedCount",
              o.per_user_limit AS "perUserLimit",
              o.image_url AS "imageUrl", o.badge, o.accent,
              p.name AS "freeProductName", p.image AS "freeProductImage",
              p.price AS "freeProductPrice"
         FROM offers o
         LEFT JOIN products p ON p.id = o.free_product_id
        WHERE o.is_active = true
          AND o.starts_at <= now() AND o.ends_at > now()
          AND (o.usage_limit IS NULL OR o.used_count < o.usage_limit)
        ORDER BY o.sort_order ASC, o.ends_at ASC`);

    if (!rows.length) return [];

    /* Mark what this customer has already used, so the UI can grey it out
       instead of letting them tap something that will be refused. */
    let usedMap = new Map<number, number>();
    if (userId) {
      const used = await this.dataSource.query(
        `SELECT offer_id, COUNT(*)::int AS n FROM offer_redemptions
          WHERE user_id = $1 GROUP BY offer_id`, [userId]);
      usedMap = new Map(used.map((u: any) => [Number(u.offer_id), Number(u.n)]));
    }

    return rows.map((r: any) => ({
      ...r,
      id: Number(r.id),
      secondsLeft: secondsLeft(r.endsAt),
      usedByYou: usedMap.get(Number(r.id)) || 0,
      exhausted: (usedMap.get(Number(r.id)) || 0) >= Number(r.perUserLimit ?? 1),
      /* Scarcity, but only when it's real. "3 left" when 3 are genuinely left
         converts; a fake counter is a lie customers eventually notice. */
      remaining: r.usageLimit == null
        ? null
        : Math.max(0, Number(r.usageLimit) - Number(r.usedCount || 0)),
    }));
  }

  /** Check an offer against a cart — the same call the cart screen uses. */
  async check(offerId: number, userId: number, subtotal: number, deliveryCharge: number) {
    const offer = await this.repo.findOne({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('That offer no longer exists.');

    const [{ n }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM offer_redemptions
        WHERE offer_id = $1 AND user_id = $2`, [offerId, userId]);

    return evaluateOffer(offer as unknown as OfferRow, subtotal, deliveryCharge, Number(n));
  }

  /* ─────────── admin ─────────── */

  async adminList() {
    return this.dataSource.query(
      `SELECT o.*, p.name AS "freeProductName",
              (o.is_active AND o.starts_at <= now() AND o.ends_at > now()) AS live,
              COALESCE(r.redemptions, 0)::int AS redemptions,
              ROUND(COALESCE(r.benefit, 0), 2) AS "benefitGiven"
         FROM offers o
         LEFT JOIN products p ON p.id = o.free_product_id
         LEFT JOIN (
           SELECT offer_id, COUNT(*) AS redemptions, SUM(benefit) AS benefit
             FROM offer_redemptions GROUP BY offer_id) r ON r.offer_id = o.id
        ORDER BY o.sort_order ASC, o.ends_at DESC`);
  }

  async create(dto: any, req?: any) {
    this.validate(dto);
    const saved = await this.repo.save(this.repo.create(dto as any));
    await this.audit.log('offer.create', 'offers', (saved as any).id,
      { title: dto.title, type: dto.offerType }, req);
    return saved;
  }

  async update(id: number, dto: any, req?: any) {
    const offer = await this.repo.findOne({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found.');
    this.validate({ ...offer, ...dto });
    const before = { ...offer };
    Object.assign(offer, dto);
    const saved = await this.repo.save(offer);
    await this.audit.logUpdate('offers', id, before, dto, req,
      ['title', 'offerType', 'rewardValue', 'minOrder', 'startsAt', 'endsAt', 'isActive']);
    return saved;
  }

  async remove(id: number, req?: any) {
    const offer = await this.repo.findOne({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found.');
    const [{ n }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM offer_redemptions WHERE offer_id = $1`, [id]);
    if (Number(n) > 0) {
      /* Redemptions are financial history. Deleting the offer would orphan
         them and make past discounts unexplainable in reports. */
      throw new BadRequestException(
        `"${offer.title}" has been used ${n} time(s), so it can't be deleted — ` +
        `that history is needed for reporting. Switch it off instead.`);
    }
    await this.repo.remove(offer);
    await this.audit.log('offer.delete', 'offers', id, { title: offer.title }, req);
    return { deleted: true, id };
  }

  /** Catch the misconfigurations that would silently do nothing. */
  private validate(dto: any) {
    if (new Date(dto.endsAt) <= new Date(dto.startsAt)) {
      throw new BadRequestException('The offer must end after it starts.');
    }
    if (dto.offerType === 'free_item' && !dto.freeProductId) {
      throw new BadRequestException('Pick the dish customers get free.');
    }
    if (dto.offerType === 'percentage' && (dto.rewardValue <= 0 || dto.rewardValue > 100)) {
      throw new BadRequestException('A percentage offer must be between 1 and 100.');
    }
    if (dto.offerType === 'flat' && dto.rewardValue <= 0) {
      throw new BadRequestException('A flat offer needs an amount greater than zero.');
    }
  }
}
