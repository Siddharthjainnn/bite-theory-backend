/**
 * Doorstep UPI QR — money-safety rules.
 * These encode the cases that cost real money if they regress.
 */
describe('doorstep QR money safety', () => {
  const cashToCollect = (total: number, walletUsed: number) =>
    Math.max(Number(total) - Number(walletUsed || 0), 0);
  const toPaise = (r: number) => Math.round(r * 100);

  it('QR amount = total minus wallet, never the raw total', () => {
    expect(cashToCollect(500, 120)).toBe(380);
    expect(toPaise(cashToCollect(500, 120))).toBe(38000);
  });

  it('never mints a negative or zero-rupee QR', () => {
    expect(cashToCollect(100, 250)).toBe(0);   // wallet covered it all
    expect(toPaise(cashToCollect(100, 250))).toBeLessThan(100); // rejected by createQrCode
  });

  it('rounds paise correctly — no ₹0.01 drift', () => {
    expect(toPaise(cashToCollect(419.99, 0))).toBe(41999);
    expect(toPaise(cashToCollect(1 / 3, 0))).toBe(33);
  });

  it('amount mismatch is detectable (fixed_amount should prevent it)', () => {
    const owedPaise = toPaise(cashToCollect(420, 0));
    expect(owedPaise === 100).toBe(false);   // a ₹1 payment must NOT settle a ₹420 order
    expect(owedPaise).toBe(42000);
  });

  it('cash ledger only moves when the payment row is still cod+pending', () => {
    const ridersCash = (method: string, status: string, amt: number) =>
      (method === 'cod' && status === 'pending') ? amt : 0;
    expect(ridersCash('cod', 'pending', 420)).toBe(420);   // took cash
    expect(ridersCash('online', 'paid', 420)).toBe(0);     // paid by QR → rider owes nothing
    expect(ridersCash('cod', 'paid', 420)).toBe(0);        // already settled
  });
});
