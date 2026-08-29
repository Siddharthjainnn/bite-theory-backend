import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * A tiffin / daily-meal enrolment request captured from the storefront
 * (primary landing point for the Meta ad campaign).
 *
 * This is a LEAD, not a live subscription: the customer submits their details,
 * admin sees it in Admin → Tiffin, calls them back, collects payment offline,
 * and only then marks it converted. Keeping it a lead means the ad can go live
 * without a recurring-billing integration behind it.
 *
 * `schedule` is JSONB rather than a child table because it is always read and
 * written as one whole week — we never query "all leads delivering to X on a
 * Tuesday" — and the shape (which days are on, per-day address, per-day slot)
 * is still being tuned. Shape:
 *   [{ day: 'mon', enabled: true, address: '...', landmark: '...', slot: '12:00-13:00' }, ...]
 */
@Entity({ name: 'tiffin_leads' })
export class TiffinLead {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  /** Null for logged-out visitors — the ad funnel does NOT force a login. */
  @Column({ type: 'bigint', name: 'user_id', nullable: true })
  userId: number | null;

  @Column({ type: 'varchar', name: 'name' })
  name: string;

  @Index()
  @Column({ type: 'varchar', name: 'phone' })
  phone: string;

  @Column({ type: 'varchar', name: 'email', nullable: true })
  email: string | null;

  /** Locality picked from the serviceable-areas list, e.g. 'vijay-nagar'. */
  @Column({ type: 'varchar', name: 'area', nullable: true })
  area: string | null;

  /** Plan snapshot at submit time, so later price changes don't rewrite history. */
  @Column({ type: 'varchar', name: 'plan_key', nullable: true })
  planKey: string | null;

  @Column({ type: 'varchar', name: 'plan_label', nullable: true })
  planLabel: string | null;

  @Column({ type: 'integer', name: 'plan_price', nullable: true })
  planPrice: number | null;

  @Column({ type: 'jsonb', name: 'schedule', nullable: true })
  schedule: Array<{
    day: string;
    enabled: boolean;
    address: string;
    landmark?: string;
    slot: string;
    /* Set when the customer picked a Google Places suggestion; absent for
       free-text addresses. Riders should still read `address` either way. */
    lat?: number;
    lng?: number;
    placeId?: string;
  }> | null;

  @Column({ type: 'text', name: 'notes', nullable: true })
  notes: string | null;

  /** new → contacted → converted | rejected */
  @Index()
  @Column({ type: 'varchar', name: 'status', default: 'new' })
  status: string;

  /** Free-text admin callback notes, kept separate from customer `notes`. */
  @Column({ type: 'text', name: 'admin_note', nullable: true })
  adminNote: string | null;

  /** Which ad / campaign the lead arrived from (?utm_source=...). */
  @Column({ type: 'varchar', name: 'source', nullable: true })
  source: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;
}
