import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'offers' })
export class Offer {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar' }) title: string;
  @Column({ type: 'varchar', nullable: true }) subtitle: string;

  /** 'flat' | 'percentage' | 'free_item' | 'free_delivery' */
  @Column({ type: 'varchar', name: 'offer_type' }) offerType: string;

  @Column({ type: 'numeric', name: 'reward_value', default: 0 }) rewardValue: number;
  @Column({ type: 'numeric', name: 'max_discount', nullable: true }) maxDiscount: number;
  @Column({ type: 'bigint', name: 'free_product_id', nullable: true }) freeProductId: number;

  @Column({ type: 'numeric', name: 'min_order', default: 0 }) minOrder: number;

  @Column({ type: 'timestamptz', name: 'starts_at' }) startsAt: Date;
  @Column({ type: 'timestamptz', name: 'ends_at' }) endsAt: Date;

  @Column({ type: 'int', name: 'usage_limit', nullable: true }) usageLimit: number;
  @Column({ type: 'int', name: 'used_count', default: 0 }) usedCount: number;
  @Column({ type: 'int', name: 'per_user_limit', default: 1 }) perUserLimit: number;

  @Column({ type: 'varchar', name: 'image_url', nullable: true }) imageUrl: string;
  @Column({ type: 'varchar', nullable: true }) badge: string;
  @Column({ type: 'varchar', nullable: true }) accent: string;
  @Column({ type: 'int', name: 'sort_order', default: 0 }) sortOrder: number;

  @Column({ type: 'boolean', name: 'is_active', default: true }) isActive: boolean;
}
