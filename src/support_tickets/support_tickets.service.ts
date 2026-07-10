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

  /* #27: admin gets ALL tickets; #53: a user gets only their own when a
     userId is supplied. */
  findAll(userId?: number) {
    if (userId) {
      return this.repo.find({ where: { userId } as any, order: { id: 'DESC' } });
    }
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('SupportTicket not found');
    return item;
  }

  create(dto: CreateSupportTicketDto) {
    /* #53: a freshly raised ticket is 'open' by default so it surfaces to
       admin immediately. */
    const item = this.repo.create({ ...dto, status: dto.status || 'open' } as Partial<SupportTicket>);
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
