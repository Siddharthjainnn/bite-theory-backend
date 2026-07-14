/** Cash cap — the control that forces undeposited money back to the owner. */
describe('rider cash cap', () => {
  const CAP = 3000;
  const cashInHand = (collected: number, deposited: number) =>
    Math.max(0, collected - deposited);
  const blocked = (cash: number) => cash >= CAP;

  it('QR-paid orders add zero to cash in hand', () => {
    // only rider_cash_ledger 'collect' rows count, and QR never writes one
    expect(cashInHand(0, 0)).toBe(0);
  });

  it('blocks a rider sitting on the cap', () => {
    expect(blocked(cashInHand(3200, 0))).toBe(true);
    expect(blocked(cashInHand(2999, 0))).toBe(false);
  });

  it('a deposit immediately un-blocks the rider', () => {
    expect(blocked(cashInHand(3500, 0))).toBe(true);
    expect(blocked(cashInHand(3500, 3500))).toBe(false);   // deposited in full
    expect(blocked(cashInHand(3500, 1000))).toBe(false);   // ₹2500 left, under cap
  });

  it('never goes negative when a rider over-deposits', () => {
    expect(cashInHand(1000, 1500)).toBe(0);
  });

  it('the cap applies to COD only — prepaid orders always assignable', () => {
    const canAssign = (isCod: boolean, cash: number) => !(isCod && blocked(cash));
    expect(canAssign(true, 3500)).toBe(false);   // capped, cash order → refused
    expect(canAssign(false, 3500)).toBe(true);   // capped, prepaid → still works
    expect(canAssign(true, 500)).toBe(true);
  });

  it('flags a watch-list rider before they hit the wall', () => {
    const risk = (cash: number, days: number | null) =>
      cash >= CAP ? 'blocked'
        : (days !== null && days >= 3) || cash >= CAP * 0.7 ? 'watch' : 'ok';
    expect(risk(3000, 0)).toBe('blocked');
    expect(risk(2100, 0)).toBe('watch');   // 70% of cap
    expect(risk(200, 5)).toBe('watch');    // small cash, but sat on it 5 days
    expect(risk(200, 0)).toBe('ok');
  });
});
