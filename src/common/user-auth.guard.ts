import {
  CanActivate, ExecutionContext, Injectable, UnauthorizedException, Logger,
} from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Verifies the `x-user-token` header minted by the Next.js frontend
 * (app/api/user-token/route.ts). Token format:
 *
 *   base64url(JSON{ uid, exp }) + "." + HMAC_SHA256(payload, USER_TOKEN_SECRET)
 *
 * Both sides share USER_TOKEN_SECRET (set on Render AND Vercel).
 * On success, req.authUserId is set; services compare it with dto.userId
 * so a user can only act as themselves.
 *
 * Rollout safety: if USER_TOKEN_SECRET is not configured on the server,
 * the guard allows the request (and logs a warning) so nothing breaks
 * before the env vars are set. Once the secret is set, tokens are enforced.
 */
export function verifyUserToken(token: string): number | null {
  const secret = process.env.USER_TOKEN_SECRET;
  if (!secret || !token) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.exp) return null;
    if (Date.now() / 1000 > Number(payload.exp)) return null; // expired
    return Number(payload.uid);
  } catch { return null; }
}

@Injectable()
export class UserAuthGuard implements CanActivate {
  private readonly logger = new Logger(UserAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { authUserId?: number }>();

    // FAIL CLOSED in production: if the secret is missing we cannot establish
    // identity, so protected routes must reject — otherwise anyone can act as
    // any userId just by putting it in the request body.
    if (!process.env.USER_TOKEN_SECRET) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('USER_TOKEN_SECRET not set — rejecting protected request (fail closed).');
        throw new UnauthorizedException('User auth is not configured on the server.');
      }
      this.logger.warn('USER_TOKEN_SECRET not set — user-token auth is NOT enforced (dev only).');
      return true;
    }

    const token = (req.headers['x-user-token'] as string) || '';
    const uid = verifyUserToken(token);
    if (!uid) throw new UnauthorizedException('Please sign in again to continue.');
    req.authUserId = uid;
    return true;
  }
}
