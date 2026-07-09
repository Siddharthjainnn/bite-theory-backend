import { Entity, Column, PrimaryColumn } from 'typeorm';

export interface DayHours { open: string; close: string; closed: boolean }
export type WeeklyHours = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', DayHours>;
export interface Holiday { date: string; note?: string }
export interface LandingFeature { icon: string; title: string; subtitle: string }
export interface LandingContent {
  logoUrl: string; brandName: string;
  tagline1: string; tagline2: string; heroSubtitle: string; heroBadge: string;
  stat1Value: string; stat1Label: string;
  stat2Value: string; stat2Label: string;
  stat3Value: string; stat3Label: string;
  features: LandingFeature[];
  phone: string; hoursLine: string; mapEmbedUrl: string;
  ctaHeading: string; ctaSubtitle: string;
}

@Entity({ name: 'store_settings' })
export class StoreSettings {
  @PrimaryColumn({ type: 'integer' })
  id: number; // always 1 — single-row table

  @Column({ type: 'numeric', name: 'delivery_charge' })
  deliveryCharge: number;

  @Column({ type: 'numeric', name: 'free_delivery_above' })
  freeDeliveryAbove: number;

  @Column({ type: 'numeric', name: 'min_order_amount' })
  minOrderAmount: number;

  @Column({ type: 'numeric', name: 'max_order_amount' })
  maxOrderAmount: number;

  @Column({ type: 'jsonb', name: 'weekly_hours' })
  weeklyHours: WeeklyHours;

  @Column({ type: 'jsonb', name: 'holidays' })
  holidays: Holiday[];

  @Column({ type: 'boolean', name: 'force_closed' })
  forceClosed: boolean;

  @Column({ type: 'text', name: 'closed_message' })
  closedMessage: string;

  @Column({ type: 'text', name: 'timezone' })
  timezone: string;

  /* ── restaurant location + distance pricing (audit §2.1) ── */
  @Column({ type: 'numeric', name: 'store_lat', precision: 10, scale: 7, nullable: true })
  storeLat: number | null;

  @Column({ type: 'numeric', name: 'store_lng', precision: 10, scale: 7, nullable: true })
  storeLng: number | null;

  @Column({ type: 'text', name: 'store_address', nullable: true })
  storeAddress: string | null;

  @Column({ type: 'numeric', name: 'delivery_radius_km', default: 8 })
  deliveryRadiusKm: number;

  @Column({ type: 'integer', name: 'avg_prep_minutes', default: 20 })
  avgPrepMinutes: number;

  @Column({ type: 'numeric', name: 'avg_rider_kmph', default: 20 })
  avgRiderKmph: number;

  @Column({ type: 'numeric', name: 'base_delivery_charge', default: 20 })
  baseDeliveryCharge: number;

  @Column({ type: 'numeric', name: 'per_km_charge', default: 8 })
  perKmCharge: number;

  @Column({ type: 'numeric', name: 'free_delivery_within_km', default: 2 })
  freeDeliveryWithinKm: number;

  /* what the rider earns per delivery (§4.2) */
  @Column({ type: 'numeric', name: 'rider_base_fare', default: 20 })
  riderBaseFare: number;

  @Column({ type: 'numeric', name: 'rider_per_km_pay', default: 5 })
  riderPerKmPay: number;

  /* ── desktop landing page content (admin-editable, audit: marketing site) ── */
  @Column({ type: 'jsonb', name: 'landing_content', nullable: true })
  landingContent: LandingContent | null;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;
}
