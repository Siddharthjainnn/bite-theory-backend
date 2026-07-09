import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coupon } from './coupon.entity';
import { CreateCouponDto } from './create-coupon.dto';
import { UpdateCouponDto } from './update-coupon.dto';
import { computeCouponDiscount } from './coupon.util';

@Injectable()
export class CouponService {
  constructor(
    @InjectRepository(Coupon)
    private readonly repo: Repository<Coupon>,
  ) {}

  /**
   * Bug #45: was order:{id:'DESC'} → admin list showed newest first and the
   * displayed "ID count" looked non-sequential. Ascending id gives a stable,
   * incrementing sequence.
   */
  findAll() {
    return this.repo.find({ order: { id: 'ASC' } });
  }

  /** Validate a coupon code for a given subtotal (no usage bump here). */
  async validate(code: string, subtotal: number, userId?: number) {
    const coupon = await this.repo
      .createQueryBuilder('c')
      .where('UPPER(c.code) = UPPER(:code)', { code: (code || '').trim() })
      .getOne();
    let usedByUser = 0;
    if (coupon && userId) {
      const r = await this.repo.query(
        `SELECT COUNT(*)::int AS n FROM coupon_redemptions
          WHERE coupon_id = $1 AND user_id = $2`, [coupon.id, userId]);
      usedByUser = Number(r[0]?.n || 0);
    }
    const result = computeCouponDiscount(coupon as any, Number(subtotal) || 0, usedByUser);
    return { ...result, couponId: result.valid && coupon ? Number(coupon.id) : null };
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Coupon not found');
    return item;
  }

  /**
   * Bug #46 (root cause): normalize + sanity-check at creation so an admin can
   * never save a coupon the customer then can't apply.
   *  - code upper-cased & trimmed (validate() compares UPPER-to-UPPER anyway,
   *    but storing it clean avoids surprises in the admin list)
   *  - percentage discounts capped at 100 (a 150%-off coupon is nonsense)
   *  - isActive defaults to true when omitted (a null is treated as active by
   *    computeCouponDiscount, but making it explicit avoids ambiguity)
   *  - reject validUntil <= validFrom
   */
  private normalize<T extends Partial<Coupon> & { discountType?: string; discountValue?: number }>(dto: T): T {
    if (dto.code) dto.code = String(dto.code).trim().toUpperCase();
    const type = (dto.discountType || 'percentage').toLowerCase();
    if (type === 'percentage' && dto.discountValue != null && dto.discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }
    if (dto.validFrom && dto.validUntil && new Date(dto.validUntil) <= new Date(dto.validFrom)) {
      throw new BadRequestException('validUntil must be after validFrom');
    }
    if ((dto as any).isActive == null) (dto as any).isActive = true;
    return dto;
  }

  create(dto: CreateCouponDto) {
    const clean = this.normalize(dto as any);
    const item = this.repo.create(clean as Partial<Coupon>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateCouponDto) {
    await this.findOne(id);
    const clean = this.normalize(dto as any);
    await this.repo.update(id, clean as Partial<Coupon>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
