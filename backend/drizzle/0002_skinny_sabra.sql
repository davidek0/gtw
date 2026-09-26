CREATE TABLE "garmin_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"garmin_user_id" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone,
	"permissions" jsonb NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "garmin_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "garmin_health_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_event_id" uuid NOT NULL,
	"connection_id" uuid,
	"garmin_user_id" text,
	"summary_type" varchar(100) NOT NULL,
	"record_hash" varchar(64) NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"data" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_health_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "garmin_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"state_hash" varchar(64) NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "garmin_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "garmin_fit_files" CASCADE;--> statement-breakpoint
DROP TABLE "garmin_health_samples" CASCADE;--> statement-breakpoint
ALTER TABLE "garmin_health_records" ADD CONSTRAINT "garmin_health_records_webhook_event_id_garmin_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."garmin_webhook_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_health_records" ADD CONSTRAINT "garmin_health_records_connection_id_garmin_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."garmin_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connections_subject_id_unique" ON "garmin_connections" USING btree ("subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connections_user_id_unique" ON "garmin_connections" USING btree ("garmin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_health_records_record_hash_unique" ON "garmin_health_records" USING btree ("record_hash");--> statement-breakpoint
CREATE INDEX "garmin_health_records_connection_id_idx" ON "garmin_health_records" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "garmin_health_records_user_id_idx" ON "garmin_health_records" USING btree ("garmin_user_id");--> statement-breakpoint
CREATE INDEX "garmin_health_records_summary_type_idx" ON "garmin_health_records" USING btree ("summary_type");--> statement-breakpoint
CREATE INDEX "garmin_health_records_started_at_idx" ON "garmin_health_records" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_oauth_states_state_hash_unique" ON "garmin_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "garmin_oauth_states_expires_at_idx" ON "garmin_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_webhook_events_payload_hash_unique" ON "garmin_webhook_events" USING btree ("payload_hash");