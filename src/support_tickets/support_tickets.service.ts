import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';
import { CreateSupportTicketDto } from './create-support-ticket.dto';
import { UpdateSupportTicketDto } from './update-support-ticket.dto';

@Injectable()
export class SupportTicketService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly repo: Repository<SupportTicket>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('SupportTicket not found');
    return item;
  }

  create(dto: CreateSupportTicketDto) {
    const item = this.repo.create(dto as Partial<SupportTicket>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateSupportTicketDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<SupportTicket>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
