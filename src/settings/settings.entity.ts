import { Entity, Column, PrimaryColumn } from 'typeorm';

export interface DayHours { open: string; close: string; closed: boolean }
export type WeeklyHours = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', DayHours>;
export interface Holiday { date: string; note?: string }

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

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;
}
