import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Rider sessions (P0-1 / P0-3).
 *
 * BEFORE: the rider's identity was the integer `deliveryPartnerId` sent in the
 * request body. That integer is a sequential primary key, it is handed to every
 * customer in the /orders/:id/track payload, and it gated BOTH status changes
 * and GPS updates. Anyone could drive, cancel, or teleport any order.
 *
 * NOW: /delivery-partners/login mints an HS256 JWT. Guarded routes read the
 * rider id FROM THE TOKEN (req.riderId) and never from the body or the URL.
 *
 * Signed with RIDER_JWT_SECRET. Fails closed if unset — no secret, no rider
 * writes. Set it on Render.
 */

export interface RiderJwtPayload {
  sub: number;      // delivery_partners.id
  name?: string;
  mobile?: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function secret(): string {
  return process.env.RIDER_JWT_SECRET || '';
}

/** Mint a signed rider JWT. Defaults to a 12h shift. */
export function signRiderJwt(
  payload: Omit<RiderJwtPayload, 'iat' | 'exp'>,
  ttlSeconds = 12 * 3600,
): string {
  const s = secret();
  if (!s) throw new Error('RIDER_JWT_SECRET is not configured on the server.');
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const sig = crypto.createHmac('sha256', s).update(`${head}.${data}`).digest('base64url');
  return `${head}.${data}.${sig}`;
}

export function verifyRiderJwt(token: string): RiderJwtPayload | null {
  const s = secret();
  if (!s || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, data, sig] = parts;
  const expected = crypto.createHmac('sha256', s).update(`${head}.${data}`).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as RiderJwtPayload;
    if (!payload?.sub || !payload?.exp) return null;
    if (Math.floor(Date.now() / 1000) > Number(payload.exp)) return null;
    return payload;
  } catch { return null; }
}

/** Rider id from `x-rider-token`, else null. */
export function riderIdFromReq(req: Request): number | null {
  const t = (req.headers['x-rider-token'] as string) || '';
  const p = verifyRiderJwt(t);
  return p ? Number(p.sub) : null;
}

/**
 * RiderAuthGuard — the caller must be a signed-in rider, OR the admin
 * (break-glass, so the admin panel can still drive an order manually).
 * Sets req.riderId. Never trusts a body/URL id.
 */
@Injectable()
export class RiderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { riderId?: number }>();

    // admin master key passes (break-glass dispatch)
    const expected = process.env.ADMIN_API_KEY;
    if (expected) {
      const header =
        (req.headers['x-admin-key'] as string) ||
        (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') || '';
      if (header && safeEqual(header, expected)) return true;
    }

    const riderId = riderIdFromReq(req);
    if (!riderId) throw new UnauthorizedException('Rider sign-in required.');
    req.riderId = riderId;
    return true;
  }
}

/** Constant-time string compare (P1: replaces `a === b` on secrets). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}
