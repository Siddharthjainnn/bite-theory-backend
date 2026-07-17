import { evaluateOffer, secondsLeft, OfferRow } from './offer.util';

/**
 * Offer logic tests. These decide what a customer pays, so every rule that
 * could leak money or wrongly reject a valid offer is pinned here.
 */

const NOW = new Date('2026-07-17T12:00:00Z');
const base = (over: Partial<OfferRow> = {}): OfferRow => ({
  id: 1,
  offerType: 'flat',
  rewardValue: 50,
  minOrder: 0,
  startsAt: '2026-07-17T00:00:00Z',
  endsAt: '2026-07-18T00:00:00Z',
  isActive: true,
  perUserLimit: 1,
  ...over,
});

describe('evaluateOffer — time window', () => {
  it('rejects an offer that has not started', () => {
    const r = evaluateOffer(base({ startsAt: '2026-07-18T00:00:00Z' }), 500, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/not started/i);
  });

  it('rejects an offer that has ended', () => {
    const r = evaluateOffer(base({ endsAt: '2026-07-17T11:00:00Z' }), 500, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/ended/i);
  });

  it('accepts an offer inside its window', () => {
    expect(evaluateOffer(base(), 500, 0, 0, NOW).valid).toBe(true);
  });

  it('the LAST second is still valid, the end instant is not', () => {
    const endsAt = '2026-07-17T12:00:00Z';
    // exactly at end -> expired
    expect(evaluateOffer(base({ endsAt }), 500, 0, 0, NOW).valid).toBe(false);
    // one second before -> still live
    const oneSecEarlier = new Date('2026-07-17T11:59:59Z');
    expect(evaluateOffer(base({ endsAt }), 500, 0, 0, oneSecEarlier).valid).toBe(true);
  });

  it('rejects an inactive offer even inside its window', () => {
    expect(evaluateOffer(base({ isActive: false }), 500, 0, 0, NOW).valid).toBe(false);
  });
});

describe('evaluateOffer — limits', () => {
  it('enforces the minimum order and says how much more is needed', () => {
    const r = evaluateOffer(base({ minOrder: 300 }), 250, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toContain('50');
  });

  it('rejects when the global limit is exhausted', () => {
    const r = evaluateOffer(base({ usageLimit: 100, usedCount: 100 }), 500, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/fully claimed/i);
  });

  it('allows unlimited use when usageLimit is null', () => {
    expect(evaluateOffer(base({ usageLimit: null, usedCount: 9999 }), 500, 0, 0, NOW).valid).toBe(true);
  });

  it('rejects a second use when perUserLimit is 1', () => {
    const r = evaluateOffer(base(), 500, 0, 1, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/already used/i);
  });

  it('allows repeat use when perUserLimit allows it', () => {
    expect(evaluateOffer(base({ perUserLimit: 3 }), 500, 0, 2, NOW).valid).toBe(true);
  });
});

describe('evaluateOffer — flat', () => {
  it('gives the flat amount', () => {
    expect(evaluateOffer(base({ rewardValue: 50 }), 500, 0, 0, NOW).discount).toBe(50);
  });

  it('NEVER discounts more than the order — no negative bills', () => {
    expect(evaluateOffer(base({ rewardValue: 999 }), 300, 0, 0, NOW).discount).toBe(300);
  });
});

describe('evaluateOffer — percentage', () => {
  it('takes the percentage', () => {
    expect(evaluateOffer(base({ offerType: 'percentage', rewardValue: 20 }), 500, 0, 0, NOW).discount).toBe(100);
  });

  it('respects the cap', () => {
    const r = evaluateOffer(base({ offerType: 'percentage', rewardValue: 50, maxDiscount: 100 }), 1000, 0, 0, NOW);
    expect(r.discount).toBe(100); // 500 capped to 100
  });

  it('rounds to 2 decimals', () => {
    const r = evaluateOffer(base({ offerType: 'percentage', rewardValue: 33 }), 101, 0, 0, NOW);
    expect(r.discount).toBe(33.33);
  });
});

describe('evaluateOffer — free item', () => {
  it('returns the product to gift', () => {
    const r = evaluateOffer(base({ offerType: 'free_item', freeProductId: 7 }), 500, 0, 0, NOW);
    expect(r.valid).toBe(true);
    expect(r.freeProductId).toBe(7);
    expect(r.discount).toBe(0); // the item is added at ₹0, not discounted off
  });

  it('rejects a misconfigured free-item offer instead of silently doing nothing', () => {
    const r = evaluateOffer(base({ offerType: 'free_item', freeProductId: null }), 500, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/misconfigured/i);
  });

  it('still honours the minimum order (that is the point of a free item)', () => {
    const r = evaluateOffer(base({ offerType: 'free_item', freeProductId: 7, minOrder: 299 }), 200, 0, 0, NOW);
    expect(r.valid).toBe(false);
  });
});

describe('evaluateOffer — free delivery', () => {
  it('waives the delivery charge', () => {
    const r = evaluateOffer(base({ offerType: 'free_delivery' }), 500, 40, 0, NOW);
    expect(r.valid).toBe(true);
    expect(r.freeDelivery).toBe(true);
  });

  it('is rejected when delivery is already free — no phantom benefit', () => {
    const r = evaluateOffer(base({ offerType: 'free_delivery' }), 500, 0, 0, NOW);
    expect(r.valid).toBe(false);
    expect(r.message).toMatch(/already free/i);
  });
});

describe('secondsLeft', () => {
  it('counts down', () => {
    expect(secondsLeft('2026-07-17T12:01:00Z', NOW)).toBe(60);
  });
  it('never goes negative', () => {
    expect(secondsLeft('2026-07-17T11:00:00Z', NOW)).toBe(0);
  });
});
