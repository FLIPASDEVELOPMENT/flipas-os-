import { PrismaClient } from "../generated/prisma/client";
import { SerializedPrismaPg } from "./postgres-adapter";
const globalDB = globalThis as unknown as { db?: PrismaClient };
export const db =
  globalDB.db ??
  new PrismaClient({
    adapter: new SerializedPrismaPg({
      connectionString: process.env.DATABASE_URL,
    }),
  });
if (process.env.NODE_ENV !== "production") globalDB.db = db;
