import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException,
  ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Per-admin JWT auth (P1) — replaces "everyone shares the master API key".
 *
 * A real HS256 JWT (built with Node crypto, zero new deps — same approach as
 * the customer user-token). Login mints a token carrying the admin's id, name,
 * email and role; this guard verifies it and can enforce a required role.
 *
 * Backwards compatible: the shared ADMIN_API_KEY still works as a break-glass
 * fallback, so the existing admin panel keeps functioning while you migrate
 * calls over to Bearer tokens. Once every admin call sends the JWT you can
 * stop returning the key from /login.
 *
 * Signed with ADMIN_JWT_SECRET (set on Render). If it's unset we fall back to
 * ADMIN_API_KEY as the signing secret so the feature works before you add a
 * new env var — but set a dedicated ADMIN_JWT_SECRET in production.
 */

export interface AdminJwtPayload {
  sub: number;          // admin id
  name?: string;
  email?: string;
  role?: string;        // role name, lower-case (e.g. 'super_admin')
  roleId?: number | null;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function signingSecret(): string {
  return process.env.ADMIN_JWT_SECRET || process.env.ADMIN_API_KEY || '';
}

/** Mint a signed admin JWT. ttlSeconds defaults to 12h. */
export function signAdminJwt(
  payload: Omit<AdminJwtPayload, 'iat' | 'exp'>,
  ttlSeconds = 12 * 3600,
): string {
  const secret = signingSecret();
  if (!secret) throw new Error('ADMIN_JWT_SECRET / ADMIN_API_KEY not configured');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body: AdminJwtPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = b64url(JSON.stringify(header));
  const data = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${data}`).digest('base64url');
  return `${head}.${data}.${sig}`;
}

/** Verify a token; returns the payload or null. */
export function verifyAdminJwt(token: string): AdminJwtPayload | null {
  const secret = signingSecret();
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, data, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${head}.${data}`).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as AdminJwtPayload;
    if (!payload?.sub || !payload?.exp) return null;
    if (Math.floor(Date.now() / 1000) > Number(payload.exp)) return null;
    return payload;
  } catch { return null; }
}

/* ── @Roles('super_admin', 'kitchen_manager') decorator ── */
export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles.map((r) => r.toLowerCase()));

/** Pull a Bearer token out of the request. */
function bearer(req: Request): string {
  const h = (req.headers['authorization'] as string) || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

/** True if the request carries the shared master key (break-glass). */
function hasMasterKey(req: Request): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  const header = (req.headers['x-admin-key'] as string) || bearer(req) || '';
  return !!header && header === expected;
}

/**
 * AdminAuthGuard — attach with @UseGuards(AdminAuthGuard) on admin routes,
 * optionally with @Roles(...) to require a specific role.
 *
 * Accepts EITHER a valid admin JWT (Authorization: Bearer <jwt>) OR the shared
 * master key (x-admin-key). The master key is treated as super_admin so
 * break-glass access always passes role checks.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { admin?: AdminJwtPayload }>();

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]) || [];

    // 1) master key → full access (break-glass)
    if (hasMasterKey(req)) {
      req.admin = { sub: 0, role: 'super_admin', iat: 0, exp: 0 } as AdminJwtPayload;
      return true;
    }

    // 2) admin JWT
    const payload = verifyAdminJwt(bearer(req));
    if (!payload) throw new UnauthorizedException('Admin login required.');
    req.admin = payload;

    if (required.length) {
      const role = (payload.role || '').toLowerCase();
      // super_admin passes everything
      if (role !== 'super_admin' && !required.includes(role)) {
        throw new ForbiddenException(`Requires role: ${required.join(' or ')}.`);
      }
    }
    return true;
  }
}
