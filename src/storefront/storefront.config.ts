/**
 * Storefront settings — pure rules, no I/O, unit-tested.
 *
 * Everything the customer home page shows that is not a product lives here,
 * so the owner changes it from Admin → Home page without a deploy:
 *   - launch banner (first outlet, Bhawarkua) with countdown and "Notify me"
 *   - whether dishes show their price on Zomato / Swiggy / Toing
 *   - the "You can also order from" tiles: order, links, on/off
 */

export interface LaunchConfig {
  enabled: boolean;
  badge: string; // "Coming soon"
  lead: string; // "Our first outlet is opening in"
  area: string; // big text: "Bhawarkua"
  city: string; // "Indore"
  opensAt: string; // ISO 8601 with offset
  showCountdown: boolean;
  buttonText: string; // "Notify me on opening day"
  smallPrint: string;
  openBadge: string; // shown from opensAt on
  openLead: string;
  mapsUrl: string; // optional "Get directions" after opening
  autoNotify: boolean; // WhatsApp the notify list at opensAt
}

export type PlatformKey = 'zomato' | 'swiggy' | 'toing';

export interface PlatformTile {
  key: PlatformKey;
  name: string;
  url: string;
  enabled: boolean;
}

export interface StorefrontConfig {
  launch: LaunchConfig;
  priceCompare: boolean;
  platforms: PlatformTile[];
}

export const PLATFORM_NAMES: Record<PlatformKey, string> = {
  zomato: 'Zomato',
  swiggy: 'Swiggy',
  toing: 'Toing',
};

export const DEFAULT_STOREFRONT: StorefrontConfig = {
  launch: {
    enabled: true,
    badge: 'Coming soon',
    lead: 'Our first outlet is opening in',
    area: 'Bhawarkua',
    city: 'Indore',
    opensAt: '2026-11-21T11:00:00+05:30',
    showCountdown: true,
    buttonText: 'Notify me on opening day',
    smallPrint:
      "We'll message you on WhatsApp the day we open. Delivery continues as usual.",
    openBadge: 'Now open',
    openLead: 'Our first outlet is now open in',
    mapsUrl: '',
    autoNotify: true,
  },
  priceCompare: true,
  platforms: [
    { key: 'zomato', name: 'Zomato', url: '', enabled: true },
    {
      key: 'swiggy',
      name: 'Swiggy',
      url: 'https://www.swiggy.com/menu/1429311?source=sharing',
      enabled: true,
    },
    {
      key: 'toing',
      name: 'Toing',
      url: 'https://www.toingit.com/menu/1429311?source=sharing',
      enabled: true,
    },
  ],
};

const str = (v: unknown, fallback: string, max = 160): string =>
  typeof v === 'string'
    ? v.replace(/\s+/g, ' ').trim().slice(0, max)
    : fallback;

const bool = (v: unknown, fallback: boolean): boolean =>
  v === undefined || v === null
    ? fallback
    : v === true || v === 'true' || v === 1 || v === '1';

/** Only real https links leave the server; anything else becomes '' (tile hidden). */
export function safeUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return '';
  }
}

/** A valid instant, else the fallback. Bare "2026-11-21T11:00" is read as IST. */
export function safeInstant(v: unknown, fallback: string): string {
  if (typeof v !== 'string' || !v.trim()) return fallback;
  let s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    if (s.length === 16) s += ':00';
    s += '+05:30';
  }
  return Number.isFinite(Date.parse(s)) ? s : fallback;
}

export function normalizeStorefront(raw: unknown): StorefrontConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const l = (
    r.launch && typeof r.launch === 'object' ? r.launch : {}
  ) as Record<string, unknown>;
  const d = DEFAULT_STOREFRONT.launch;
  const launch: LaunchConfig = {
    enabled: bool(l.enabled, d.enabled),
    badge: str(l.badge, d.badge, 30),
    lead: str(l.lead, d.lead, 80),
    area: str(l.area, d.area, 40),
    city: str(l.city, d.city, 40),
    opensAt: safeInstant(l.opensAt, d.opensAt),
    showCountdown: bool(l.showCountdown, d.showCountdown),
    buttonText: str(l.buttonText, d.buttonText, 40),
    smallPrint: str(l.smallPrint, d.smallPrint, 160),
    openBadge: str(l.openBadge, d.openBadge, 30),
    openLead: str(l.openLead, d.openLead, 80),
    mapsUrl: safeUrl(l.mapsUrl),
    autoNotify: bool(l.autoNotify, d.autoNotify),
  };

  /* tiles: keep the owner's order, drop unknown keys and repeats, add any
     missing platform at the end (switched off) so the admin can always find it */
  const seen = new Set<PlatformKey>();
  const platforms: PlatformTile[] = [];
  const list: unknown[] = Array.isArray(r.platforms)
    ? r.platforms
    : DEFAULT_STOREFRONT.platforms;
  for (const p of list) {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const key = o.key as PlatformKey;
    if (!(key in PLATFORM_NAMES) || seen.has(key)) continue;
    seen.add(key);
    platforms.push({
      key,
      name: PLATFORM_NAMES[key],
      url: safeUrl(o.url),
      enabled: bool(o.enabled, true),
    });
  }
  for (const def of DEFAULT_STOREFRONT.platforms) {
    if (!seen.has(def.key)) platforms.push({ ...def, enabled: false });
  }

  return {
    launch,
    priceCompare: bool(r.priceCompare, DEFAULT_STOREFRONT.priceCompare),
    platforms,
  };
}

/** Partial admin edits merge over what is stored (launch merges field by field). */
export function mergeStorefront(
  cur: unknown,
  patch: unknown,
): StorefrontConfig {
  const c = normalizeStorefront(cur);
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<
    string,
    any
  >;
  return normalizeStorefront({
    ...c,
    ...p,
    launch: {
      ...c.launch,
      ...(p.launch && typeof p.launch === 'object' ? p.launch : {}),
    },
  });
}

/** Where the launch is right now, for the opening-day sender. */
export function launchPhase(
  l: LaunchConfig,
  now = Date.now(),
): 'off' | 'before' | 'open' {
  if (!l.enabled) return 'off';
  return now < Date.parse(l.opensAt) ? 'before' : 'open';
}

/** The opening-day WhatsApp goes out only in the first 2 days after opening, never later by surprise. */
export const SEND_WINDOW_MS = 48 * 3600_000;
