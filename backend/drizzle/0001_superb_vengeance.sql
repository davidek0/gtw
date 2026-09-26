CREATE TABLE "garmin_fit_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"file_name" text NOT NULL,
	"file_type" varchar(100),
	"manufacturer" varchar(100),
	"product" varchar(100),
	"file_created_at" timestamp with time zone,
	"profile_version" varchar(30) NOT NULL,
	"sample_count" integer NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_fit_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "garmin_health_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fit_file_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone,
	"message_type" varchar(100) NOT NULL,
	"activity_type" varchar(100),
	"heart_rate_bpm" integer,
	"resting_heart_rate_bpm" integer,
	"steps" integer,
	"stress_level" integer,
	"spo2_percent" double precision,
	"respiration_rate_brpm" double precision,
	"body_battery" integer,
	"hrv_ms" double precision,
	"calories_kcal" double precision,
	"distance_meters" double precision,
	"duration_seconds" double precision,
	"temperature_celsius" double precision,
	"latitude_degrees" double precision,
	"longitude_degrees" double precision,
	"sleep_level" varchar(100),
	"raw_data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_health_samples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "garmin_health_samples" ADD CONSTRAINT "garmin_health_samples_fit_file_id_garmin_fit_files_id_fk" FOREIGN KEY ("fit_file_id") REFERENCES "public"."garmin_fit_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_fit_files_sha256_unique" ON "garmin_fit_files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "garmin_fit_files_subject_id_idx" ON "garmin_fit_files" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "garmin_fit_files_created_at_idx" ON "garmin_fit_files" USING btree ("file_created_at");--> statement-breakpoint
CREATE INDEX "garmin_health_samples_fit_file_id_idx" ON "garmin_health_samples" USING btree ("fit_file_id");--> statement-breakpoint
CREATE INDEX "garmin_health_samples_recorded_at_idx" ON "garmin_health_samples" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "garmin_health_samples_message_type_idx" ON "garmin_health_samples" USING btree ("message_type");