import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { CreateNotificationDto } from './create-notification.dto';
import { UpdateNotificationDto } from './update-notification.dto';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
  ) {}

  findAll(userId?: number) {
    return this.repo.find({
      where: userId ? { userId } : {},
      order: { id: 'DESC' },
      take: 30,
    });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Notification not found');
    return item;
  }

  create(dto: CreateNotificationDto) {
    const item = this.repo.create(dto as Partial<Notification>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateNotificationDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Notification>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
