import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('order_status_history')
export class OrderStatusHistory {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column({ name: 'order_id', type: 'bigint' }) orderId!: number;
  @Column({ type: 'varchar' }) status!: string;
  @Column({ type: 'text', nullable: true }) note!: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt!: Date;
}