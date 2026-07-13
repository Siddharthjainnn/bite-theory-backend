import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { verifyUserToken } from './user-auth.guard';

/**
 * Shared per-request auth helpers (P0 security patch).
 *
 * Two identities exist in this API:
 *   1. ADMIN  — holds ADMIN_API_KEY in `x-admin-key` (or `Authorization: Bearer`).
 *   2. USER   — holds a signed `x-user-token` minted by the Next.js frontend
 *               (verified by verifyUserToken / UserAuthGuard).
 *
 * Rules these helpers enforce:
 *   - requireAdmin(req)               → admin key or 401.
 *   - requireSelfOrAdmin(req, userId) → admin key, OR a user token whose uid
 *                                       matches `userId`. Anything else → 401.
 *
 * Dev fallback: if USER_TOKEN_SECRET is not configured AND we are not in
 * production, self-checks are skipped (same behavior as UserAuthGuard) so
 * local dev without env vars keeps working. In production a missing secret
 * fails CLOSED.
 */

export function isAdminReq(req: Request): boolean {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return false;
  const header =
    (req.headers['x-admin-key'] as string) ||
    (req.headers['authorization'] as string)?.replace(/^Bearer\s+/i, '') ||
    '';
  return !!header && header === expected;
}

/** uid from a valid x-user-token, else null. */
export function authUidFromReq(req: Request): number | null {
  return verifyUserToken((req.headers['x-user-token'] as string) || '');
}

export function requireAdmin(req: Request): void {
  if (!isAdminReq(req)) {
    throw new UnauthorizedException('Admin key required for this operation.');
  }
}

/**
 * Caller must be the admin, or a signed-in user whose token uid === userId.
 * Pass the OWNER of the resource as `userId` (e.g. address.userId).
 */
export function requireSelfOrAdmin(
  req: Request,
  userId: number | null | undefined,
): void {
  if (isAdminReq(req)) return;

  if (!process.env.USER_TOKEN_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new UnauthorizedException('User auth is not configured on the server.');
    }
    return; // dev convenience — mirrors UserAuthGuard
  }

  const uid = authUidFromReq(req);
  if (!uid) throw new UnauthorizedException('Please sign in again to continue.');
  if (userId == null || Number(uid) !== Number(userId)) {
    throw new UnauthorizedException('You can only access your own data.');
  }
}
