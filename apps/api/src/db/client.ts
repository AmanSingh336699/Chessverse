import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";

export const createDatabase = () => {
  if (!env.DATABASE_URL) {
    return null;
  }

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
  });

  return {
    pool,
    db: drizzle(pool),
  } as const;
};
