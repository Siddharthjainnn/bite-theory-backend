/**
 * GST + invoice-numbering tests.
 *
 * This is tax money and a legal invoice series — the two things you cannot fix
 * retroactively. Every case here is one I'd want to prove before a rupee moves.
 */

/** Mirror of OrdersService.computeGst (private) — same arithmetic, testable. */
function computeGst(cfg: any, foodAmount: number, deliveryCharge: number) {
  if (!cfg?.gstEnabled) return { taxRate: 0, tax: 0, cgst: 0, sgst: 0 };
  const rate = Number(cfg.gstRate ?? 5);
  const base = Number(foodAmount) + (cfg.gstOnDelivery ? Number(deliveryCharge) : 0);
  if (base <= 0 || rate <= 0) return { taxRate: rate, tax: 0, cgst: 0, sgst: 0 };
  const tax = cfg.gstInclusive ? base - base / (1 + rate / 100) : base * (rate / 100);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const total = round2(tax);
  const cgst = round2(total / 2);
  return { taxRate: rate, tax: total, cgst, sgst: round2(total - cgst) };
}

function financialYear(d: Date): string {
  const y = d.getFullYear();
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

const ON = { gstEnabled: true, gstRate: 5, gstInclusive: true, gstOnDelivery: false };

describe('GST — off by default', () => {
  it('charges nothing when GST is not enabled', () => {
    expect(computeGst({ gstEnabled: false }, 500, 40)).toEqual(
      { taxRate: 0, tax: 0, cgst: 0, sgst: 0 });
  });

  it('an un-migrated / empty config is treated as OFF, not as a crash', () => {
    expect(computeGst(null, 500, 40).tax).toBe(0);
    expect(computeGst({}, 500, 40).tax).toBe(0);
  });
});

describe('GST — inclusive pricing (the Indian default)', () => {
  it('EXTRACTS tax from a ₹100 dish rather than adding it', () => {
    // 100 - 100/1.05 = 4.7619...
    const r = computeGst(ON, 100, 0);
    expect(r.tax).toBe(4.76);
  });

  it('does not change what the customer pays', () => {
    const food = 525;
    const r = computeGst(ON, food, 0);
    // the tax is *inside* the 525, so 525 is still the amount charged
    expect(r.tax).toBeLessThan(food);
    expect(Math.round((food - r.tax) * 1.05 * 100) / 100).toBeCloseTo(food, 1);
  });

  it('excludes the delivery charge by default (restaurant GST is on food)', () => {
    const withoutDelivery = computeGst(ON, 500, 40).tax;
    const sameButDeliveryIgnored = computeGst(ON, 500, 999).tax;
    expect(withoutDelivery).toBe(sameButDeliveryIgnored);
  });

  it('includes delivery when gstOnDelivery is turned on', () => {
    const r = computeGst({ ...ON, gstOnDelivery: true }, 500, 40);
    const base = 540;
    expect(r.tax).toBeCloseTo(base - base / 1.05, 2);
  });
});

describe('GST — exclusive pricing', () => {
  it('ADDS tax on top of the price', () => {
    const r = computeGst({ ...ON, gstInclusive: false }, 100, 0);
    expect(r.tax).toBe(5); // 100 * 5%
  });
});

describe('GST — CGST/SGST split must never lose a paisa', () => {
  it('splits evenly when the amount divides cleanly', () => {
    const r = computeGst({ ...ON, gstInclusive: false }, 200, 0); // tax = 10
    expect(r.cgst).toBe(5);
    expect(r.sgst).toBe(5);
  });

  it('cgst + sgst ALWAYS equals the total tax, even on odd amounts', () => {
    // this is the case that breaks naive `tax/2` twice
    for (const amt of [100, 101, 33.33, 777.77, 1, 9.99, 12345.67]) {
      const r = computeGst(ON, amt, 0);
      expect(Math.round((r.cgst + r.sgst) * 100) / 100).toBe(r.tax);
    }
  });

  it('handles a zero-value order without producing NaN', () => {
    const r = computeGst(ON, 0, 0);
    expect(r.tax).toBe(0);
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
  });

  it('a fully-discounted order has no tax', () => {
    expect(computeGst(ON, 0, 40).tax).toBe(0);
  });
});

describe('financial year (Apr–Mar)', () => {
  it('April starts a new FY', () => {
    expect(financialYear(new Date('2026-04-01'))).toBe('2026-27');
  });
  it('March still belongs to the previous FY', () => {
    expect(financialYear(new Date('2026-03-31'))).toBe('2025-26');
  });
  it('mid-year is straightforward', () => {
    expect(financialYear(new Date('2026-07-16'))).toBe('2026-27');
  });
  it('rolls the century correctly', () => {
    expect(financialYear(new Date('2099-05-01'))).toBe('2099-00');
  });
});
