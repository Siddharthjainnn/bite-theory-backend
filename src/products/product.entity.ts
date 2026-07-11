import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'category_id', type: 'bigint' })
  categoryId: number;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  image: string;

  @Column({ name: 'video_url', type: 'text', nullable: true })
  videoUrl: string;

  @Column({ type: 'numeric' })
  price: number;

  @Column({ name: 'offer_price', type: 'numeric', nullable: true })
  offerPrice: number;

  @Column({ type: 'integer', nullable: true })
  calories: number;

  @Column({ type: 'numeric', nullable: true })
  protein: number;

  @Column({ type: 'numeric', nullable: true })
  carbs: number;

  @Column({ type: 'numeric', nullable: true })
  fat: number;

  @Column({ type: 'numeric', default: 0 })
  rating: number;

  // your enum product_status has values: 'active' | 'inactive'
  @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'boolean', name: 'is_todays_special', default: false, nullable: true })
  isTodaysSpecial: boolean;

  @Column({ type: 'boolean', name: 'is_veg', default: true, nullable: true })
  isVeg: boolean;

  @Column({ type: 'varchar', name: 'special_tag', length: 50, nullable: true })
  specialTag: string;

  // Spin the Thali: admin-curated wheel pool (false = not in the wheel)
  @Column({ type: 'boolean', name: 'is_spin_wheel', default: false, nullable: true })
  isSpinWheel: boolean;
}
