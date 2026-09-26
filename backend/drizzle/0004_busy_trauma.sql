CREATE TABLE "garmin_live_heart_rate_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"bpm" integer NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"source_device" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_live_heart_rate_samples" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_live_hr_subject_measured_unique" ON "garmin_live_heart_rate_samples" USING btree ("subject_id","measured_at");--> statement-breakpoint
CREATE INDEX "garmin_live_hr_subject_measured_idx" ON "garmin_live_heart_rate_samples" USING btree ("subject_id","measured_at");