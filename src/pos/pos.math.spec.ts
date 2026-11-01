import {
  billTotals, businessDate, financialYearShort, formatBillNo,
  tokenFromCounter, formatToken, cleanMobile,
} from './pos.math';

const OFF = { gstEnabled: false, gstRate: 5, gstInclusive: true };
const INC = { gstEnabled: true, gstRate: 5, gstInclusive: true };
const EXC = { gstEnabled: true, gstRate: 5, gstInclusive: false };

describe('billTotals', () => {
  it('GST off: total is the subtotal', () => {
    expect(billTotals(340, OFF)).toEqual({
      subtotal: 340, discount: 0, taxableAmount: 340, taxRate: 0,
      cgst: 0, sgst: 0, roundOff: 0, total: 340,
    });
  });

  it('GST inclusive: tax is extracted, the customer pays the menu price', () => {
    const t = billTotals(210, INC);
    expect(t.total).toBe(210);
    expect(t.taxableAmount).toBe(200);
    expect(t.cgst + t.sgst).toBeCloseTo(10, 2);
    expect(t.cgst).toBe(5);
  });

  it('GST exclusive: tax is added and rounded to the rupee', () => {
    const t = billTotals(199, EXC); // 199 + 9.95 = 208.95
    expect(t.cgst + t.sgst).toBeCloseTo(9.95, 2);
    expect(t.total).toBe(209);
    expect(t.roundOff).toBe(0.05);
  });

  it('CGST and SGST always sum to the tax exactly', () => {
    for (const s of [1, 7, 33, 99, 101, 457, 1234]) {
      const t = billTotals(s, EXC);
      const tax = Math.round(s * 0.05 * 100) / 100;
      expect(Math.round((t.cgst + t.sgst) * 100) / 100).toBe(tax);
    }
  });

  it('percent discount, capped at 100%', () => {
    expect(billTotals(300, OFF, { type: 'percent', value: 10 }).total).toBe(270);
    expect(billTotals(300, OFF, { type: 'percent', value: 150 }).total).toBe(0);
  });

  it('flat discount never goes below zero', () => {
    const t = billTotals(100, OFF, { type: 'flat', value: 500 });
    expect(t.discount).toBe(100);
    expect(t.total).toBe(0);
  });

  it('fractional discount is rounded off on the bill', () => {
    const t = billTotals(333, OFF, { type: 'percent', value: 5 }); // 316.35
    expect(t.total).toBe(316);
    expect(t.roundOff).toBe(-0.35);
  });

  it('ignores zero / negative discounts', () => {
    expect(billTotals(100, OFF, { type: 'flat', value: -20 }).discount).toBe(0);
  });
});

describe('businessDate', () => {
  it('uses India time', () => {
    // 2026-11-21 20:00 UTC = 22nd 01:30 IST → with a 4 am day start it is still the 21st
    expect(businessDate(new Date('2026-11-21T20:00:00Z'), 4)).toBe('2026-11-21');
    // 22nd 05:00 IST → the 22nd
    expect(businessDate(new Date('2026-11-21T23:30:00Z'), 4)).toBe('2026-11-22');
  });
  it('a day that starts at midnight', () => {
    expect(businessDate(new Date('2026-11-21T19:00:00Z'), 0)).toBe('2026-11-22'); // 00:30 IST
  });
});

describe('numbering', () => {
  it('financial year runs April to March', () => {
    expect(financialYearShort('2026-11-21')).toBe('26-27');
    expect(financialYearShort('2027-03-31')).toBe('26-27');
    expect(financialYearShort('2027-04-01')).toBe('27-28');
  });
  it('bill numbers fit the 16-character GST limit', () => {
    const n = formatBillNo('BKW', '26-27', 1);
    expect(n).toBe('BKW/26-27/000001');
    expect(n.length).toBe(16);
  });
  it('tokens run 001…999 then start again', () => {
    expect(tokenFromCounter(1)).toBe(1);
    expect(tokenFromCounter(999)).toBe(999);
    expect(tokenFromCounter(1000)).toBe(1);
    expect(formatToken(7)).toBe('007');
  });
});

describe('cleanMobile', () => {
  it('accepts common formats', () => {
    expect(cleanMobile('+91 98765 43210')).toBe('9876543210');
    expect(cleanMobile('09876543210')).toBe('9876543210');
  });
  it('rejects junk and blanks', () => {
    expect(cleanMobile('')).toBeNull();
    expect(cleanMobile('12345')).toBeNull();
    expect(cleanMobile('1234567890')).toBeNull();
  });
});
