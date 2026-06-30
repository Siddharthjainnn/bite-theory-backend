import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'coupons' })
export class Coupon {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', name: 'code', nullable: true })
  code: string;

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string;

  @Column({ type: 'varchar', name: 'discount_type', nullable: true })
  discountType: string;

  @Column({ type: 'numeric', name: 'discount_value', nullable: true })
  discountValue: number;

  @Column({ type: 'numeric', name: 'min_order', nullable: true })
  minOrder: number;

  @Column({ type: 'numeric', name: 'max_discount', nullable: true })
  maxDiscount: number;

  @Column({ type: 'integer', name: 'usage_limit', nullable: true })
  usageLimit: number;

  @Column({ type: 'integer', name: 'used_count', nullable: true })
  usedCount: number;

  @Column({ type: 'timestamptz', name: 'valid_from', nullable: true })
  validFrom: Date;

  @Column({ type: 'timestamptz', name: 'valid_until', nullable: true })
  validUntil: Date;

  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}
