/**
 * Counter POS — pure maths and numbering. No DB, so every rule here is unit
 * tested (pos.math.spec.ts).
 */

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface TaxSettings {
  gstEnabled: boolean;
  gstRate: number;       // 5 = 5%
  gstInclusive: boolean; // menu prices already include GST
}

export interface DiscountInput {
  type: 'flat' | 'percent';
  value: number;
}

export interface BillTotals {
  subtotal: number;
  discount: number;
  taxableAmount: number;
  taxRate: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
}

/**
 * Bill totals.
 *
 *   subtotal  Σ qty × outlet rate
 *   discount  flat ₹ or % of subtotal, never more than the subtotal
 *   tax       GST-inclusive → extracted from (subtotal − discount)
 *             GST-exclusive → added on top
 *   total     rounded to the nearest rupee; the difference is printed as
 *             "Round off" so the bill still adds up to the paisa
 *
 * CGST + SGST always sum exactly to the tax: halve, then derive the second
 * half by subtraction so a rounding paisa can never go missing.
 */
export function billTotals(
  subtotalIn: number,
  tax: TaxSettings,
  discountIn?: DiscountInput | null,
): BillTotals {
  const subtotal = round2(Math.max(0, subtotalIn));

  let discount = 0;
  if (discountIn && Number(discountIn.value) > 0) {
    const v = Number(discountIn.value);
    discount = discountIn.type === 'percent'
      ? subtotal * (Math.min(v, 100) / 100)
      : v;
    discount = round2(Math.min(subtotal, Math.max(0, discount)));
  }
  const net = round2(subtotal - discount);

  const rate = tax.gstEnabled ? Math.max(0, Number(tax.gstRate) || 0) : 0;
  let gst = 0;
  let taxable = net;
  let gross = net;
  if (rate > 0 && net > 0) {
    if (tax.gstInclusive) {
      taxable = round2(net / (1 + rate / 100));
      gst = round2(net - taxable);
      gross = net;
    } else {
      gst = round2(net * (rate / 100));
      taxable = net;
      gross = round2(net + gst);
    }
  }
  const cgst = round2(gst / 2);
  const sgst = round2(gst - cgst);

  const total = Math.round(gross);
  const roundOff = round2(total - gross);

  return { subtotal, discount, taxableAmount: taxable, taxRate: rate, cgst, sgst, roundOff, total };
}

/* ── India time ── */
const IST_OFFSET_MIN = 330;

/**
 * The outlet's business date. With dayStartsAt = 4, a bill at 01:30 on the
 * 22nd belongs to the 21st — so late-night bills land in the right day's
 * report and the token doesn't restart at midnight in the middle of service.
 */
export function businessDate(at: Date, dayStartsAt: number): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  const shifted = new Date(ist.getTime() - Math.max(0, Math.min(23, dayStartsAt)) * 3_600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Indian financial year (Apr–Mar) of a YYYY-MM-DD date, short form: '26-27'. */
export function financialYearShort(ymd: string): string {
  const [y, m] = ymd.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * GST invoice numbers may be at most 16 characters (letters, digits, '/' and
 * '-'): BKW/26-27/000001 is exactly 16. Six digits = 999,999 bills a year per
 * outlet before the series would outgrow the limit.
 */
export function formatBillNo(code: string, fy: string, n: number): string {
  return `${code}/${fy}/${String(n).padStart(6, '0')}`;
}

/** 1…999, then back to 1. The counter itself keeps counting. */
export function tokenFromCounter(n: number): number {
  return ((Math.max(1, Math.floor(n)) - 1) % 999) + 1;
}

export const formatToken = (t: number) => String(t).padStart(3, '0');

/** A 10-digit Indian mobile, or null. Accepts +91 / 0 prefixes and spaces. */
export function cleanMobile(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return null;
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}
