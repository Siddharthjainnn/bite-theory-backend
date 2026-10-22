import {
  bookingError, buildDispatchSheet, formatLatLng, isExternal, mapsUrl,
  publicCourier, safeTrackingUrl, DispatchInput,
} from './courier.util';

const base = (over: Partial<DispatchInput> = {}): DispatchInput => ({
  orderNumber: 'BT-1042',
  status: 'preparing_food',
  total: 420,
  walletUsed: 20,
  deliveryAddress: '  12,  Scheme No 78,   Vijay Nagar, Indore ',
  deliveryLat: 22.7533, deliveryLng: 75.8937,
  deliveryInstructions: 'Ring twice',
  customer: { name: 'Riya Shah', mobile: '9876543210' },
  address: { landmark: 'Near C21 Mall', pincode: '452010', city: 'Indore' },
  store: { name: 'Bite Theory', phone: '9993060222', address: 'Palasia, Indore', lat: 22.7239, lng: 75.8857 },
  payment: { method: 'online', status: 'paid' },
  ...over,
});

describe('courier rules', () => {
  it('treats only non in_house providers as external', () => {
    expect(isExternal('porter')).toBe(true);
    expect(isExternal('other')).toBe(true);
    expect(isExternal('in_house')).toBe(false);
    expect(isExternal(null)).toBe(false);
    expect(isExternal(undefined)).toBe(false);
  });

  it('allows booking while cooking, blocks unaccepted and finished orders', () => {
    expect(bookingError('preparing_food')).toBeNull();
    expect(bookingError('food_ready')).toBeNull();
    expect(bookingError('order_confirmed')).toBeNull();
    expect(bookingError('assigned_to_delivery')).toBeNull();
    expect(bookingError('order_received')).toMatch(/Accept/);
    expect(bookingError('out_for_delivery')).toMatch(/already left/);
    expect(bookingError('delivered')).toMatch(/already delivered/);
    expect(bookingError('cancelled')).toMatch(/already cancelled/);
  });
});

describe('formatLatLng / mapsUrl', () => {
  it('formats to six decimals with comma-space', () => {
    expect(formatLatLng(22.7533, 75.8937)).toBe('22.753300, 75.893700');
  });
  it('returns empty for missing or non-numeric coordinates', () => {
    expect(formatLatLng(null, 75)).toBe('');
    expect(formatLatLng(22, undefined)).toBe('');
    expect(formatLatLng(NaN, 75)).toBe('');
    expect(mapsUrl(null, null)).toBeNull();
  });
  it('builds a Google Maps search link', () => {
    expect(mapsUrl(22.7533, 75.8937)).toBe(
      'https://www.google.com/maps/search/?api=1&query=22.753300%2C75.893700');
  });
});

describe('buildDispatchSheet', () => {
  it('cleans whitespace and fills pickup + drop', () => {
    const s = buildDispatchSheet(base());
    expect(s.drop.address).toBe('12, Scheme No 78, Vijay Nagar, Indore');
    expect(s.drop.landmark).toBe('Near C21 Mall');
    expect(s.drop.pincode).toBe('452010');
    expect(s.drop.latLng).toBe('22.753300, 75.893700');
    expect(s.pickup.name).toBe('Bite Theory');
    expect(s.pickup.latLng).toBe('22.723900, 75.885700');
    expect(s.warnings).toEqual([]);
  });

  it('prepaid orders collect nothing', () => {
    const s = buildDispatchSheet(base());
    expect(s.cod).toEqual({ isCod: false, amountToCollect: 0 });
    expect(s.copyAll).toContain('PREPAID — collect nothing');
  });

  it('flags unpaid cash orders with the amount net of wallet', () => {
    const s = buildDispatchSheet(base({ payment: { method: 'cod', status: 'pending' } }));
    expect(s.cod).toEqual({ isCod: true, amountToCollect: 400 });
    expect(s.warnings[0]).toMatch(/Porter does not collect cash/);
    expect(s.copyAll).toContain('CASH TO COLLECT: ₹400');
  });

  it('a COD order already paid (e.g. via doorstep QR) is not flagged', () => {
    const s = buildDispatchSheet(base({ payment: { method: 'cod', status: 'paid' } }));
    expect(s.cod.isCod).toBe(false);
  });

  it('warns when pins or mobile are missing', () => {
    const s = buildDispatchSheet(base({
      deliveryLat: null, deliveryLng: null,
      customer: { name: null, mobile: null },
      store: { name: null, phone: null, address: null, lat: null, lng: null },
    }));
    expect(s.warnings.join(' ')).toMatch(/No pin on the customer address/);
    expect(s.warnings.join(' ')).toMatch(/Kitchen pin is not set/);
    expect(s.warnings.join(' ')).toMatch(/no mobile number/);
    expect(s.drop.name).toBe('Customer');
    expect(s.pickup.name).toBe('Bite Theory Kitchen');
    expect(s.drop.mapsUrl).toBeNull();
  });

  it('copyAll omits empty lines instead of printing blank labels', () => {
    const s = buildDispatchSheet(base({ deliveryInstructions: null, address: null }));
    expect(s.copyAll).not.toMatch(/Landmark:/);
    expect(s.copyAll).not.toMatch(/Note:/);
    expect(s.copyAll).not.toMatch(/: \n/);
    expect(s.copyAll.startsWith('Order BT-1042')).toBe(true);
  });
});

describe('customer-facing courier block', () => {
  it('is null for our own riders', () => {
    expect(publicCourier({ deliveryProvider: 'in_house' })).toBeNull();
  });
  it('exposes driver + safe link for Porter', () => {
    expect(publicCourier({
      deliveryProvider: 'porter', externalRiderName: 'Amit',
      externalRiderPhone: '9000000000', externalTrackingUrl: 'https://porter.in/track/abc',
    })).toEqual({
      provider: 'porter', label: 'Porter', riderName: 'Amit',
      riderPhone: '9000000000', trackingUrl: 'https://porter.in/track/abc',
    });
  });
  it('drops non-https tracking links (rendered as a link on the customer page)', () => {
    expect(safeTrackingUrl('javascript:alert(1)')).toBeNull();
    expect(safeTrackingUrl('http://porter.in/x')).toBeNull();
    expect(safeTrackingUrl('not a url')).toBeNull();
    expect(safeTrackingUrl(' https://porter.in/t/1 ')).toBe('https://porter.in/t/1');
  });
});
