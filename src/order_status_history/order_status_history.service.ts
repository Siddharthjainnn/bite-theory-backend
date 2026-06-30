import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderStatusHistory } from './order-status-history.entity';
import { CreateOrderStatusHistoryDto } from './create-order-status-history.dto';
import { UpdateOrderStatusHistoryDto } from './update-order-status-history.dto';

@Injectable()
export class OrderStatusHistoryService {
  constructor(
    @InjectRepository(OrderStatusHistory)
    private readonly repo: Repository<OrderStatusHistory>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('OrderStatusHistory not found');
    return item;
  }

  create(dto: CreateOrderStatusHistoryDto) {
    const item = this.repo.create(dto as Partial<OrderStatusHistory>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateOrderStatusHistoryDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<OrderStatusHistory>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
