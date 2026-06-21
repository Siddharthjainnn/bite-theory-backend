import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column({ name: 'order_id', type: 'bigint' }) orderId!: number;
  @Column({ name: 'product_id', type: 'bigint', nullable: true }) productId!: number;
  @Column({ name: 'product_name', type: 'varchar' }) productName!: string;
  @Column({ name: 'unit_price', type: 'numeric' }) unitPrice!: number;
  @Column({ type: 'integer' }) quantity!: number;
  @Column({ name: 'line_total', type: 'numeric' }) lineTotal!: number;
}