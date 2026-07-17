import { Entity, Column, PrimaryColumn } from 'typeorm';

export interface DayHours { open: string; close: string; closed: boolean }
export type WeeklyHours = Record<'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun', DayHours>;
export interface Holiday { date: string; note?: string }
export interface LandingFeature { icon: string; title: string; subtitle: string }
/** Admin-customizable invoice / bill layout (single JSONB blob). */
export interface InvoiceColumnToggle {
  qty: boolean;
  unitPrice: boolean;
  lineTotal: boolean;
}
export interface InvoiceConfig {
  /* branding */
  brandName: string;
  logoUrl: string;
  tagline: string;
  addressLine: string;
  phone: string;
  gstin: string;
  fssai: string;
  /* accent + paper */
  accentColor: string;
  paper: 'thermal58' | 'thermal80' | 'a4';
  /* what shows on the customer invoice */
  showLogo: boolean;
  showGstin: boolean;
  showFssai: boolean;
  showCustomer: boolean;
  showItemsTable: boolean;
  columns: InvoiceColumnToggle;
  showTaxBreakup: boolean;
  showPaymentMethod: boolean;
  showQrNote: boolean;
  /* copy */
  headerNote: string;
  footerNote: string;
  thankYouNote: string;
  /* chef ticket */
  chefTicketTitle: string;
  chefShowNotes: boolean;
  /* behaviour */
  autoPrintOnReady: boolean;
}

export interface LandingContent {
  logoUrl: string; brandName: string; city: string;
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

  /* admin-customizable invoice / bill layout (audit: printable invoices) */
  @Column({ type: 'jsonb', name: 'invoice_config', nullable: true })
  invoiceConfig: InvoiceConfig | null;

  /* ── GST (2026-07-16-gst-invoicing.sql). All default OFF so nothing changes
     until you actually register. Tax is snapshotted onto each order, so
     changing these later never rewrites past invoices. ── */
  @Column({ type: 'boolean', name: 'gst_enabled', default: false })
  gstEnabled: boolean;

  /** Restaurant rate is 5% (no input tax credit). */
  @Column({ type: 'numeric', name: 'gst_rate', default: 5 })
  gstRate: number;

  /** Restaurant GST applies to food, not the delivery fee — off by default. */
  @Column({ type: 'boolean', name: 'gst_on_delivery', default: false })
  gstOnDelivery: boolean;

  /** Indian menus show GST-inclusive prices; tax is extracted, not added. */
  @Column({ type: 'boolean', name: 'gst_inclusive', default: true })
  gstInclusive: boolean;

  @Column({ type: 'varchar', name: 'invoice_prefix', default: 'BT' })
  invoicePrefix: string;

  /** 996331 = restaurant / catering services. */
  @Column({ type: 'varchar', name: 'hsn_code', nullable: true })
  hsnCode: string;

  /* ── Ask Bhaiya intro (2026-07-17-bhaiya-intro-toggle.sql) ──
     Controls only the AUTOMATIC goal-picker popup on the home page. The
     "Ask Bhaiya" button in the header always works, so turning this off makes
     the feature opt-in rather than removing it. */
  @Column({ type: 'boolean', name: 'bhaiya_intro_enabled', default: true })
  bhaiyaIntroEnabled: boolean;

  /** 'daily' | 'once' | 'always' — how often it may re-appear per customer. */
  @Column({ type: 'varchar', name: 'bhaiya_intro_frequency', default: 'daily' })
  bhaiyaIntroFrequency: string;

  /* ── Wallet presentation (2026-07-17-offers-engine.sql) ──
     LEGAL: under RBI's PPI rules, letting customers load their OWN money into
     a wallet makes it a regulated prepaid instrument (licence + KYC + escrow).
     This balance is gift-only — refunds, referrals and admin credit, with no
     top-up path anywhere — so the mechanic is already compliant. The risk is
     the WORDING: showing "₹500" implies stored customer money. Relabelling to
     e.g. "Bite Coins" presents it as the loyalty scheme it actually is. */
  @Column({ type: 'varchar', name: 'wallet_label', default: 'Wallet' })
  walletLabel: string;

  /** Display unit — '₹' or e.g. 'Coins'. Purely cosmetic; math is unchanged. */
  @Column({ type: 'varchar', name: 'wallet_unit', default: '₹' })
  walletUnit: string;

  /** Shown on the wallet screen — the disclaimer that keeps this a reward. */
  @Column({ type: 'varchar', name: 'wallet_note', nullable: true })
  walletNote: string;

  @Column({ type: 'timestamptz', name: 'updated_at', nullable: true })
  updatedAt: Date;
}
