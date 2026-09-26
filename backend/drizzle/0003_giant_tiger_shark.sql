CREATE TABLE "garmin_connect_health_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"record_date" date NOT NULL,
	"metric_type" varchar(100) NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_connect_health_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "garmin_connect_health_records_subject_date_metric_unique" ON "garmin_connect_health_records" USING btree ("subject_id","record_date","metric_type");--> statement-breakpoint
CREATE INDEX "garmin_connect_health_records_subject_date_idx" ON "garmin_connect_health_records" USING btree ("subject_id","record_date");