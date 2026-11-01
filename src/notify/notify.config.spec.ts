import {
  TEMPLATES,
  DEFAULT_NOTIFY,
  normalizeNotify,
  toE164India,
  cleanParam,
  firstName,
  clock,
  statusLine,
  alertLine,
  isPermanentError,
  MAX_ATTEMPTS,
  RETRY_MINUTES,
} from './notify.config';

describe('toE164India', () => {
  it.each([
    ['9876543210', '919876543210'],
    ['98765 43210', '919876543210'],
    ['+91-98765-43210', '919876543210'],
    ['09876543210', '919876543210'],
    ['919876543210', '919876543210'],
    ['+44 7911 123456', '447911123456'],
  ])('%s → %s', (raw, e164) => expect(toE164India(raw)).toBe(e164));

  it.each(['', null, undefined, '12345', '1234567890', '0731123456', 'abc'])(
    'rejects %p rather than guessing a recipient',
    (raw) => expect(toE164India(raw as any)).toBeNull(),
  );
});

describe('templates (Meta rules)', () => {
  const all = Object.values(TEMPLATES);
  it('never start or end with a variable', () => {
    for (const t of all) {
      expect(t.text.trim().startsWith('{{')).toBe(false);
      expect(t.text.trim().endsWith('}}')).toBe(false);
    }
  });
  it('variables are numbered 1..n with no gaps, matching the documented list', () => {
    for (const t of all) {
      const nums = [...t.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
        Number(m[1]),
      );
      expect(nums).toEqual(nums.map((_, i) => i + 1));
      expect(nums.length).toBe(t.vars.length);
    }
  });
  it('no two variables side by side', () => {
    for (const t of all) expect(/\}\}\s*\{\{/.test(t.text)).toBe(false);
  });
  it('names are lowercase with underscores', () => {
    for (const t of all) expect(t.name).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('cleanParam', () => {
  it('strips newlines, tabs and long runs of spaces (Meta rejects them)', () => {
    expect(cleanParam('Ring\n twice\t    please')).toBe('Ring twice please');
  });
  it('never sends an empty variable', () => {
    expect(cleanParam('')).toBe('-');
    expect(cleanParam(null)).toBe('-');
  });
  it('caps length', () => {
    expect(cleanParam('x'.repeat(500))).toHaveLength(300);
  });
});

describe('wording', () => {
  it('first name only, with a friendly fallback', () => {
    expect(firstName('Riya Shah')).toBe('Riya');
    expect(firstName('')).toBe('there');
  });
  it('clock in IST', () => {
    expect(clock(new Date(Date.UTC(2026, 9, 23, 7, 45)))).toBe('1:15 pm');
  });
  it('status lines: quiet for internal steps, Porter link when present', () => {
    expect(statusLine('food_ready', { cooking: true })).toBeNull();
    expect(statusLine('assigned_to_delivery', { cooking: true })).toBeNull();
    expect(statusLine('preparing_food', { cooking: false })).toBeNull();
    expect(statusLine('preparing_food', { cooking: true })).toMatch(/cooking/);
    expect(
      statusLine('out_for_delivery', { riderName: 'Ramesh', cooking: true }),
    ).toBe('it is on its way with Ramesh');
    expect(
      statusLine('out_for_delivery', {
        porter: true,
        porterLink: 'https://porter.in/t/1',
        cooking: true,
      }),
    ).toContain('https://porter.in/t/1');
    expect(statusLine('delivered', { cooking: true })).toMatch(/delivered/);
    expect(statusLine('cancelled', { cooking: true })).toMatch(/refunded/);
  });
  it('alert lines', () => {
    expect(
      alertLine('new_order', { total: 348, items: 3, area: 'Vijay Nagar' }),
    ).toBe('new order, ₹348, 3 items, Vijay Nagar. Please accept it');
    expect(alertLine('not_accepted', { minutes: 4 })).toMatch(/4 min/);
    expect(alertLine('ready_no_carrier', { minutes: 6 })).toMatch(/6 min/);
    expect(alertLine('book_porter', {})).toMatch(/Porter/);
  });
});

describe('settings', () => {
  it('everything is off until switched on', () => {
    expect(DEFAULT_NOTIFY.customerEnabled).toBe(false);
    expect(DEFAULT_NOTIFY.staffEnabled).toBe(false);
  });
  it('staff phones: any format in, valid unique E.164 out, junk dropped', () => {
    const c = normalizeNotify({
      staffPhones: ['99930 60222', '+91 9993060222', '123', '9827012345'],
    });
    expect(c.staffPhones).toEqual(['919993060222', '919827012345']);
    expect(
      normalizeNotify({ staffPhones: '9993060222, 9827012345' }).staffPhones,
    ).toHaveLength(2);
  });
  it('booleans and numbers coerce; thresholds capped', () => {
    const c = normalizeNotify({
      customerEnabled: 'true',
      notAcceptedMin: '5',
      readyNoCarrierMin: 9999,
    });
    expect(c.customerEnabled).toBe(true);
    expect(c.notAcceptedMin).toBe(5);
    expect(c.readyNoCarrierMin).toBe(240);
  });
});

describe('retries', () => {
  it('rate limits and unknown errors are retried; bad numbers and templates are not', () => {
    for (const c of [130429, 131048, 131056, 131000, undefined])
      expect(isPermanentError(c)).toBe(false);
    for (const c of [131026, 131047, 132000, 132001, 132015, 133010])
      expect(isPermanentError(c)).toBe(true);
  });
  it('gives up after the retry schedule is used up', () => {
    expect(MAX_ATTEMPTS).toBe(RETRY_MINUTES.length + 1);
  });
});

import { NotifyService } from './notify.service';
describe('area hint for kitchen alerts', () => {
  it.each([
    ['12, Scheme No 78, Vijay Nagar, Indore, Near C21 Mall', 'Vijay Nagar'],
    ['304, BRK Business Park, AB Road, Indore', 'AB Road'],
    ['Flat 2, Sudama Nagar, Indore 452009', 'Sudama Nagar'],
    ['Annapurna Road', 'Annapurna Road'],
    ['12, Opp. Malhar Mega Mall', null],
    ['', null],
  ])('%s → %s', (addr, area) =>
    expect(NotifyService.localityHint(addr)).toBe(area),
  );
});

describe('statusLine for takeaway', () => {
  const ctx = { cooking: true, pickupAt: 'Bhawarkua', pickupCode: '4821' };
  it('tells the customer where and the code when ready', () => {
    expect(statusLine('food_ready', ctx)).toBe('it is ready for pickup at Bhawarkua. Show code 4821 at the counter');
  });
  it('says picked up, not delivered', () => {
    expect(statusLine('delivered', ctx)).toMatch(/picked up/);
  });
  it('a delivery order still gets no "ready" message', () => {
    expect(statusLine('food_ready', { cooking: true })).toBeNull();
  });
});
