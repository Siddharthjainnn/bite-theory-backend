import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Referral } from './referral.entity';
import { CreateReferralDto } from './create-referral.dto';
import { UpdateReferralDto } from './update-referral.dto';

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(Referral)
    private readonly repo: Repository<Referral>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  findAll(referrerId?: number) {
    return this.repo.find({
      where: referrerId ? { referrerId } : {},
      order: { id: 'DESC' },
    });
  }

  /**
   * New user redeems a friend's code. Creates the pending referral row that
   * checkout converts (and pays out) on their first order.
   */
  async claim(userId: number, code: string) {
    if (!userId || !code.trim()) throw new BadRequestException('Referral code required');
    const owner = await this.dataSource.query(
      `SELECT id, referral_code FROM users WHERE UPPER(referral_code) = UPPER($1) LIMIT 1`,
      [code.trim()]);
    if (!owner.length) throw new BadRequestException('Invalid referral code');
    const referrerId = Number(owner[0].id);
    if (referrerId === Number(userId)) throw new BadRequestException("You can't use your own code");

    const existing = await this.repo.findOne({ where: { referredUserId: userId } });
    if (existing) throw new BadRequestException('You have already used a referral code');

    const orders = await this.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`, [userId]);
    if (Number(orders[0].n) > 0) throw new BadRequestException('Referral codes only work before your first order');

    const row = this.repo.create({
      referrerId,
      referredUserId: userId,
      referralCode: owner[0].referral_code,
      isConverted: false,
      rewarded: false,
    });
    const saved = await this.repo.save(row);
    return { ok: true, id: saved.id, message: 'Code applied! Your friend earns ₹50 when you place your first order.' };
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Referral not found');
    return item;
  }

  create(dto: CreateReferralDto) {
    const item = this.repo.create(dto as Partial<Referral>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateReferralDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Referral>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
