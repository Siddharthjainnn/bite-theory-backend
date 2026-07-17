/**
 * Pure offer logic — no DB, no Nest. Kept separate so the money rules are
 * unit-testable in isolation, exactly like coupon.util.ts.
 */

export interface OfferRow {
  id: number;
  offerType: string;                 // flat | percentage | free_item | free_delivery
  rewardValue: number;
  maxDiscount?: number | null;
  minOrder?: number | null;
  startsAt: string | Date;
  endsAt: string | Date;
  usageLimit?: number | null;
  usedCount?: number | null;
  perUserLimit?: number | null;
  isActive?: boolean | null;
  freeProductId?: number | null;
}

export interface OfferResult {
  valid: boolean;
  /** rupees off the subtotal (0 for free_item / free_delivery) */
  discount: number;
  /** product to add at ₹0 */
  freeProductId?: number | null;
  /** true when delivery should be waived */
  freeDelivery?: boolean;
  message?: string;
}

/**
 * Decide whether an offer applies, and what it's worth.
 *
 * Deliberately mirrors computeCouponDiscount's contract so the two can never
 * disagree about what "expired" or "min order" means — two different answers to
 * the same question is how customers end up arguing with support.
 */
export function evaluateOffer(
  o: OfferRow | null | undefined,
  subtotal: number,
  deliveryCharge = 0,
  usedByUser = 0,
  now: Date = new Date(),
): OfferResult {
  if (!o) return { valid: false, discount: 0, message: 'Offer not found.' };
  if (o.isActive === false) return { valid: false, discount: 0, message: 'This offer is no longer active.' };

  const start = new Date(o.startsAt);
  const end = new Date(o.endsAt);
  if (now < start) {
    return { valid: false, discount: 0, message: 'This offer has not started yet.' };
  }
  if (now >= end) {
    return { valid: false, discount: 0, message: 'This offer has ended.' };
  }

  const min = Number(o.minOrder || 0);
  if (subtotal < min) {
    return {
      valid: false, discount: 0,
      message: `Add ₹${Math.ceil(min - subtotal)} more to use this offer.`,
    };
  }

  const limit = o.usageLimit == null ? null : Number(o.usageLimit);
  if (limit != null && Number(o.usedCount || 0) >= limit) {
    return { valid: false, discount: 0, message: 'This offer has been fully claimed.' };
  }

  const perUser = Number(o.perUserLimit ?? 1);
  if (perUser > 0 && usedByUser >= perUser) {
    return { valid: false, discount: 0, message: 'You have already used this offer.' };
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  switch (o.offerType) {
    case 'free_delivery':
      if (deliveryCharge <= 0) {
        return { valid: false, discount: 0, message: 'Delivery is already free on this order.' };
      }
      return { valid: true, discount: 0, freeDelivery: true };

    case 'free_item':
      if (!o.freeProductId) {
        return { valid: false, discount: 0, message: 'This offer is misconfigured — no free item set.' };
      }
      return { valid: true, discount: 0, freeProductId: Number(o.freeProductId) };

    case 'flat': {
      // never discount more than the order itself — a negative bill is a bug
      const d = round2(Math.min(Number(o.rewardValue || 0), subtotal));
      return d > 0
        ? { valid: true, discount: d }
        : { valid: false, discount: 0, message: 'This offer gives no discount on your order.' };
    }

    case 'percentage': {
      let d = (subtotal * Number(o.rewardValue || 0)) / 100;
      const cap = o.maxDiscount == null ? null : Number(o.maxDiscount);
      if (cap != null && cap > 0) d = Math.min(d, cap);
      d = round2(Math.min(d, subtotal));
      return d > 0
        ? { valid: true, discount: d }
        : { valid: false, discount: 0, message: 'This offer gives no discount on your order.' };
    }

    default:
      return { valid: false, discount: 0, message: 'Unknown offer type.' };
  }
}

/** Seconds left on an offer — drives the countdown. Never negative. */
export function secondsLeft(endsAt: string | Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((new Date(endsAt).getTime() - now.getTime()) / 1000));
}
