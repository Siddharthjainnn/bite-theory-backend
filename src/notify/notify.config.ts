/**
 * WhatsApp notifications — pure rules, no I/O, unit-tested.
 *
 * Meta only lets a business START a conversation with a pre-approved
 * template. These are the four templates this code sends; submit them in
 * WhatsApp Manager → Message templates, category UTILITY, language English,
 * with exactly these names and variables (see docs/WHATSAPP_SETUP.md).
 * Meta rejects templates that start or end with a variable, so every text
 * ends with words.
 */

export const TEMPLATES = {
  /** customer, right after checkout */
  orderPlaced: {
    name: 'bt_order_placed',
    vars: [
      'customer name',
      'order number',
      'amount',
      'expected delivery',
      'tracking link',
    ],
    text: 'Hi {{1}}, thanks for ordering from Bite Theory! Your order {{2}} for ₹{{3}} is confirmed. Expected delivery: {{4}}. Track your order here: {{5}} — Team Bite Theory',
  },
  /** customer, on the moments that matter (cooking, on the way, delivered, cancelled, make-good) */
  orderUpdate: {
    name: 'bt_order_update',
    vars: ['customer name', 'order number', 'what happened', 'tracking link'],
    text: 'Hi {{1}}, an update on your Bite Theory order {{2}}: {{3}}. Track your order here: {{4}} — Team Bite Theory',
  },
  /** customer, before they notice a delay */
  orderDelayed: {
    name: 'bt_order_delayed',
    vars: ['customer name', 'order number', 'new expected time'],
    text: 'Hi {{1}}, sorry, your Bite Theory order {{2}} is running a little late. It is now expected around {{3}}. We are getting it to you as fast as we can.',
  },
  /** owner + staff */
  kitchenAlert: {
    name: 'bt_kitchen_alert',
    vars: ['order number', 'what needs doing', 'admin link'],
    text: 'Bite Theory kitchen alert for order {{1}}: {{2}}. Open Live Orders: {{3}} to act on it.',
  },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/* ─────────────────────────── settings ─────────────────────────── */

export interface NotifyConfig {
  customerEnabled: boolean; // order updates to customers
  customerCooking: boolean; // include the "cooking started" message (costs one more per order)
  staffEnabled: boolean; // kitchen alerts to staffPhones
  staffPhones: string[]; // owner + staff, any Indian format
  alertNewOrder: boolean;
  notAcceptedMin: number; // alert when an order waits this long for Accept (0 = off)
  readyNoCarrierMin: number; // alert when food is ready this long with no rider or Porter (0 = off)
  alertBookPorter: boolean; // alert at the moment the planner says "book Porter now"
  alertRunningLate: boolean; // alert when a customer gets a delay apology
}

export const DEFAULT_NOTIFY: NotifyConfig = {
  customerEnabled: false, // off until the templates are approved
  customerCooking: true,
  staffEnabled: false,
  staffPhones: [],
  alertNewOrder: true,
  notAcceptedMin: 3,
  readyNoCarrierMin: 5,
  alertBookPorter: true,
  alertRunningLate: true,
};

export function normalizeNotify(raw: unknown): NotifyConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: NotifyConfig = {
    ...DEFAULT_NOTIFY,
    staffPhones: [...DEFAULT_NOTIFY.staffPhones],
  };
  for (const k of Object.keys(DEFAULT_NOTIFY) as (keyof NotifyConfig)[]) {
    const v = r[k];
    if (v === undefined || v === null || v === '') continue;
    if (k === 'staffPhones') {
      const list = Array.isArray(v) ? v : String(v).split(/[,\n]/);
      out.staffPhones = [
        ...new Set(
          list
            .map((p) => toE164India(String(p)))
            .filter((p): p is string => !!p),
        ),
      ].slice(0, 10);
    } else if (typeof DEFAULT_NOTIFY[k] === 'boolean') {
      (out as any)[k] = v === true || v === 'true';
    } else if (Number.isFinite(Number(v)) && Number(v) >= 0) {
      (out as any)[k] = Math.min(240, Number(v));
    }
  }
  return out;
}

/* ─────────────────────────── phones + text ─────────────────────────── */

/**
 * Indian mobile in any common format → WhatsApp's E.164 digits ("919876543210").
 * 98765 43210 · +91-98765-43210 · 09876543210 · 919876543210 all work.
 * Anything that isn't a plausible number → null (never guess a recipient).
 */
export function toE164India(raw?: string | null): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) {
    return /^[6-9]/.test(d) ? `91${d}` : null; // Indian mobiles start 6-9
  }
  if (d.length === 12 && d.startsWith('91'))
    return /^91[6-9]/.test(d) ? d : null;
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d; // other countries, already with code
  return null;
}

/** Template variables may not contain newlines, tabs or 4+ spaces, and must not be empty. */
export function cleanParam(v: unknown, fallback = '-'): string {
  const s = String(v ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 300);
  return s || fallback;
}

export function firstName(full?: string | null): string {
  const n = cleanParam(full, '').split(' ')[0];
  return n || 'there';
}

export function money(n: number): string {
  return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function clock(at: Date, timeZone = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  })
    .format(at)
    .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);
}

/** What to tell the customer for a status change; null = stay quiet. */
export function statusLine(
  status: string,
  ctx: {
    riderName?: string | null;
    porter?: boolean;
    porterLink?: string | null;
    cooking: boolean;
  },
): string | null {
  switch (status) {
    case 'preparing_food':
      return ctx.cooking ? 'the kitchen has started cooking it' : null;
    case 'out_for_delivery':
      if (ctx.porter)
        return ctx.porterLink
          ? `it is on its way with Porter, live tracking ${ctx.porterLink}`
          : 'it is on its way with our Porter delivery partner';
      return ctx.riderName
        ? `it is on its way with ${ctx.riderName}`
        : 'it is on its way';
    case 'delivered':
      return 'it has been delivered. Enjoy your meal';
    case 'cancelled':
      return 'it has been cancelled. Any payment will be refunded';
    default:
      return null;
  }
}

/** Staff alert wording per kind. */
export function alertLine(
  kind: string,
  d: {
    minutes?: number;
    total?: number;
    items?: number;
    area?: string | null;
    when?: string;
  },
): string {
  switch (kind) {
    case 'new_order':
      return `new order, ₹${money(d.total ?? 0)}, ${d.items ?? 0} item${d.items === 1 ? '' : 's'}${d.area ? `, ${d.area}` : ''}. Please accept it`;
    case 'not_accepted':
      return `not accepted yet, the customer has waited ${d.minutes} min`;
    case 'ready_no_carrier':
      return `food has been ready ${d.minutes} min with no rider or Porter`;
    case 'book_porter':
      return 'no own rider is free in time, book a Porter now';
    case 'running_late':
      return `running late, the customer was told around ${d.when}`;
    default:
      return kind.replace(/_/g, ' ');
  }
}

/** Retry schedule: 30 s, 2 min, 10 min, 30 min, then give up. */
export const RETRY_MINUTES = [0.5, 2, 10, 30];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

/**
 * Meta Cloud API error codes that a quick retry cannot fix (per Meta's error
 * code reference): bad parameters, recipient can't receive WhatsApp, 24 h
 * window, template missing/paused/disabled/malformed, number not registered,
 * payment method problem, and 131049 (Meta asks to wait 24 h). Rate limits
 * (130429, 131048, 131056) and unknown errors (131000) ARE retried.
 */
export const PERMANENT_ERRORS = [
  100, 131026, 131042, 131047, 131049, 131051, 132000, 132001, 132005, 132007,
  132012, 132015, 132016, 133010,
];
export function isPermanentError(code?: number | null): boolean {
  return code != null && PERMANENT_ERRORS.includes(Number(code));
}
