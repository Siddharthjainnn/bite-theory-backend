import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
    const existing = await this.findOne(id);
    // making this one default → clear the flag on the user's other addresses
    if (dto.isDefault && existing.userId) {
      await this.repo.update({ userId: existing.userId } as any, { isDefault: false });
    }
    await this.repo.update(id, dto as Partial<Address>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    /* Bug #14 — "Delete" on a saved address silently failed whenever any order
       ever referenced it: orders.address_id holds the id, so on databases with
       the FK in place the DELETE raised a foreign-key violation → 500 → the UI
       showed a generic "Could not delete address" and the row stayed.
       Orders snapshot the full address TEXT (delivery_address) at checkout, so
       the address row itself is not needed for history — detach, then delete. */
    try {
      await this.repo.manager.query(
        `UPDATE orders SET address_id = NULL WHERE address_id = $1`, [id]);
    } catch { /* orders table may not have the column in some envs — ignore */ }
    try {
      await this.repo.remove(item);
    } catch {
      throw new BadRequestException(
        'This address could not be deleted because other records still reference it.');
    }
    return { deleted: true, id };
  }
}
