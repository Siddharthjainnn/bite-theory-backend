import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { CreatePaymentDto } from './create-payment.dto';
import { UpdatePaymentDto } from './update-payment.dto';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Payment not found');
    return item;
  }

  create(dto: CreatePaymentDto) {
    const item = this.repo.create(dto as Partial<Payment>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdatePaymentDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Payment>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
