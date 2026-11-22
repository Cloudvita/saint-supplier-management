CREATE TABLE "graph_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"type" varchar(60) NOT NULL,
	"source_id" text,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text,
	"external_key" varchar(300),
	"name" varchar(500) NOT NULL,
	"class_name" varchar(120),
	"source_tag" varchar(120),
	"rflp_layer" varchar(1),
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"format" varchar(20) NOT NULL,
	"name" varchar(300) NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"edge_count" integer DEFAULT 0 NOT NULL,
	"imported_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_from_id_graph_nodes_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_to_id_graph_nodes_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_source_id_graph_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."graph_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_source_id_graph_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."graph_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_edges_from_to_type_uq" ON "graph_edges" USING btree ("from_id","to_id","type");--> statement-breakpoint
CREATE INDEX "graph_edges_to_type_idx" ON "graph_edges" USING btree ("to_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "graph_nodes_source_key_uq" ON "graph_nodes" USING btree ("source_id","external_key");--> statement-breakpoint
CREATE INDEX "graph_nodes_name_lower_idx" ON "graph_nodes" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "graph_nodes_class_idx" ON "graph_nodes" USING btree ("class_name");