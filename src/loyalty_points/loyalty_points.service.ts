import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LoyaltyPoint } from './loyalty-point.entity';
import { CreateLoyaltyPointDto } from './create-loyalty-point.dto';
import { UpdateLoyaltyPointDto } from './update-loyalty-point.dto';

@Injectable()
export class LoyaltyPointService {
  constructor(
    @InjectRepository(LoyaltyPoint)
    private readonly repo: Repository<LoyaltyPoint>,
  ) {}

  findAll(userId?: number) {
    return this.repo.find({
      where: userId ? ({ userId } as any) : {},
      order: { id: 'DESC' },
    });
  }

  /** Live points balance + tier for a user, computed from the users table. */
  async summary(userId: number) {
    const rows = await this.repo.query(
      `SELECT COALESCE(loyalty_points, 0) AS points,
              COALESCE(loyalty_level, 'bronze') AS tier
         FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const points = Number(rows?.[0]?.points ?? 0);
    const tier = (rows?.[0]?.tier ?? 'bronze') as string;

    // Tier thresholds (lifetime points): bronze 0 · silver 200 · gold 500 · platinum 1000
    const ladder: [string, number][] = [
      ['bronze', 0], ['silver', 200], ['gold', 500], ['platinum', 1000],
    ];
    const idx = ladder.findIndex(([t]) => t === tier);
    const next = ladder[idx + 1] || null;
    return {
      points,
      tier,
      nextTier: next ? next[0] : null,
      pointsToNext: next ? Math.max(0, next[1] - points) : 0,
    };
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('LoyaltyPoint not found');
    return item;
  }

  create(dto: CreateLoyaltyPointDto) {
    const item = this.repo.create(dto as Partial<LoyaltyPoint>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateLoyaltyPointDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<LoyaltyPoint>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
