import {
  DEFAULT_STOREFRONT,
  launchPhase,
  mergeStorefront,
  normalizeStorefront,
  safeInstant,
  safeUrl,
} from './storefront.config';

describe('storefront config', () => {
  it('defaults: Bhawarkua launch on 21 Nov 2026, Zomato tile first', () => {
    const c = normalizeStorefront(null);
    expect(c.launch.area).toBe('Bhawarkua');
    expect(new Date(c.launch.opensAt).toISOString()).toBe(
      '2026-11-21T05:30:00.000Z',
    );
    expect(c.platforms.map((p) => p.key)).toEqual([
      'zomato',
      'swiggy',
      'toing',
    ]);
    expect(c.priceCompare).toBe(true);
  });

  it('keeps the owner tile order, drops unknown/duplicate keys, appends missing ones switched off', () => {
    const c = normalizeStorefront({
      platforms: [
        { key: 'toing', url: 'https://toing.example/m', enabled: true },
        { key: 'ubereats', url: 'https://x.example' },
        { key: 'toing', url: 'https://dup.example' },
        {
          key: 'zomato',
          url: 'https://www.zomato.com/indore/x/order',
          enabled: false,
        },
      ],
    });
    expect(c.platforms.map((p) => [p.key, p.enabled])).toEqual([
      ['toing', true],
      ['zomato', false],
      ['swiggy', false],
    ]);
    expect(c.platforms[0].name).toBe('Toing');
  });

  it('only https links survive (no javascript:, no http:)', () => {
    expect(safeUrl('https://www.zomato.com/x')).toBe(
      'https://www.zomato.com/x',
    );
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('http://insecure.example')).toBe('');
    expect(safeUrl('not a url')).toBe('');
    expect(
      normalizeStorefront({ launch: { mapsUrl: 'javascript:x' } }).launch
        .mapsUrl,
    ).toBe('');
  });

  it('opening time: a bare datetime-local value is read as IST; junk keeps the old value', () => {
    expect(new Date(safeInstant('2026-11-21T11:00', 'x')).toISOString()).toBe(
      '2026-11-21T05:30:00.000Z',
    );
    expect(safeInstant('garbage', DEFAULT_STOREFRONT.launch.opensAt)).toBe(
      DEFAULT_STOREFRONT.launch.opensAt,
    );
  });

  it('text is trimmed and capped; booleans coerce', () => {
    const c = normalizeStorefront({
      launch: {
        area: '  Bhawarkua   Square  ',
        badge: 'x'.repeat(99),
        enabled: 'false',
      },
      priceCompare: 'false',
    });
    expect(c.launch.area).toBe('Bhawarkua Square');
    expect(c.launch.badge).toHaveLength(30);
    expect(c.launch.enabled).toBe(false);
    expect(c.priceCompare).toBe(false);
  });

  it('a partial edit merges field by field', () => {
    const cur = normalizeStorefront({
      launch: { area: 'Bhawarkua', city: 'Indore' },
    });
    const next = mergeStorefront(cur, {
      launch: { opensAt: '2026-11-22T12:00' },
    });
    expect(next.launch.area).toBe('Bhawarkua');
    expect(new Date(next.launch.opensAt).toISOString()).toBe(
      '2026-11-22T06:30:00.000Z',
    );
    expect(next.platforms).toHaveLength(3);
  });

  it('phase: before / open / off', () => {
    const l = normalizeStorefront(null).launch;
    const at = Date.parse(l.opensAt);
    expect(launchPhase(l, at - 1)).toBe('before');
    expect(launchPhase(l, at)).toBe('open');
    expect(launchPhase({ ...l, enabled: false }, at)).toBe('off');
  });

  it('Zomato rating: off until a real value is entered; out-of-range values are dropped', () => {
    expect(normalizeStorefront(null).zomatoRating).toEqual({
      enabled: false,
      value: 0,
      count: 0,
    });
    expect(
      normalizeStorefront({
        zomatoRating: { enabled: true, value: '4.27', count: '712' },
      }).zomatoRating,
    ).toEqual({ enabled: true, value: 4.3, count: 712 });
    expect(
      normalizeStorefront({ zomatoRating: { enabled: true, value: 7 } })
        .zomatoRating.enabled,
    ).toBe(false);
    expect(
      normalizeStorefront({
        zomatoRating: { enabled: true, value: 4, count: -5 },
      }).zomatoRating.count,
    ).toBe(0);
  });
});
