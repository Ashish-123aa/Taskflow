import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { signToken, verifyToken } from '../src/services/token.service';

describe('signToken / verifyToken', () => {
  it('round-trips a payload through sign then verify', () => {
    const token = signToken({ sub: 'user-1', role: 'USER' });
    const payload = verifyToken(token);

    expect(payload.sub).toBe('user-1');
    expect(payload.role).toBe('USER');
  });

  it('preserves the role claim exactly, including ADMIN', () => {
    const token = signToken({ sub: 'admin-1', role: 'ADMIN' });
    expect(verifyToken(token).role).toBe('ADMIN');
  });

  it('produces a genuine three-part JWT', () => {
    const token = signToken({ sub: 'user-1', role: 'USER' });
    expect(token.split('.')).toHaveLength(3);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyToken('not-a-real-token')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => verifyToken('')).toThrow();
  });

  it('rejects a token signed with a different secret (a forged/tampered token)', () => {
    const forged = jwt.sign({ sub: 'attacker', role: 'ADMIN' }, 'a-completely-different-secret-value!!');
    expect(() => verifyToken(forged)).toThrow();
  });

  it('rejects a token whose payload was tampered with after signing', () => {
    const token = signToken({ sub: 'user-1', role: 'USER' });
    const [header, , signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'user-1', role: 'ADMIN' })).toString(
      'base64url',
    );
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    expect(() => verifyToken(tampered)).toThrow();
  });

  it('rejects an expired token', () => {
    // Signed with the same secret token.service.ts uses (read from the
    // test env — see vitest.config.ts), but with an already-elapsed
    // expiry, bypassing signToken()'s own JWT_EXPIRES_IN so this test
    // doesn't need to wait out a real expiry window.
    const expired = jwt.sign(
      { sub: 'user-1', role: 'USER' },
      process.env.JWT_SECRET as string,
      { expiresIn: -10 }, // expired 10 seconds ago
    );

    expect(() => verifyToken(expired)).toThrow(/expired/i);
  });
});
