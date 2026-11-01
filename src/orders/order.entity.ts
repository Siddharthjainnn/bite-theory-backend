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

  /* GST snapshot — recorded per order at checkout so a reprint always shows
     what was actually charged, even if the rate changes later. */
  @Column({ type: 'numeric', name: 'tax_rate', default: 0 }) taxRate!: number;
  @Column({ type: 'numeric', default: 0 }) cgst!: number;
  @Column({ type: 'numeric', default: 0 }) sgst!: number;

  /** Sequential legal invoice number, e.g. BT/2026-27/0001. Null until GST is on. */
  @Column({ type: 'varchar', name: 'invoice_no', nullable: true }) invoiceNo!: string | null;
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

  /* External courier (migrations/2026-10-23-external-courier.sql).
     delivery_provider = who carries the food: our rider, or a booked Porter. */
  @Column({ name: 'delivery_provider', type: 'varchar', length: 20, default: 'in_house' }) deliveryProvider!: string;
  @Column({ name: 'external_ref', type: 'varchar', length: 80, nullable: true }) externalRef!: string | null;
  @Column({ name: 'external_tracking_url', type: 'text', nullable: true }) externalTrackingUrl!: string | null;
  @Column({ name: 'external_rider_name', type: 'varchar', length: 80, nullable: true }) externalRiderName!: string | null;
  @Column({ name: 'external_rider_phone', type: 'varchar', length: 20, nullable: true }) externalRiderPhone!: string | null;
  @Column({ name: 'external_fee', type: 'numeric', precision: 10, scale: 2, nullable: true }) externalFee!: number | null;
  @Column({ name: 'external_booked_at', type: 'timestamptz', nullable: true }) externalBookedAt!: Date | null;

  /* Delivery system (migrations/2026-10-24-delivery-trips-eta.sql).
     promised_at = the high end of the range shown at checkout: what we promise. */
  @Column({ name: 'promised_at', type: 'timestamptz', nullable: true }) promisedAt!: Date | null;
  @Column({ name: 'promised_min', type: 'integer', nullable: true }) promisedMin!: number | null;
  @Column({ name: 'promised_max', type: 'integer', nullable: true }) promisedMax!: number | null;
  @Column({ name: 'ready_at', type: 'timestamptz', nullable: true }) readyAt!: Date | null;
  @Column({ name: 'trip_id', type: 'bigint', nullable: true }) tripId!: number | null;
  @Column({ name: 'delay_notified_at', type: 'timestamptz', nullable: true }) delayNotifiedAt!: Date | null;
  @Column({ name: 'late_makegood_at', type: 'timestamptz', nullable: true }) lateMakegoodAt!: Date | null;
  @Column({ name: 'prep_estimate_min', type: 'integer', nullable: true }) prepEstimateMin!: number | null;
  /* takeaway: 'pickup' orders are collected at pickup_outlet_id — no rider */
  @Column({ name: 'fulfillment', type: 'varchar', length: 10, default: 'delivery' }) fulfillment!: 'delivery' | 'pickup';
  @Column({ name: 'pickup_outlet_id', type: 'integer', nullable: true }) pickupOutletId!: number | null;
}
