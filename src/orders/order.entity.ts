import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column({ name: 'order_number', type: 'varchar' }) orderNumber!: string;
  @Column({ name: 'user_id', type: 'bigint' }) userId!: number;
  @Column({ name: 'address_id', type: 'bigint', nullable: true }) addressId!: number;
  @Column({ name: 'coupon_id', type: 'bigint', nullable: true }) couponId!: number;
  @Column({ type: 'numeric' }) subtotal!: number;
  @Column({ type: 'numeric', default: 0 }) discount!: number;
  @Column({ name: 'delivery_charge', type: 'numeric', default: 0 }) deliveryCharge!: number;
  @Column({ type: 'numeric', default: 0 }) tax!: number;
  @Column({ name: 'wallet_used', type: 'numeric', default: 0 }) walletUsed!: number;
  @Column({ type: 'numeric' }) total!: number;
  @Column({ type: 'varchar', default: 'order_received' }) status!: string; // real type: order_status enum
  @Column({ name: 'delivery_slot', type: 'varchar', nullable: true }) deliverySlot!: string;
  @Column({ name: 'delivery_partner_id', type: 'bigint', nullable: true }) deliveryPartnerId!: number;
  @CreateDateColumn({ name: 'placed_at' }) placedAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;
}