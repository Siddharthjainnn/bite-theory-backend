import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Address } from './address.entity';
import { CreateAddressDto } from './create-address.dto';
import { UpdateAddressDto } from './update-address.dto';

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(Address)
    private readonly repo: Repository<Address>,
  ) {}

  findAll(userId?: number) {
    return this.repo.find({
      where: userId ? { userId } : {},
      order: { isDefault: 'DESC', id: 'DESC' },
    });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Address not found');
    return item;
  }

  async create(dto: CreateAddressDto) {
    // first address, or explicitly flagged, becomes default
    if (dto.userId) {
      const count = await this.repo.count({ where: { userId: dto.userId } });
      if (count === 0) dto.isDefault = true;
      else if (dto.isDefault) {
        await this.repo.update({ userId: dto.userId }, { isDefault: false });
      }
    }
    const item = this.repo.create(dto as Partial<Address>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateAddressDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<Address>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
