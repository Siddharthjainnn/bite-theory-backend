import {
  CanActivate, ExecutionContext, Injectable, ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Request } from 'express';
import { verifyAdminJwt } from './admin-auth.guard';

/**
 * AdminSectionGuard — real, server-side enforcement of the per-role module
 * access that a super_admin configures in Admin → Roles & Access.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin frontend hides sidebar sections a role may not use, but hiding a
 * button is not security: a Kitchen Manager could still call /api/payments
 * directly and read finance data. Only 3 of ~30 controllers had any role check
 * at all.
 *
 * This guard closes that gap WITHOUT decorating 30 controllers by hand: it maps
 * the request URL to a section key, then asks the DB whether the caller's role
 * is allowed that section — the exact same `roles.sections` rows the UI edits.
 * Change access in the UI, and the API obeys immediately. No redeploy.
 *
 * DELIBERATE ESCAPE HATCHES
 * -------------------------
 *  - The shared ADMIN_API_KEY (break-glass) always passes.
 *  - super_admin always passes — you can never lock yourself out.
 *  - A role with NO sections row configured passes (falls back to the app's
 *    built-in defaults), so existing installs keep working until someone
 *    deliberately customises a role.
 *  - Non-admin traffic (customers, riders) is untouched: it has no admin JWT,
 *    so this guard ignores it and the existing guards do their job.
 */

/** URL prefix (sans /api) → the sidebar section key that owns it. */
const PATH_SECTION: { path: RegExp; section: string }[] = [
  { path: /^\/orders\/[^/]+\/refund/, section: 'payments' },
  { path: /^\/order-items/, section: 'order_items' },
  { path: /^\/orders/, section: 'orders' },
  { path: /^\/products/, section: 'products' },
  { path: /^\/categories/, section: 'categories' },
  { path: /^\/inventory/, section: 'inventory' },
  { path: /^\/thali/, section: 'thali' },
  { path: /^\/users/, section: 'users' },
  { path: /^\/reviews/, section: 'reviews' },
  { path: /^\/addresses/, section: 'addresses' },
  { path: /^\/favorites/, section: 'favorites' },
  { path: /^\/support-tickets/, section: 'support_tickets' },
  { path: /^\/notifications/, section: 'notifications' },
  { path: /^\/coupon-assignments/, section: 'coupon_assign' },
  { path: /^\/coupons/, section: 'coupons' },
  { path: /^\/campaigns/, section: 'campaigns' },
  { path: /^\/banners/, section: 'banners' },
  { path: /^\/referrals/, section: 'referrals' },
  { path: /^\/loyalty-points/, section: 'loyalty_points' },
  { path: /^\/payments/, section: 'payments' },
  { path: /^\/wallet-transactions/, section: 'wallet_transactions' },
  { path: /^\/delivery-partners/, section: 'delivery_partners' },
  { path: /^\/settings/, section: 'settings' },
  { path: /^\/roles/, section: 'roles' },
  { path: /^\/permissions/, section: 'permissions' },
  { path: /^\/admin-users/, section: 'admin_users' },
  { path: /^\/audit-logs/, section: 'audit_logs' },
];

@Injectable()
export class AdminSectionGuard implements CanActivate {
  /** Cache role→sections briefly so we don't hit the DB on every request. */
  private cache: { at: number; map: Record<string, string[]> } | null = null;
  private static readonly TTL_MS = 30_000;

  constructor(private readonly dataSource: DataSource) {}

  private async sectionsFor(role: string): Promise<string[] | null> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > AdminSectionGuard.TTL_MS) {
      const rows = await this.dataSource.query(
        `SELECT name, sections FROM roles WHERE sections IS NOT NULL`);
      const map: Record<string, string[]> = {};
      for (const r of rows) {
        const key = String(r.name || '').trim().toLowerCase().replace(/\s+/g, '_');
        if (key && Array.isArray(r.sections) && r.sections.length) {
          map[key] = r.sections;
        }
      }
      this.cache = { at: now, map };
    }
    return this.cache.map[role] ?? null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();

    // break-glass: the shared master key bypasses section checks
    const master = process.env.ADMIN_API_KEY;
    const headerKey =
      (req.headers['x-admin-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '';
    if (master && headerKey === master) return true;

    // Only applies to callers holding an admin JWT. Customers/riders carry no
    // admin token, so they fall through to their own guards untouched.
    const payload = verifyAdminJwt(
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '');
    if (!payload) return true;

    const role = (payload.role || '').toLowerCase();
    if (!role || role === 'super_admin') return true;

    const allowed = await this.sectionsFor(role);
    if (!allowed) return true; // no custom config → built-in defaults apply

    const path = (req.path || req.url).replace(/^\/api/, '').split('?')[0];
    const hit = PATH_SECTION.find((m) => m.path.test(path));
    if (!hit) return true; // unmapped route (health checks, etc.)

    if (!allowed.includes(hit.section)) {
      throw new ForbiddenException(
        `Your role (${role}) does not have access to ${hit.section.replace(/_/g, ' ')}. ` +
        `A super admin can grant it in Admin → Roles & Access.`,
      );
    }
    return true;
  }
}
