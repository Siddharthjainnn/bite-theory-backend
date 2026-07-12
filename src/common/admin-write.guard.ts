import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

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
    { method: 'POST', path: /^\/orders$/ },                  // place order (create)
    { method: 'POST', path: /^\/orders\/checkout$/ },        // checkout flow
    { method: 'POST', path: /^\/orders\/create-payment$/ },  // open razorpay order
    { method: 'POST', path: /^\/orders\/razorpay-webhook$/ }, // Razorpay server → us (signature-verified in controller)
    { method: 'POST', path: /^\/orders\/[^/]+\/cancel$/ },      // customer cancels own order (user-token verified)
    { method: 'POST', path: /^\/orders\/[^/]+\/accept$/ },   // rider accepts order
    { method: 'PATCH', path: /^\/orders\/[^/]+\/status$/ },  // rider updates status
    { method: 'PATCH', path: /^\/delivery-partners\/[^/]+\/location$/ },
    { method: 'POST', path: /^\/addresses$/ },              // add my address
    { method: 'PATCH', path: /^\/addresses\/[^/]+$/ },      // edit my address
    { method: 'DELETE', path: /^\/addresses\/[^/]+$/ },     // delete my address
    { method: 'POST', path: /^\/favorites\/toggle$/ },      // heart/un-heart
    { method: 'POST', path: /^\/reviews$/ },                // write a review
    { method: 'DELETE', path: /^\/reviews\/[^/]+$/ },       // delete my review
    { method: 'POST', path: /^\/coupons\/validate$/ },      // check a coupon code
    { method: 'POST', path: /^\/users$/ },                  // upsert on login
    { method: 'PATCH', path: /^\/users\/[^/]+$/ },          // save my profile/mobile
    { method: 'POST', path: /^\/support-tickets$/ },        // contact support
    { method: 'POST', path: /^\/admin-users\/login$/ },     // admin email+password login
    { method: 'POST', path: /^\/admin-users\/seed$/ },      // one-time bootstrap (secret-gated)
    { method: 'POST', path: /^\/referrals\/claim$/ },       // new user enters a friend's code
    { method: 'POST', path: /^\/thali-templates\/[^/]+\/price-check$/ }, // customer thali price validation (read-effect)
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

    // everything else that writes needs the admin key
    const expected = process.env.ADMIN_API_KEY;
    if (!expected) {
      // Fail closed: if the key isn't configured, block admin writes rather
      // than leaving them wide open. Set ADMIN_API_KEY on the server.
      throw new UnauthorizedException(
        'Admin API key not configured on the server.',
      );
    }
    const header =
      (req.headers['x-admin-key'] as string) ||
      (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
      '';

    if (header && header === expected) return true;
    throw new UnauthorizedException('Admin key required for this operation.');
  }
}
