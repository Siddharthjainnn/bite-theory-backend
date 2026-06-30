import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'inventory' })
export class Inventory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint', name: 'product_id', nullable: true })
  productId: number;

  @Column({ type: 'integer', name: 'quantity', nullable: true })
  quantity: number;

  @Column({ type: 'integer', name: 'low_threshold', nullable: true })
  lowThreshold: number;

  @Column({ type: 'varchar', name: 'stock_status', nullable: true })
  stockStatus: string;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;

}
