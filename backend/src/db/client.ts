import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { requireEnvironmentVariable } from "../env.js";
import * as schema from "./schema.js";

const connection = postgres(requireEnvironmentVariable("DATABASE_URL"), {
  // Supabase's transaction pooler does not support prepared statements.
  prepare: false,
});

export const db = drizzle(connection, { schema });

export async function closeDatabase(): Promise<void> {
  await connection.end();
}
