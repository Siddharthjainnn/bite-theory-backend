import { computeCouponDiscount, CouponRow } from './coupon.util';

/**
 * Money logic tests — computeCouponDiscount decides how many rupees come off
 * an order, so it's the single most important pure function to lock down.
 * A future edit that breaks any of these would leak money or reject valid
 * coupons.
 */
describe('computeCouponDiscount', () => {
  const base = (over: Partial<CouponRow> = {}): CouponRow => ({
    id: 1,
    code: 'SAVE10',
    discount_type: 'percentage',
    discount_value: 10,
    is_active: true,
    ...over,
  });

  it('rejects a missing coupon', () => {
    const r = computeCouponDiscount(null, 500);
    expect(r.valid).toBe(false);
    expect(r.discount).toBe(0);
  });

  it('applies a percentage discount', () => {
    const r = computeCouponDiscount(base({ discount_value: 10 }), 500);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(50); // 10% of 500
  });

  it('applies a flat discount', () => {
    const r = computeCouponDiscount(
      base({ discount_type: 'flat', discount_value: 75 }), 500);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(75);
  });

  it('treats "fixed" as flat', () => {
    const r = computeCouponDiscount(
      base({ discount_type: 'fixed', discount_value: 60 }), 500);
    expect(r.discount).toBe(60);
  });

  it('caps a percentage discount at max_discount', () => {
    const r = computeCouponDiscount(
      base({ discount_value: 50, max_discount: 100 }), 1000);
    // 50% of 1000 = 500, capped at 100
    expect(r.discount).toBe(100);
  });

  it('never discounts more than the subtotal', () => {
    const r = computeCouponDiscount(
      base({ discount_type: 'flat', discount_value: 999 }), 300);
    expect(r.discount).toBe(300);
  });

  it('rejects an inactive coupon', () => {
    const r = computeCouponDiscount(base({ is_active: false }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/no longer active/i);
  });

  it('rejects a not-yet-valid coupon', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const r = computeCouponDiscount(base({ valid_from: future }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/not active yet/i);
  });

  it('rejects an expired coupon', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const r = computeCouponDiscount(base({ valid_until: past }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/expired/i);
  });

  it('enforces the minimum order amount', () => {
    const r = computeCouponDiscount(base({ min_order: 600 }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/more to use/i);
  });

  it('rejects when the global usage limit is reached', () => {
    const r = computeCouponDiscount(
      base({ usage_limit: 100, used_count: 100 }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/usage limit/i);
  });

  it('rejects when the user already used it (default per-user limit = 1)', () => {
    const r = computeCouponDiscount(base(), 500, /* usedByUser */ 1);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/already used/i);
  });

  it('allows a repeat use when per_user_limit is higher', () => {
    const r = computeCouponDiscount(
      base({ per_user_limit: 3 }), 500, /* usedByUser */ 2);
    expect(r.valid).toBe(true);
  });

  it('an admin-gifted (assigned) coupon bypasses usage + per-user limits', () => {
    const r = computeCouponDiscount(
      base({ usage_limit: 1, used_count: 5, per_user_limit: 1 }),
      500, /* usedByUser */ 3, /* assigned */ true);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(50);
  });

  it('an assigned coupon still honours the expiry date', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const r = computeCouponDiscount(
      base({ valid_until: past }), 500, 0, true);
    expect(r.valid).toBe(false);
  });

  it('an assigned coupon still honours the minimum order', () => {
    const r = computeCouponDiscount(
      base({ min_order: 999 }), 500, 0, true);
    expect(r.valid).toBe(false);
  });

  it('reads camelCase fields too (discountType/discountValue)', () => {
    const r = computeCouponDiscount(
      { id: 2, code: 'X', discountType: 'flat', discountValue: 40, isActive: true },
      500);
    expect(r.discount).toBe(40);
  });

  it('rounds to 2 decimals', () => {
    // 33% of 100 = 33 exactly, but 33% of 101 = 33.33
    const r = computeCouponDiscount(base({ discount_value: 33 }), 101);
    expect(r.discount).toBe(33.33);
  });

  it('rejects a coupon that produces zero discount', () => {
    const r = computeCouponDiscount(
      base({ discount_type: 'flat', discount_value: 0 }), 500);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/no discount/i);
  });
});
