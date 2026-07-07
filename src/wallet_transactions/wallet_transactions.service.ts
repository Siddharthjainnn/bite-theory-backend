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

  /** List transactions, newest first. ?userId= scopes to one customer. */
  findAll(userId?: number) {
    return this.repo.find({
      where: userId ? ({ userId } as any) : {},
      order: { id: 'DESC' },
      take: 200,
    });
  }

  /** Wallet header numbers: live balance + lifetime credited/debited. */
  async summary(userId: number) {
    const [u] = await this.repo.query(
      `SELECT wallet_balance AS balance FROM users WHERE id = $1`, [userId]);
    const [agg] = await this.repo.query(
      `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount END), 0) AS credited,
              COALESCE(SUM(CASE WHEN type = 'debit'  THEN amount END), 0) AS debited
         FROM wallet_transactions WHERE user_id = $1`, [userId]);
    return {
      balance: Number(u?.balance || 0),
      totalCredited: Number(agg?.credited || 0),
      totalDebited: Number(agg?.debited || 0),
    };
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
