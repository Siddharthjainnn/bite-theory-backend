import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'loyalty_points' })
export class LoyaltyPoint {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number;

  @Column({ type: 'integer', name: 'points', nullable: true })
  points: number;

  @Column({ type: 'varchar', name: 'type', nullable: true })
  type: string;

  @Column({ type: 'varchar', name: 'reason', nullable: true })
  reason: string;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId: number;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}
