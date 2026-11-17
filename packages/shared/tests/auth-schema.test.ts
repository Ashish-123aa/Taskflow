import { describe, expect, it } from 'vitest';
import { registerSchema, loginSchema } from '../src/schemas/auth';

describe('registerSchema', () => {
  const valid = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'Password123' };

  it('accepts a well-formed registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('lowercases the email', () => {
    const result = registerSchema.parse({ ...valid, email: 'Ada@Example.COM' });
    expect(result.email).toBe('ada@example.com');
  });

  it('rejects a name under 2 characters', () => {
    expect(registerSchema.safeParse({ ...valid, name: 'A' }).success).toBe(false);
  });

  it('rejects an invalid email format', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  // Each password requirement tested in isolation, so a failure here
  // points at exactly which rule broke rather than "password invalid".
  it('rejects a password under 8 characters', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'Ab1' }).success).toBe(false);
  });

  it('rejects a password with no uppercase letter', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'password123' }).success).toBe(false);
  });

  it('rejects a password with no lowercase letter', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'PASSWORD123' }).success).toBe(false);
  });

  it('rejects a password with no number', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'PasswordOnly' }).success).toBe(false);
  });

  it('accepts a password that satisfies every rule at once', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'Xy9zzzzz' }).success).toBe(true);
  });
});

describe('loginSchema', () => {
  it('accepts a well-formed login', () => {
    expect(loginSchema.safeParse({ email: 'ada@example.com', password: 'anything' }).success).toBe(true);
  });

  it('lowercases the email, same as registerSchema', () => {
    const result = loginSchema.parse({ email: 'ADA@EXAMPLE.COM', password: 'x' });
    expect(result.email).toBe('ada@example.com');
  });

  it('rejects a missing password', () => {
    expect(loginSchema.safeParse({ email: 'ada@example.com' }).success).toBe(false);
  });

  it('rejects an empty-string password (unlike registerSchema, login has no strength rules — just "present")', () => {
    expect(loginSchema.safeParse({ email: 'ada@example.com', password: '' }).success).toBe(false);
  });

  it('rejects an invalid email format', () => {
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});
