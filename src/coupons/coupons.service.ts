import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
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

  create(dto: CreateCouponDto) {
    const item = this.repo.create(dto as Partial<Coupon>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateCouponDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Coupon>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
