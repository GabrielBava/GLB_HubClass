ALTER TYPE "public"."user_status" ADD VALUE 'pending_approval' BEFORE 'active';--> statement-breakpoint
ALTER TABLE "knowledge_areas" ALTER COLUMN "color" SET DEFAULT '#F36B22';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offboard_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offboard_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "offboarded_by" uuid;--> statement-breakpoint
ALTER TABLE "leader_areas" DROP COLUMN "can_edit";--> statement-breakpoint
ALTER TABLE "leader_areas" DROP COLUMN "can_publish";