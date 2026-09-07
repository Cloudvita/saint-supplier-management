CREATE TYPE "public"."mfa_method" AS ENUM('NONE', 'TOTP', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('DRAFT', 'IN_REVIEW', 'PENDING_SIGNATURE', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('MSA', 'SOW', 'NDA', 'RATE_CARD', 'PO_TERMS', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."renewal_type" AS ENUM('AUTO_RENEW', 'MANUAL', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."signature_status" AS ENUM('PENDING', 'SENT', 'SIGNED', 'DECLINED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('RECEIVED', 'MATCHED', 'EXCEPTION', 'APPROVED', 'PAID', 'DISPUTED');--> statement-breakpoint
CREATE TYPE "public"."po_status" AS ENUM('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."requisition_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED');--> statement-breakpoint
CREATE TABLE "auth_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"password_hash" varchar(256) NOT NULL,
	"password_salt" varchar(64) NOT NULL,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credentials_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_mfa_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"method" "mfa_method" DEFAULT 'NONE' NOT NULL,
	"secret" varchar(128),
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_mfa_enrollments_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"mfa_satisfied" boolean DEFAULT false NOT NULL,
	"ip_address" varchar(64),
	"user_agent" varchar(300),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approval_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"cost_center" varchar(40),
	"parent_team_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"user_name" varchar(60) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"email" varchar(200) NOT NULL,
	"role_id" text NOT NULL,
	"team_id" text,
	"status" "user_status" DEFAULT 'INVITED' NOT NULL,
	"approval_limit_override" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(120) DEFAULT 'system',
	CONSTRAINT "users_user_name_unique" UNIQUE("user_name")
);
--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text,
	"file_name" varchar(300) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"s3_bucket" varchar(200),
	"s3_key" varchar(500),
	"extracted_metadata" jsonb,
	"confidence" double precision,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"signer_name" varchar(160) NOT NULL,
	"signer_email" varchar(200) NOT NULL,
	"is_counterparty" boolean DEFAULT false NOT NULL,
	"status" "signature_status" DEFAULT 'PENDING' NOT NULL,
	"external_envelope_id" varchar(120),
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_number" varchar(24) NOT NULL,
	"supplier_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"contract_type" "contract_type" DEFAULT 'MSA' NOT NULL,
	"status" "contract_status" DEFAULT 'DRAFT' NOT NULL,
	"total_value" double precision,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_terms" varchar(30) DEFAULT 'NET30' NOT NULL,
	"effective_date" timestamp with time zone,
	"expiry_date" timestamp with time zone,
	"renewal_type" "renewal_type" DEFAULT 'MANUAL' NOT NULL,
	"notice_period_days" integer DEFAULT 90 NOT NULL,
	"auto_renew_term_months" integer,
	"owner_user_id" text,
	"detected_clauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_clauses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_contract_number_unique" UNIQUE("contract_number")
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"cost_center" varchar(40) NOT NULL,
	"category" varchar(120),
	"team_id" text,
	"amount" double precision NOT NULL,
	"committed" double precision DEFAULT 0 NOT NULL,
	"spent" double precision DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goods_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"purchase_order_id" text NOT NULL,
	"received_amount" double precision NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" text,
	"notes" text,
	"on_time" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" varchar(60) NOT NULL,
	"purchase_order_id" text,
	"supplier_id" text NOT NULL,
	"amount" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"invoice_date" timestamp with time zone NOT NULL,
	"due_date" timestamp with time zone,
	"status" "invoice_status" DEFAULT 'RECEIVED' NOT NULL,
	"match_result" jsonb,
	"exception_reason" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"po_number" varchar(24) NOT NULL,
	"requisition_id" text,
	"supplier_id" text NOT NULL,
	"contract_id" text,
	"budget_id" text,
	"description" text NOT NULL,
	"category" varchar(120),
	"amount" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"payment_terms" varchar(30) DEFAULT 'NET30' NOT NULL,
	"status" "po_status" DEFAULT 'OPEN' NOT NULL,
	"issued_by" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_delivery_date" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "requisitions" (
	"id" text PRIMARY KEY NOT NULL,
	"requisition_number" varchar(24) NOT NULL,
	"requester_id" text NOT NULL,
	"supplier_id" text,
	"budget_id" text,
	"description" text NOT NULL,
	"commodity_code" varchar(20),
	"category" varchar(120),
	"amount" double precision NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "requisition_status" DEFAULT 'DRAFT' NOT NULL,
	"on_contract" boolean DEFAULT false NOT NULL,
	"contract_id" text,
	"sole_source_justification" text,
	"approver_id" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requisitions_requisition_number_unique" UNIQUE("requisition_number")
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "performance_score" double precision;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "on_time_delivery_pct" double precision;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "quality_score" double precision;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisition_id_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisitions" ADD CONSTRAINT "requisitions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_credentials_user_idx" ON "auth_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_mfa_user_idx" ON "auth_mfa_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "teams_parent_idx" ON "teams" USING btree ("parent_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "users_team_idx" ON "users" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "contract_documents_contract_idx" ON "contract_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_signatures_contract_idx" ON "contract_signatures" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contracts_supplier_idx" ON "contracts" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_expiry_idx" ON "contracts" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "budgets_cost_center_idx" ON "budgets" USING btree ("cost_center","fiscal_year");--> statement-breakpoint
CREATE INDEX "goods_receipts_po_idx" ON "goods_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "invoices_supplier_idx" ON "invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_po_idx" ON "invoices" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requisitions_status_idx" ON "requisitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requisitions_requester_idx" ON "requisitions" USING btree ("requester_id");