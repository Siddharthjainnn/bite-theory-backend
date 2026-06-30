import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Referral } from './referral.entity';
import { CreateReferralDto } from './create-referral.dto';
import { UpdateReferralDto } from './update-referral.dto';

@Injectable()
export class ReferralService {
  constructor(
    @InjectRepository(Referral)
    private readonly repo: Repository<Referral>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
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
