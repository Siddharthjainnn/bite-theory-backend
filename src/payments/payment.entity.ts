import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'varchar', name: 'method', nullable: true })
  method: string;

  @Column({ type: 'numeric', name: 'amount', nullable: true })
  amount: number;

  @Column({ type: 'varchar', name: 'status', nullable: true })
  status: string;

  @Column({ type: 'varchar', name: 'transaction_id', nullable: true })
  transactionId: string;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}
