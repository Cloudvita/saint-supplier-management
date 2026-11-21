CREATE TYPE "public"."part_source_status" AS ENUM('CANDIDATE', 'APPROVED', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "part_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"part_id" text NOT NULL,
	"part_name" varchar(300) NOT NULL,
	"supplier_id" text NOT NULL,
	"status" "part_source_status" DEFAULT 'CANDIDATE' NOT NULL,
	"supplier_part_number" varchar(60),
	"unit_price" double precision,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"lead_time_days" integer,
	"notes" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "part_sources_part_supplier_uq" ON "part_sources" USING btree ("part_id","supplier_id");--> statement-breakpoint
CREATE INDEX "part_sources_supplier_idx" ON "part_sources" USING btree ("supplier_id");