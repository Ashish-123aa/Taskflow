/**
 * Role is hand-mirrored to the `Role` enum in schema.prisma rather than
 * imported from the generated Prisma Client. That keeps this package
 * consumable (e.g. by the frontend, which has no business generating a
 * Prisma Client) without a build-time dependency on `prisma generate`
 * having been run. If the two ever drift, TypeScript will catch it the
 * moment Prisma Client's Role type is used alongside this one.
 */
export type Role = 'USER' | 'ADMIN';

export interface JwtPayload {
  sub: string; // user id
  role: Role;
}

export interface SafeUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}
