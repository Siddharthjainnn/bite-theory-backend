import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './order.entity';
import { OrderStatusHistory } from './order-status-history.entity';
import { CreateOrderDto, UpdateOrderDto, UpdateOrderStatusDto } from './dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private repo: Repository<Order>,
    @InjectRepository(OrderStatusHistory) private historyRepo: Repository<OrderStatusHistory>,
  ) {}

  findAll() { return this.repo.find({ order: { placedAt: 'DESC' } }); }

  async findOne(id: number) {
    const order = await this.repo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  async create(dto: CreateOrderDto) {
    const order = this.repo.create({ ...dto, status: 'order_received' });
    const saved = await this.repo.save(order);
    await this.historyRepo.save(this.historyRepo.create({ orderId: saved.id, status: 'order_received', note: 'Order placed' }));
    return saved;
  }

  async update(id: number, dto: UpdateOrderDto) {
    const order = await this.findOne(id);
    Object.assign(order, dto);
    return this.repo.save(order);
  }

  // The core mechanic: advance status + log to history in one call
  async updateStatus(id: number, dto: UpdateOrderStatusDto) {
    const order = await this.findOne(id);
    order.status = dto.status;
    const saved = await this.repo.save(order);
    //await this.historyRepo.save(this.historyRepo.create({ orderId: id, status: dto.status, note: dto.note || null }));
    await this.historyRepo.save(this.historyRepo.create({ orderId: id, status: dto.status, note: dto.note }));
    return saved;
  }

  getHistory(orderId: number) {
    return this.historyRepo.find({ where: { orderId }, order: { createdAt: 'ASC' } });
  }

  async remove(id: number) {
    const order = await this.findOne(id);
    await this.repo.remove(order);
    return { deleted: true, id };
  }
}