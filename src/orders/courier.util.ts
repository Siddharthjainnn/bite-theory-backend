/**
 * External courier dispatch — pure rules, no I/O, so they are unit-tested.
 *
 * The kitchen has two ways to get food out of the door:
 *   in_house — one of our riders (delivery_partners), paid per drop.
 *   porter   — a Porter two-wheeler the admin books on porter.in.
 *
 * The admin books Porter by hand today: they copy the pickup and drop details
 * from our panel into Porter's form, then paste Porter's booking back here.
 * Everything below exists to make that round trip fast and impossible to get
 * wrong — and to make it a straight swap for Porter's API later
 * (Create Order needs exactly these lat/lng pairs and refuses COD).
 */

export const PROVIDERS = ['in_house', 'porter', 'other'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** True when someone other than our own rider is carrying the order. */
export const isExternal = (p?: string | null) => !!p && p !== 'in_house';

/**
 * Statuses where booking a courier makes sense.
 *
 * Booking WHILE COOKING is the point: a Porter driver takes 8–15 minutes to
 * reach the kitchen, so booking at "food ready" leaves the food sitting there
 * going cold. order_received is excluded — never book a driver for an order
 * the kitchen has not accepted yet.
 */
export const BOOKABLE_STATUSES = [
  'order_confirmed', 'preparing_food', 'food_ready', 'assigned_to_delivery',
];

/** Once the food has physically left, the booking can't be undone from here. */
export const CANCELLABLE_BOOKING_STATUSES = [
  'order_confirmed', 'preparing_food', 'food_ready', 'assigned_to_delivery',
];

export function bookingError(status: string): string | null {
  if (['delivered', 'cancelled'].includes(status)) return `Order is already ${status}.`;
  if (status === 'order_received') return 'Accept the order before booking a delivery.';
  if (!BOOKABLE_STATUSES.includes(status)) {
    return 'The food has already left the kitchen. Update the booking details instead of re-booking.';
  }
  return null;
}

export interface DispatchInput {
  orderNumber: string;
  status: string;
  total: number;
  walletUsed: number;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryInstructions: string | null;
  customer: { name: string | null; mobile: string | null };
  address: { landmark: string | null; pincode: string | null; city: string | null } | null;
  store: {
    name: string | null; phone: string | null; address: string | null;
    lat: number | null; lng: number | null;
  };
  payment: { method: string | null; status: string | null } | null;
}

export interface DispatchSheet {
  orderNumber: string;
  pickup: {
    name: string; phone: string; address: string;
    lat: number | null; lng: number | null; latLng: string; mapsUrl: string | null;
  };
  drop: {
    name: string; mobile: string; address: string; landmark: string;
    pincode: string; instructions: string;
    lat: number | null; lng: number | null; latLng: string; mapsUrl: string | null;
  };
  cod: { isCod: boolean; amountToCollect: number };
  warnings: string[];
  /** One block to paste into a WhatsApp / Porter notes field. */
  copyAll: string;
}

const clean = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();

/** "22.7196, 75.8577" — the exact shape Porter's and Google's search boxes accept. */
export function formatLatLng(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    return '';
  }
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}

export function mapsUrl(lat?: number | null, lng?: number | null): string | null {
  const ll = formatLatLng(lat, lng);
  return ll ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll.replace(' ', ''))}` : null;
}

export function buildDispatchSheet(i: DispatchInput): DispatchSheet {
  const warnings: string[] = [];

  const isCod = i.payment?.method === 'cod' && i.payment?.status === 'pending';
  const amountToCollect = isCod ? Math.max(Number(i.total) - Number(i.walletUsed || 0), 0) : 0;
  if (isCod) {
    warnings.push(
      `Cash order: ₹${amountToCollect.toFixed(0)} to collect. Porter does not collect cash — ` +
      `get the customer to pay by UPI first, or send your own rider.`);
  }
  if (i.deliveryLat == null || i.deliveryLng == null) {
    warnings.push('No pin on the customer address. Call the customer to confirm the exact location.');
  }
  if (i.store.lat == null || i.store.lng == null) {
    warnings.push('Kitchen pin is not set. Add it in Settings → Store so pickup is exact.');
  }
  if (!i.customer.mobile) warnings.push('Customer has no mobile number on file.');

  const pickup = {
    name: clean(i.store.name) || 'Bite Theory Kitchen',
    phone: clean(i.store.phone),
    address: clean(i.store.address),
    lat: i.store.lat, lng: i.store.lng,
    latLng: formatLatLng(i.store.lat, i.store.lng),
    mapsUrl: mapsUrl(i.store.lat, i.store.lng),
  };
  const drop = {
    name: clean(i.customer.name) || 'Customer',
    mobile: clean(i.customer.mobile),
    address: clean(i.deliveryAddress),
    landmark: clean(i.address?.landmark),
    pincode: clean(i.address?.pincode),
    instructions: clean(i.deliveryInstructions),
    lat: i.deliveryLat, lng: i.deliveryLng,
    latLng: formatLatLng(i.deliveryLat, i.deliveryLng),
    mapsUrl: mapsUrl(i.deliveryLat, i.deliveryLng),
  };

  const line = (label: string, v: string) => (v ? `${label}: ${v}` : null);
  const copyAll = [
    `Order ${i.orderNumber}`,
    '— PICKUP —',
    pickup.name,
    line('Phone', pickup.phone),
    line('Address', pickup.address),
    line('Pin', pickup.latLng),
    '— DROP —',
    drop.name,
    line('Mobile', drop.mobile),
    line('Address', drop.address),
    line('Landmark', drop.landmark),
    line('Pincode', drop.pincode),
    line('Pin', drop.latLng),
    line('Map', drop.mapsUrl || ''),
    line('Note', drop.instructions),
    isCod ? `CASH TO COLLECT: ₹${amountToCollect.toFixed(0)}` : 'PREPAID — collect nothing',
  ].filter(Boolean).join('\n');

  return {
    orderNumber: i.orderNumber, pickup, drop,
    cod: { isCod, amountToCollect }, warnings, copyAll,
  };
}

/** Customer-facing courier block for the tracking page. Never leaks our fee. */
export function publicCourier(o: {
  deliveryProvider?: string | null; externalRiderName?: string | null;
  externalRiderPhone?: string | null; externalTrackingUrl?: string | null;
}) {
  if (!isExternal(o.deliveryProvider)) return null;
  return {
    provider: o.deliveryProvider,
    label: o.deliveryProvider === 'porter' ? 'Porter' : 'Delivery partner',
    riderName: o.externalRiderName || null,
    riderPhone: o.externalRiderPhone || null,
    trackingUrl: safeTrackingUrl(o.externalTrackingUrl),
  };
}

/** Only https links — this string is rendered as a link on the customer page. */
export function safeTrackingUrl(u?: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === 'https:' ? url.toString() : null;
  } catch { return null; }
}
