import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';
import { CreateAuditLogDto } from './create-audit-log.dto';
import { UpdateAuditLogDto } from './update-audit-log.dto';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('AuditLog not found');
    return item;
  }

  create(dto: CreateAuditLogDto) {
    const item = this.repo.create(dto as Partial<AuditLog>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateAuditLogDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<AuditLog>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
