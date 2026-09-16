import { PrismaClient } from '@prisma/client';

/**
 * A single, shared Prisma Client instance.
 *
 * Both the API and the Worker import { prisma } from '@taskflow/shared'
 * instead of each instantiating their own PrismaClient. This matters once
 * we're under load: PrismaClient opens a connection pool on construction,
 * and creating a fresh one per request (or, worse, per hot-reload in dev)
 * quickly exhausts Postgres's max_connections. One client per process,
 * reused everywhere in that process, is the standard pattern.
 */
export const prisma = new PrismaClient();
