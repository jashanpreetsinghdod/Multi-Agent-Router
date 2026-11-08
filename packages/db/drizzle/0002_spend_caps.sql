ALTER TABLE "runs" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_usd_cap" numeric(12, 4);