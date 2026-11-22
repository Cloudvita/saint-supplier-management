CREATE TYPE "public"."graph_import_status" AS ENUM('PREVIEW', 'COMMITTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "graph_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"format" varchar(20) NOT NULL,
	"file_name" varchar(300) NOT NULL,
	"status" "graph_import_status" DEFAULT 'PREVIEW' NOT NULL,
	"document" jsonb,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_id" text,
	"created_by" text,
	"committed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_imports" ADD CONSTRAINT "graph_imports_source_id_graph_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."graph_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "graph_imports_status_idx" ON "graph_imports" USING btree ("status");