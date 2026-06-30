import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WalletTransaction } from './wallet-transaction.entity';
import { CreateWalletTransactionDto } from './create-wallet-transaction.dto';
import { UpdateWalletTransactionDto } from './update-wallet-transaction.dto';

@Injectable()
export class WalletTransactionService {
  constructor(
    @InjectRepository(WalletTransaction)
    private readonly repo: Repository<WalletTransaction>,
  ) {}

  findAll() {
    return this.repo.find({ order: { id: 'DESC' } });
  }

  async findOne(id: number) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('WalletTransaction not found');
    return item;
  }

  create(dto: CreateWalletTransactionDto) {
    const item = this.repo.create(dto as Partial<WalletTransaction>);
    return this.repo.save(item);
  }

  async update(id: number, dto: UpdateWalletTransactionDto) {
    await this.findOne(id);
    await this.repo.update(id, dto as Partial<WalletTransaction>);
    return this.findOne(id);
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    await this.repo.remove(item);
    return { deleted: true, id };
  }
}
