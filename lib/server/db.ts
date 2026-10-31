import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Max connections per app process. A Today page runs about a dozen queries at
 * once, so a small pool makes them queue in waves (each wave costs a database
 * round trip). 8 is a balance for serverless: many instances share the
 * database pooler, which has its own client limit.
 */
export const DB_POOL_MAX = 8;

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: DB_POOL_MAX }) });
}

// One client per process; reused across hot reloads in development.
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
