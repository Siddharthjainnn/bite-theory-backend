import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StoreSettings, WeeklyHours, DayHours } from './settings.entity';
import { UpdateSettingsDto } from './update-settings.dto';
import { LandingContent, InvoiceConfig } from './settings.entity';

/** Fallback landing content — shown until the admin edits it in /admin. */
export const DEFAULT_LANDING: LandingContent = {
  logoUrl: '',
  brandName: 'Bite Theory',
  tagline1: 'Smart Food.',
  tagline2: 'Better Living.',
  heroSubtitle:
    'Fresh, healthy, homestyle food made in Indore — served with that unmistakable Malwa warmth. From poha mornings to protein-packed thalis.',
  heroBadge: '100% PURE VEG · INDORE KA APNA',
  stat1Value: '4.8\u2605', stat1Label: '1,200+ ratings',
  stat2Value: '25 min', stat2Label: 'avg delivery',
  stat3Value: '100%', stat3Label: 'pure veg',
  features: [
    { icon: '\uD83C\uDFC6', title: '#1 in Indore', subtitle: 'most-loved veg kitchen' },
    { icon: '\uD83D\uDEF5', title: 'Free Delivery', subtitle: 'within 5 km, over \u20B9199' },
    { icon: '\uD83C\uDF31', title: 'Farm Fresh', subtitle: 'sourced daily, Malwa region' },
    { icon: '\uD83D\uDC9A', title: '50k+ Orders', subtitle: 'served with love' },
  ],
  phone: '+91 90000 00000',
  hoursLine: 'Open 8:00 AM \u2013 11:00 PM \u00B7 all days',
  mapEmbedUrl: '',
  ctaHeading: 'Bhookh lagi? Order kar do \uD83D\uDE0B',
  ctaSubtitle: 'Fresh, hot and homestyle — delivered to your door in Indore.',
};

/** Fallback invoice/bill layout — used until the admin customizes it in /admin. */
export const DEFAULT_INVOICE: InvoiceConfig = {
  brandName: 'Bite Theory',
  logoUrl: '',
  tagline: 'Smart Food. Better Living.',
  addressLine: 'Indore, Madhya Pradesh',
  phone: '+91 90000 00000',
  gstin: '',
  fssai: '',
  accentColor: '#2e7d32',
  paper: 'thermal80',
  showLogo: true,
  showGstin: false,
  showFssai: false,
  showCustomer: true,
  showItemsTable: true,
  columns: { qty: true, unitPrice: true, lineTotal: true },
  showTaxBreakup: true,
  showPaymentMethod: true,
  showQrNote: false,
  headerNote: '',
  footerNote: 'Thank you for ordering with us!',
  thankYouNote: 'See you again soon 🍱',
  chefTicketTitle: 'KITCHEN TICKET',
  chefShowNotes: true,
  autoPrintOnReady: false,
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const DAY_LABEL: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
  thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

export interface StoreStatus {
  open: boolean;
  message: string;          // friendly line shown to customers when closed
  nextOpenAt: string | null; // e.g. "10:00 AM today" / "10:00 AM on Friday"
  reason: 'open' | 'force_closed' | 'holiday' | 'outside_hours';
  todayHours: { open: string; close: string; closed: boolean } | null;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(StoreSettings)
    private readonly repo: Repository<StoreSettings>,
  ) {}

  /** The one settings row (id=1). Falls back to safe defaults if missing. */
  async get(): Promise<StoreSettings> {
    let s = await this.repo.findOne({ where: { id: 1 } });
    if (!s) {
      s = this.repo.create({ id: 1 });
      s = await this.repo.save(s);
    }
    // numeric columns come back as strings from pg — normalize
    s.deliveryCharge = Number(s.deliveryCharge);
    s.freeDeliveryAbove = Number(s.freeDeliveryAbove);
    s.minOrderAmount = Number(s.minOrderAmount);
    s.maxOrderAmount = Number(s.maxOrderAmount);
    if (s.storeLat != null) s.storeLat = Number(s.storeLat);
    if (s.storeLng != null) s.storeLng = Number(s.storeLng);
    s.deliveryRadiusKm = Number(s.deliveryRadiusKm ?? 8);
    s.avgPrepMinutes = Number(s.avgPrepMinutes ?? 20);
    s.avgRiderKmph = Number(s.avgRiderKmph ?? 20);
    s.baseDeliveryCharge = Number(s.baseDeliveryCharge ?? 20);
    s.perKmCharge = Number(s.perKmCharge ?? 8);
    s.freeDeliveryWithinKm = Number(s.freeDeliveryWithinKm ?? 2);
    s.riderBaseFare = Number(s.riderBaseFare ?? 20);
    s.riderPerKmPay = Number(s.riderPerKmPay ?? 5);
    // seed default landing content once, so the site is never blank
    if (!s.landingContent) {
      s.landingContent = DEFAULT_LANDING;
    }
    // merge invoice defaults so newly-added keys are always present
    s.invoiceConfig = { ...DEFAULT_INVOICE, ...(s.invoiceConfig || {}) };
    return s;
  }

  async update(dto: UpdateSettingsDto): Promise<StoreSettings> {
    await this.get(); // ensure row exists
    await this.repo.update(1, { ...(dto as Partial<StoreSettings>), updatedAt: new Date() });
    return this.get();
  }

  /* ── "now" in the store's timezone, without extra deps ── */
  private nowInTz(tz: string) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'short', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const weekday = get('weekday').toLowerCase().slice(0, 3); // 'mon'…
    return {
      dayKey: weekday as keyof WeeklyHours,
      dateStr: `${get('year')}-${get('month')}-${get('day')}`, // YYYY-MM-DD
      minutes: Number(get('hour')) * 60 + Number(get('minute')),
    };
  }

  private toMinutes(hhmm: string): number {
    const [h, m] = (hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  private fmt(hhmm: string): string {
    const [h, m] = (hhmm || '0:0').split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  /**
   * Is the kitchen taking orders right now?
   * Order of checks: force-close → holiday → weekly hours.
   * Also computes the next opening time so the UI can say
   * "We open at 10:00 AM tomorrow" instead of a dead end.
   */
  async status(): Promise<StoreStatus> {
    const s = await this.get();
    const now = this.nowInTz(s.timezone || 'Asia/Kolkata');
    const hours = s.weeklyHours || ({} as WeeklyHours);
    const today: DayHours | undefined = hours[now.dayKey];

    const nextOpen = (startOffset: number): string | null => {
      // scan up to 7 days ahead for the next open slot
      const holidaySet = new Set((s.holidays || []).map((h) => h.date));
      const base = new Date(); // only used to walk dates in the tz
      for (let i = startOffset; i < 7 + startOffset; i++) {
        const d = new Date(base.getTime() + i * 86400000);
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: s.timezone || 'Asia/Kolkata',
          weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
        }).formatToParts(d);
        const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
        const key = get('weekday').toLowerCase().slice(0, 3) as keyof WeeklyHours;
        const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
        const dh = hours[key];
        if (!dh || dh.closed || holidaySet.has(dateStr)) continue;
        if (i === 0 && now.minutes >= this.toMinutes(dh.close)) continue; // already past close today
        const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : `on ${DAY_LABEL[key]}`;
        return `${this.fmt(dh.open)} ${when}`;
      }
      return null;
    };

    if (s.forceClosed) {
      return {
        open: false, reason: 'force_closed',
        message: s.closedMessage || 'We are temporarily closed.',
        nextOpenAt: null, todayHours: today || null,
      };
    }

    const holiday = (s.holidays || []).find((h) => h.date === now.dateStr);
    if (holiday) {
      const next = nextOpen(1);
      return {
        open: false, reason: 'holiday',
        message: `We're closed today${holiday.note ? ` for ${holiday.note}` : ''}. ${next ? `We open at ${next}.` : ''}`.trim(),
        nextOpenAt: next, todayHours: today || null,
      };
    }

    if (!today || today.closed) {
      const next = nextOpen(1);
      return {
        open: false, reason: 'outside_hours',
        message: `We're closed today. ${next ? `We open at ${next}.` : ''}`.trim(),
        nextOpenAt: next, todayHours: today || null,
      };
    }

    const openM = this.toMinutes(today.open);
    const closeM = this.toMinutes(today.close);
    if (now.minutes >= openM && now.minutes < closeM) {
      return { open: true, reason: 'open', message: '', nextOpenAt: null, todayHours: today };
    }

    const next = now.minutes < openM ? `${this.fmt(today.open)} today` : nextOpen(1);
    return {
      open: false, reason: 'outside_hours',
      message: `Our kitchen is closed right now. ${next ? `We open at ${next} — see you then! 🍱` : ''}`.trim(),
      nextOpenAt: next, todayHours: today,
    };
  }
}
