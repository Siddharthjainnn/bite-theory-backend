import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

/**
 * An admin gift of a specific coupon to a specific user.
 * When that user checks out with the coupon, an unused assignment lets them
 * redeem it even if the coupon's global usage_limit / per_user_limit is hit.
 */
@Entity({ name: 'coupon_assignments' })
export class CouponAssignment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'coupon_id', type: 'bigint' })
  couponId: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;

  @Column({ name: 'order_id', type: 'bigint', nullable: true })
  orderId: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt: Date | null;
}
