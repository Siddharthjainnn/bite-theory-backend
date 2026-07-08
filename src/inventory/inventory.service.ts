import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Inventory } from './inventory.entity';
import { CreateInventoryDto } from './create-inventory.dto';
import { UpdateInventoryDto } from './update-inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly repo: Repository<Inventory>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Inventory not found');
    return item;
  }

  create(dto: CreateInventoryDto) {
    const item = this.repo.create(dto as Partial<Inventory>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateInventoryDto) {
    const before = await this.findOne(id);
    await this.repo.update(id, dto as Partial<Inventory>);
    const after = await this.findOne(id);

    /* Restock re-activation (audit §6.1): checkout flips a product to
       'inactive' when stock hits 0, but nothing ever flipped it back.
       When quantity goes 0 → >0, bring the product back on the storefront
       and refresh its stock_status. */
    if (after.productId != null && Number(after.quantity) > 0) {
      const low = Number(after.lowThreshold ?? 0);
      const stockStatus = Number(after.quantity) <= low ? 'low' : 'in_stock';
      await this.repo.manager.query(
        `UPDATE products SET status = 'active', updated_at = now()
          WHERE id = $1 AND status = 'inactive'`, [after.productId]);
      await this.repo.update(id, { stockStatus } as Partial<Inventory>);
      after.stockStatus = stockStatus;
    } else if (after.productId != null && Number(after.quantity) === 0
               && Number(before.quantity) > 0) {
      await this.repo.update(id, { stockStatus: 'out_of_stock' } as Partial<Inventory>);
      after.stockStatus = 'out_of_stock';
    }
    return after;
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
