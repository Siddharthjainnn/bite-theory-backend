import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Banner } from './banner.entity';
import { CreateBannerDto } from './create-banner.dto';
import { UpdateBannerDto } from './update-banner.dto';

@Injectable()
export class BannerService {
  constructor(
    @InjectRepository(Banner)
    private readonly repo: Repository<Banner>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Banner not found');
    return item;
  }

  create(dto: CreateBannerDto) {
    const item = this.repo.create(dto as Partial<Banner>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateBannerDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Banner>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
