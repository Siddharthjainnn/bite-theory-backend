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

  @Column({ type: 'integer', name: 'per_user_limit', nullable: true })
  perUserLimit: number;

  @Column({ type: 'timestamptz', name: 'valid_from', nullable: true })
  validFrom: Date;

  @Column({ type: 'timestamptz', name: 'valid_until', nullable: true })
  validUntil: Date;

  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

  /* Bug #69 — the storefront used to auto-promote whichever active coupon came
     first, so codes appeared on the cart with zero admin intent (and swapped
     to the next one when deactivated). Only coupons the admin explicitly
     flags as featured are advertised now. */
  @Column({ type: 'boolean', name: 'is_featured', nullable: true, default: false })
  isFeatured: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date;

}
