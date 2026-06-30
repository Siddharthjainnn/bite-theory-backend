import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'wallet_transactions' })
export class WalletTransaction {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'varchar', name: 'type', nullable: true })
  type: string;

  @Column({ type: 'numeric', name: 'amount', nullable: true })
  amount: number;

  @Column({ type: 'varchar', name: 'reason', nullable: true })
  reason: string;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}
