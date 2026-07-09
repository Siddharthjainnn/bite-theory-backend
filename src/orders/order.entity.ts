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
  @Column({ type: 'varchar', default: 'order_received' }) status!: string;
  @Column({ name: 'delivery_slot', type: 'varchar', nullable: true }) deliverySlot!: string;
  @Column({ name: 'delivery_partner_id', type: 'bigint', nullable: true }) deliveryPartnerId!: number;
  @CreateDateColumn({ name: 'placed_at' }) placedAt!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt!: Date;

  /* location + lifecycle (Swiggy-style tracking) */
  @Column({ name: 'delivery_lat', type: 'numeric', precision: 10, scale: 7, nullable: true }) deliveryLat!: number;
  @Column({ name: 'delivery_lng', type: 'numeric', precision: 10, scale: 7, nullable: true }) deliveryLng!: number;
  @Column({ name: 'delivery_address', type: 'text', nullable: true }) deliveryAddress!: string;
  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true }) acceptedAt!: Date;
  @Column({ name: 'picked_up_at', type: 'timestamptz', nullable: true }) pickedUpAt!: Date;
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true }) deliveredAt!: Date;
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true }) cancelledAt!: Date;
  @Column({ name: 'eta_minutes', type: 'integer', nullable: true }) etaMinutes!: number;
  @Column({ name: 'distance_km', type: 'numeric', nullable: true }) distanceKm!: number | null;
  @Column({ name: 'delivery_otp', type: 'varchar', length: 4, nullable: true }) deliveryOtp!: string | null;

  /* UX extras */
  @Column({ type: 'numeric', default: 0, nullable: true }) tip!: number;
  @Column({ name: 'delivery_instructions', type: 'text', nullable: true }) deliveryInstructions!: string;
  @Column({ name: 'cooking_note', type: 'text', nullable: true }) cookingNote!: string;

  /* Signature feature: short "your food being made" clip the admin attaches
     to this order. Shown to the customer on the tracking page. */
  @Column({ name: 'prep_video_url', type: 'text', nullable: true }) prepVideoUrl!: string | null;
}
