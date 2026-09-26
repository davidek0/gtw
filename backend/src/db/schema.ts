import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const garminOAuthStates = pgTable(
  "garmin_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: text("subject_id").notNull(),
    stateHash: varchar("state_hash", { length: 64 }).notNull(),
    encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("garmin_oauth_states_state_hash_unique").on(table.stateHash),
    index("garmin_oauth_states_expires_at_idx").on(table.expiresAt),
  ],
).enableRLS();

export const garminConnections = pgTable(
  "garmin_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: text("subject_id").notNull(),
    garminUserId: text("garmin_user_id").notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("garmin_connections_subject_id_unique").on(table.subjectId),
    uniqueIndex("garmin_connections_user_id_unique").on(table.garminUserId),
  ],
).enableRLS();

export const garminWebhookEvents = pgTable(
  "garmin_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("garmin_webhook_events_payload_hash_unique").on(table.payloadHash)],
).enableRLS();

export const garminHealthRecords = pgTable(
  "garmin_health_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookEventId: uuid("webhook_event_id")
      .notNull()
      .references(() => garminWebhookEvents.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => garminConnections.id, {
      onDelete: "set null",
    }),
    garminUserId: text("garmin_user_id"),
    summaryType: varchar("summary_type", { length: 100 }).notNull(),
    recordHash: varchar("record_hash", { length: 64 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("garmin_health_records_record_hash_unique").on(table.recordHash),
    index("garmin_health_records_connection_id_idx").on(table.connectionId),
    index("garmin_health_records_user_id_idx").on(table.garminUserId),
    index("garmin_health_records_summary_type_idx").on(table.summaryType),
    index("garmin_health_records_started_at_idx").on(table.startedAt),
  ],
).enableRLS();

/**
 * Daily payloads fetched from the unofficial Garmin Connect web API.
 *
 * Each metric is replaced when it is fetched again. This makes polling and
 * backfilling idempotent while retaining Garmin's complete response payload.
 */
export const garminConnectHealthRecords = pgTable(
  "garmin_connect_health_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: text("subject_id").notNull(),
    recordDate: date("record_date", { mode: "string" }).notNull(),
    metricType: varchar("metric_type", { length: 100 }).notNull(),
    data: jsonb("data").$type<unknown>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("garmin_connect_health_records_subject_date_metric_unique").on(
      table.subjectId,
      table.recordDate,
      table.metricType,
    ),
    index("garmin_connect_health_records_subject_date_idx").on(
      table.subjectId,
      table.recordDate,
    ),
  ],
).enableRLS();

export const garminLiveHeartRateSamples = pgTable(
  "garmin_live_heart_rate_samples",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subjectId: text("subject_id").notNull(),
    bpm: integer("bpm").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    sourceDevice: text("source_device"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("garmin_live_hr_subject_measured_unique").on(
      table.subjectId,
      table.measuredAt,
    ),
    index("garmin_live_hr_subject_measured_idx").on(table.subjectId, table.measuredAt),
  ],
).enableRLS();

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type GarminConnection = typeof garminConnections.$inferSelect;
export type GarminHealthRecord = typeof garminHealthRecords.$inferSelect;
export type GarminConnectHealthRecord = typeof garminConnectHealthRecords.$inferSelect;
export type GarminLiveHeartRateSample = typeof garminLiveHeartRateSamples.$inferSelect;
