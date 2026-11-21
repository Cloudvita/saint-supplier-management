ALTER TABLE "purchase_orders" ADD COLUMN "part_id" text;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "part_name" varchar(300);--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "part_id" text;--> statement-breakpoint
ALTER TABLE "requisitions" ADD COLUMN "part_name" varchar(300);--> statement-breakpoint
CREATE INDEX "purchase_orders_part_idx" ON "purchase_orders" USING btree ("part_id");