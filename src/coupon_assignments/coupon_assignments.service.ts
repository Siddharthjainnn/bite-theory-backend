import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CouponAssignment } from './coupon-assignment.entity';
import { Coupon } from '../coupons/coupon.entity';
import { CreateCouponAssignmentDto } from './dto';

@Injectable()
export class CouponAssignmentsService {
  constructor(
    @InjectRepository(CouponAssignment)
    private readonly repo: Repository<CouponAssignment>,
    @InjectRepository(Coupon)
    private readonly couponRepo: Repository<Coupon>,
  ) {}

  /** Admin list — newest first, joined with code + user email for the panel. */
  async findAll(filters: { userId?: number } = {}) {
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoin('coupons', 'c', 'c.id = a.coupon_id')
      .leftJoin('users', 'u', 'u.id = a.user_id')
      .select([
        'a.id AS id',
        'a.coupon_id AS "couponId"',
        'a.user_id AS "userId"',
        'a.note AS note',
        'a.is_used AS "isUsed"',
        'a.order_id AS "orderId"',
        'a.created_at AS "createdAt"',
        'a.used_at AS "usedAt"',
        'c.code AS "couponCode"',
        'u.email AS "userEmail"',
        `TRIM(CONCAT(COALESCE(u.first_name,''),' ',COALESCE(u.last_name,''))) AS "userName"`,
      ])
      .orderBy('a.id', 'DESC');
    if (filters.userId) qb.where('a.user_id = :uid', { uid: filters.userId });
    return qb.getRawMany();
  }

  /** Coupons this user has been gifted and hasn't spent yet (customer view). */
  async activeForUser(userId: number) {
    return this.repo
      .createQueryBuilder('a')
      .innerJoin('coupons', 'c', 'c.id = a.coupon_id')
      .select([
        'a.id AS id',
        'a.coupon_id AS "couponId"',
        'a.note AS note',
        'c.code AS "code"',
        'c.description AS "description"',
        'c.discount_type AS "discountType"',
        'c.discount_value AS "discountValue"',
        'c.min_order AS "minOrder"',
        'c.max_discount AS "maxDiscount"',
        'c.valid_until AS "validUntil"',
      ])
      .where('a.user_id = :uid AND a.is_used = false', { uid: userId })
      .andWhere('(c.is_active IS NULL OR c.is_active = true)')
      .andWhere('(c.valid_until IS NULL OR c.valid_until >= now())')
      .orderBy('a.id', 'DESC')
      .getRawMany();
  }

  /** Is there a live (unused) assignment of this coupon for this user? */
  async hasActiveAssignment(couponId: number, userId: number): Promise<boolean> {
    const n = await this.repo.count({
      where: { couponId, userId, isUsed: false },
    });
    return n > 0;
  }

  async create(dto: CreateCouponAssignmentDto) {
    const coupon = await this.couponRepo.findOne({ where: { id: dto.couponId } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    const existing = await this.repo.findOne({
      where: { couponId: dto.couponId, userId: dto.userId },
    });
    if (existing) {
      if (!existing.isUsed) {
        throw new BadRequestException('This user already has this coupon assigned.');
      }
      // re-gift a used one: reset it
      existing.isUsed = false;
      existing.orderId = null;
      existing.usedAt = null;
      existing.note = dto.note ?? existing.note;
      return this.repo.save(existing);
    }
    const row = this.repo.create({
      couponId: dto.couponId,
      userId: dto.userId,
      note: dto.note ?? null,
    });
    return this.repo.save(row);
  }

  async remove(id: number) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Assignment not found');
    await this.repo.remove(row);
    return { deleted: true, id };
  }
}
