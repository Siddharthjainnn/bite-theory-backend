import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeliveryPartner } from './delivery-partner.entity';
import { CreateDeliveryPartnerDto } from './create-delivery-partner.dto';
import { UpdateDeliveryPartnerDto } from './update-delivery-partner.dto';

@Injectable()
export class DeliveryPartnerService {
  constructor(
    @InjectRepository(DeliveryPartner)
    private readonly repo: Repository<DeliveryPartner>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('DeliveryPartner not found');
    return item;
  }

  create(dto: CreateDeliveryPartnerDto) {
    const item = this.repo.create(dto as Partial<DeliveryPartner>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateDeliveryPartnerDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<DeliveryPartner>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
