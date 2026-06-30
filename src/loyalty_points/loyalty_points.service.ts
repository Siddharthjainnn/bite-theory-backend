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

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
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
