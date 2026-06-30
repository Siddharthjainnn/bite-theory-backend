import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './permission.entity';
import { CreatePermissionDto } from './create-permission.dto';
import { UpdatePermissionDto } from './update-permission.dto';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly repo: Repository<Permission>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Permission not found');
    return item;
  }

  create(dto: CreatePermissionDto) {
    const item = this.repo.create(dto as Partial<Permission>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdatePermissionDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Permission>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
