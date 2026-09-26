import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { requireEnvironmentVariable } from "../env.js";

const migrationConnection = postgres(requireEnvironmentVariable("DIRECT_URL"), {
  max: 1,
  prepare: false,
});

try {
  await migrate(drizzle(migrationConnection), { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied successfully.");
} finally {
  await migrationConnection.end();
}
