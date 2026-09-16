import bcrypt from 'bcrypt';
import type { RegisterInput, LoginInput, SafeUser, Role } from '@taskflow/shared';
import { userRepository } from '../repositories/user.repository';
import { ConflictError, UnauthorizedError, ForbiddenError } from '../utils/errors';
import { signToken } from './token.service';
import { logger } from '../config/logger';

const SALT_ROUNDS = 12;

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

// Explicitly builds a response object field-by-field rather than spreading
// the Prisma user and deleting passwordHash — this way, a new sensitive
// column added to the User model in the future can't leak into an API
// response just because someone forgot to add it to a "fields to omit" list.
function toSafeUser(user: UserRecord): SafeUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export const authService = {
  async register(input: RegisterInput): Promise<{ user: SafeUser; token: string }> {
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const user = await userRepository.create({
      name: input.name,
      email: input.email,
      passwordHash,
    });

    logger.info('User registered', { userId: user.id });

    const token = signToken({ sub: user.id, role: user.role as Role });
    return { user: toSafeUser(user as UserRecord), token };
  },

  async login(input: LoginInput): Promise<{ user: SafeUser; token: string }> {
    const user = await userRepository.findByEmail(input.email);

    // Deliberately the same error for "no such user" and "wrong password" —
    // see docs/security.md. Distinguishing them lets an attacker enumerate
    // which emails have accounts just by trying logins.
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      logger.warn('Failed login attempt', { email: input.email });
      throw new UnauthorizedError('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenError('This account has been disabled');
    }

    logger.info('User logged in', { userId: user.id });

    const token = signToken({ sub: user.id, role: user.role as Role });
    return { user: toSafeUser(user as UserRecord), token };
  },

  async getById(id: string): Promise<SafeUser | null> {
    const user = await userRepository.findById(id);
    return user ? toSafeUser(user as UserRecord) : null;
  },
};
