/**
 * Pure coupon math — shared by CouponService (validate endpoint)
 * and OrdersService (checkout transaction).
 *
 * NEW: per-user redemption. Pass `usedByUser` (how many times THIS user
 * has already redeemed this code, from coupon_redemptions) and the check
 * compares it against coupons.per_user_limit (default 1 = one-time per user).
 */
export interface CouponRow {
  id: number | string;
  code: string;
  discount_type?: string; discountType?: string;
  discount_value?: any; discountValue?: any;
  min_order?: any; minOrder?: any;
  max_discount?: any; maxDiscount?: any;
  usage_limit?: any; usageLimit?: any;
  used_count?: any; usedCount?: any;
  per_user_limit?: any; perUserLimit?: any;
  valid_from?: any; validFrom?: any;
  valid_until?: any; validUntil?: any;
  is_active?: any; isActive?: any;
}

export function computeCouponDiscount(
  c: CouponRow | undefined | null,
  subtotal: number,
  usedByUser = 0,
): { valid: boolean; discount: number; message: string } {
  if (!c) return { valid: false, discount: 0, message: 'Invalid coupon code' };

  const active = c.is_active ?? c.isActive;
  if (active === false) return { valid: false, discount: 0, message: 'This coupon is no longer active' };

  const now = new Date();
  const from = c.valid_from ?? c.validFrom;
  const until = c.valid_until ?? c.validUntil;
  if (from && new Date(from) > now) return { valid: false, discount: 0, message: 'Coupon not active yet' };
  if (until && new Date(until) < now) return { valid: false, discount: 0, message: 'Coupon has expired' };

  const limit = Number(c.usage_limit ?? c.usageLimit ?? 0);
  const used = Number(c.used_count ?? c.usedCount ?? 0);
  if (limit > 0 && used >= limit) return { valid: false, discount: 0, message: 'Coupon usage limit reached' };

  // Per-user limit — default 1 (one-time redeem) when column is null.
  const perUser = Number(c.per_user_limit ?? c.perUserLimit ?? 1);
  if (perUser > 0 && usedByUser >= perUser) {
    return { valid: false, discount: 0, message: 'You have already used this coupon' };
  }

  const minOrder = Number(c.min_order ?? c.minOrder ?? 0);
  if (subtotal < minOrder) {
    return { valid: false, discount: 0, message: `Add items worth ₹${(minOrder - subtotal).toFixed(0)} more to use this coupon` };
  }

  const type = (c.discount_type ?? c.discountType ?? 'percentage').toLowerCase();
  const value = Number(c.discount_value ?? c.discountValue ?? 0);
  const maxDiscount = Number(c.max_discount ?? c.maxDiscount ?? 0);

  let discount = type === 'flat' || type === 'fixed' ? value : (subtotal * value) / 100;
  if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  discount = Math.min(Math.round(discount * 100) / 100, subtotal);

  if (discount <= 0) return { valid: false, discount: 0, message: 'Coupon gives no discount on this order' };
  return { valid: true, discount, message: `Coupon applied! You saved ₹${discount.toFixed(0)}` };
}
