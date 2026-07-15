import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { verifyAdminJwt } from './admin-auth.guard';
import { verifyRiderJwt } from './rider-auth.guard';

/**
 * Global write-protection guard.
 *
 * The storefront reads data anonymously from the browser (categories,
 * products, banners, a user's own orders/addresses...), so GET stays public.
 *
 * Anything that CHANGES data (POST / PATCH / PUT / DELETE) must carry the
 * admin key in the `x-admin-key` header (or `Authorization: Bearer <key>`),
 * matching the ADMIN_API_KEY env var. A short allow-list keeps the few
 * customer-facing writes (login, placing an order, saving your profile,
 * hearting an item, writing a review, validating a coupon) open.
 *
 * Set ADMIN_API_KEY on Render, and NEXT_PUBLIC/-side callers that need admin
 * (the /admin dashboard) send the same value.
 */
@Injectable()
export class AdminWriteGuard implements CanActivate {
  // customer-facing writes that must stay open (matched as path prefixes, sans /api)
  private readonly publicWrites: { method: string; path: RegExp }[] = [
    { method: 'POST', path: /^\/delivery-partners\/login$/ },
    // P0-2: `POST /orders` REMOVED from this list. It accepted a client-supplied
    // userId/subtotal/total with no auth. Customers order via /checkout.
    { method: 'POST', path: /^\/orders\/checkout$/ },        // checkout flow
    { method: 'POST', path: /^\/orders\/create-payment$/ },  // open razorpay order
    { method: 'POST', path: /^\/orders\/razorpay-webhook$/ }, // Razorpay server → us (signature-verified in controller)
    { method: 'POST', path: /^\/orders\/[^/]+\/cancel$/ },      // customer cancels own order (user-token verified)
    // P0-1 / P0-3: `PATCH /orders/:id/status` and `PATCH /delivery-partners/:id/location`
    // REMOVED. Their only credential was the rider's sequential integer id, which
    // we hand to every customer in the /track payload. Both now sit behind
    // RiderAuthGuard (x-rider-token) at the controller.
    { method: 'POST', path: /^\/addresses$/ },              // add my address
    { method: 'PATCH', path: /^\/addresses\/[^/]+$/ },      // edit my address
    { method: 'DELETE', path: /^\/addresses\/[^/]+$/ },     // delete my address
    { method: 'POST', path: /^\/favorites\/toggle$/ },      // heart/un-heart
    { method: 'POST', path: /^\/reviews$/ },                // write a review
    { method: 'DELETE', path: /^\/reviews\/[^/]+$/ },       // delete my review
    { method: 'POST', path: /^\/coupons\/validate$/ },      // check a coupon code
    { method: 'POST', path: /^\/support-tickets$/ },        // contact support
    { method: 'POST', path: /^\/admin-users\/login$/ },     // admin email+password login
    { method: 'POST', path: /^\/admin-users\/seed$/ },      // one-time bootstrap (secret-gated)
    { method: 'POST', path: /^\/referrals\/claim$/ },       // new user enters a friend's code
    { method: 'POST', path: /^\/thali-templates\/[^/]+\/price-check$/ }, // customer thali price validation (read-effect)
    { method: 'POST', path: /^\/scratch-cards\/[^/]+\/scratch$/ },       // customer reveals their scratch card
  ];

  /**
   * BUGFIX — riders got "Admin key required for this operation" on every action
   * (start delivery, mark delivered, GPS ping, doorstep QR).
   *
   * Root cause: these routes were deliberately moved behind RiderAuthGuard at
   * the controller, and removed from publicWrites above. But THIS guard is an
   * APP_GUARD — it runs BEFORE any controller-level guard. So the request was
   * rejected here and RiderAuthGuard never got the chance to authorise it.
   *
   * Fix: recognise rider-owned write routes and let them through *only* when
   * the request carries a VALID signed rider token. The controller's
   * RiderAuthGuard then still enforces "you can only act as yourself", so this
   * is not a loosening of access — it just stops the outer guard from
   * pre-empting the inner one.
   */
  private readonly riderWrites: { method: string; path: RegExp }[] = [
    { method: 'PATCH', path: /^\/orders\/[^/]+\/status$/ },              // start delivery / mark delivered
    { method: 'POST', path: /^\/orders\/[^/]+\/collect\/qr$/ },          // doorstep UPI QR
    { method: 'POST', path: /^\/orders\/[^/]+\/collect\/cancel$/ },      // cancel that QR
    { method: 'PATCH', path: /^\/delivery-partners\/[^/]+\/location$/ },  // GPS ping
  ];

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const method = req.method.toUpperCase();

    // reads are always allowed
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

    // strip the global /api prefix for matching
    const path = (req.path || req.url).replace(/^\/api/, '').split('?')[0];

    // customer-facing writes stay open
    if (this.publicWrites.some((r) => r.method === method && r.path.test(path))) {
      return true;
    }

    // Rider-owned writes: pass through when a VALID rider token is present.
    // The controller's RiderAuthGuard still verifies identity + ownership.
    if (this.riderWrites.some((r) => r.method === method && r.path.test(path))) {
      const riderTok = (req.headers['x-rider-token'] as string) || '';
      if (riderTok && verifyRiderJwt(riderTok)) return true;
      // no/invalid rider token → fall through so admins can still dispatch
      // manually with the admin key (break-glass).
    }

    // everything else that writes needs the admin key
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      // Fail closed: if the key isn't configured, block admin writes rather
      // than leaving them wide open. Set ADMIN_API_KEY on the server.
      throw new UnauthorizedException(
        'Admin API key not configured on the server.',
      );
    }
    const bearer = (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '';
    const header = (req.headers['x-admin-key'] as string) || bearer || '';

    // 1) shared master key (break-glass) still works
    if (header && header === expected) return true;

    // 2) a valid per-admin JWT is also accepted for writes. This is what
    //    allows the browser to stop carrying the master key: once every admin
    //    logs in and sends a Bearer token, remove the key from the frontend.
    if (bearer && verifyAdminJwt(bearer)) return true;

    throw new UnauthorizedException('Admin key required for this operation.');
  }
}
