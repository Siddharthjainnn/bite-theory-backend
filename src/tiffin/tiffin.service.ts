import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { TiffinLead } from './tiffin-lead.entity';
import { CreateTiffinLeadDto } from './create-tiffin-lead.dto';
import { UpdateTiffinLeadDto } from './update-tiffin-lead.dto';

@Injectable()
export class TiffinService {
  constructor(
    @InjectRepository(TiffinLead)
    private readonly repo: Repository<TiffinLead>,
  ) {}

  /** Admin list, newest first, optionally filtered by pipeline status. */
  findAll(status?: string) {
    const where = status && status !== 'all' ? ({ status } as any) : {};
    return this.repo.find({ where, order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Tiffin lead not found');
    return item;
  }

  /** Counts for the admin dashboard badge. */
  async stats() {
    const rows = await this.repo
      .createQueryBuilder('l')
      .select('l.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.status')
      .getRawMany<{ status: string; count: string }>();

    const out = { new: 0, contacted: 0, converted: 0, rejected: 0, total: 0 };
    for (const r of rows) {
      const n = Number(r.count) || 0;
      if (r.status in out) (out as any)[r.status] = n;
      out.total += n;
    }
    return out;
  }

  async create(dto: CreateTiffinLeadDto, userId?: number) {
    /* Ad traffic means bots and double-taps. If the same number submitted in
       the last 10 minutes, return the existing lead instead of creating a
       duplicate the team would have to call twice. */
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recent = await this.repo.findOne({
      where: { phone: dto.phone, createdAt: MoreThan(tenMinAgo) } as any,
      order: { id: 'DESC' },
    });
    if (recent) return recent;

    const enabled = (dto.schedule || []).filter((d) => d.enabled);
    if (!enabled.length) {
      throw new BadRequestException('Pick at least one delivery day.');
    }
    const missing = enabled.find((d) => !d.address || !d.address.trim());
    if (missing) {
      throw new BadRequestException(
        `Add a delivery address for ${missing.day.toUpperCase()}.`,
      );
    }

    const item = this.repo.create({
      ...dto,
      userId: userId ?? null,
      status: 'new',
      createdAt: new Date(),
    } as Partial<TiffinLead>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateTiffinLeadDto) {
    await this.findOne(id);
    await this.repo.update(id, { ...dto, updatedAt: new Date() } as Partial<TiffinLead>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.delete(id);
    return item;
  }
}
