import { signAdminJwt, verifyAdminJwt } from './admin-auth.guard';
import { verifyUserToken } from './user-auth.guard';
import * as crypto from 'crypto';

/**
 * Auth-token tests. These protect the two hand-rolled token systems:
 *  - admin JWT (signAdminJwt / verifyAdminJwt)
 *  - customer user-token (verifyUserToken)
 * A break here means either locked-out admins or forgeable identities, so
 * tampering / expiry / wrong-secret cases are covered explicitly.
 */
describe('admin JWT', () => {
  const OLD = process.env.ADMIN_JWT_SECRET;
  beforeAll(() => { process.env.ADMIN_JWT_SECRET = 'test-admin-secret'; });
  afterAll(() => { process.env.ADMIN_JWT_SECRET = OLD; });

  it('round-trips a valid token with its claims', () => {
    const token = signAdminJwt({ sub: 7, name: 'Sid', email: 's@x.com', role: 'super_admin' });
    const payload = verifyAdminJwt(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(7);
    expect(payload!.role).toBe('super_admin');
  });

  it('rejects a tampered payload', () => {
    const token = signAdminJwt({ sub: 1, role: 'kitchen_manager' });
    const [h, , s] = token.split('.');
    // swap in a payload claiming super_admin, keep the old signature
    const forged = Buffer.from(JSON.stringify({
      sub: 1, role: 'super_admin', iat: 1, exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    expect(verifyAdminJwt(`${h}.${forged}.${s}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signAdminJwt({ sub: 1, role: 'super_admin' });
    process.env.ADMIN_JWT_SECRET = 'a-different-secret';
    expect(verifyAdminJwt(token)).toBeNull();
    process.env.ADMIN_JWT_SECRET = 'test-admin-secret';
  });

  it('rejects an expired token', () => {
    const token = signAdminJwt({ sub: 1, role: 'super_admin' }, /* ttl */ -10);
    expect(verifyAdminJwt(token)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyAdminJwt('')).toBeNull();
    expect(verifyAdminJwt('not.a.jwt')).toBeNull();
    expect(verifyAdminJwt('only-one-part')).toBeNull();
  });
});

describe('customer user-token', () => {
  const OLD = process.env.USER_TOKEN_SECRET;
  const SECRET = 'test-user-secret';
  beforeAll(() => { process.env.USER_TOKEN_SECRET = SECRET; });
  afterAll(() => { process.env.USER_TOKEN_SECRET = OLD; });

  // mint the same format the Next.js frontend produces
  function mint(uid: number, expSecondsFromNow = 1800): string {
    const payload = Buffer.from(JSON.stringify({
      uid, exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  it('accepts a valid token and returns the uid', () => {
    expect(verifyUserToken(mint(42))).toBe(42);
  });

  it('rejects an expired token', () => {
    expect(verifyUserToken(mint(42, -60))).toBeNull();
  });

  it('rejects a wrong signature', () => {
    const [payload] = mint(42).split('.');
    expect(verifyUserToken(`${payload}.deadbeef`)).toBeNull();
  });

  it('rejects empty / malformed input', () => {
    expect(verifyUserToken('')).toBeNull();
    expect(verifyUserToken('nodot')).toBeNull();
  });
});
