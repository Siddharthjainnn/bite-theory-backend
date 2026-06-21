import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderItem } from './order-item.entity';
import { CreateOrderItemDto, UpdateOrderItemDto } from './dto';

@Injectable()
export class OrderItemsService {
  constructor(@InjectRepository(OrderItem) private repo: Repository<OrderItem>) {}

  findAll(orderId?: number) {
    if (orderId) return this.repo.find({ where: { orderId } });
    return this.repo.find({ order: { id: 'DESC' } });
  }
  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Order item ${id} not found`);
    return item;
  }
  create(dto: CreateOrderItemDto) { return this.repo.save(this.repo.create(dto)); }
  async update(id: number, dto: UpdateOrderItemDto) {
    const item = await this.findOne(id);
    Object.assign(item, dto);
    return this.repo.save(item);
  }
  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}