import { prisma } from '@taskflow/shared';
import type { Prisma } from '@taskflow/shared';

/**
 * All direct Prisma access for the User model goes through this file.
 * Services call these methods instead of `prisma.user.*` directly — this
 * is the layer that would change if the data source ever did, and it's
 * the seam integration tests can mock without hitting a real database.
 */
export const userRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  },

  create(data: Prisma.UserCreateInput) {
    return prisma.user.create({ data });
  },

  // Admin-facing methods below. Both use an explicit `select` rather than
  // fetching the full row and stripping passwordHash afterward — the hash
  // is never even retrieved from the database, not just omitted from the
  // response, which is a stronger guarantee than a "remember to delete
  // this field" convention.
  async findAll(params: { page: number; limit: number }) {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
      }),
      prisma.user.count(),
    ]);
    return { users, total };
  },

  setActive(id: string, isActive: boolean) {
    return prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
    });
  },
};
