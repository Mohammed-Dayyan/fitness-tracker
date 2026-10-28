import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // Optional cap on connections per process; keep it small (e.g. 3) on
  // serverless hosts, where many instances share one database pooler.
  const max = Number(process.env.DATABASE_POOL_MAX) || undefined;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

// One client per process; reused across hot reloads in development.
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
