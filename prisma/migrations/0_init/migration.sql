-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "achievement_metric" AS ENUM ('DONATIONS_COMPLETED', 'PORTIONS_DONATED', 'PEOPLE_SERVED', 'TASKS_COMPLETED');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "donation_status" AS ENUM ('DRAFT', 'SCREENED', 'POSTED', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CLOSED', 'REJECTED', 'DECLINED', 'REJECTED_AT_PICKUP', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "donor_type" AS ENUM ('ESTABLISHMENT', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "image_role" AS ENUM ('FOOD_PHOTO', 'PICKUP_PHOTO', 'HANDOVER_PROOF');

-- CreateEnum
CREATE TYPE "incident_status" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "pickup_decision" AS ENUM ('ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "qr_scan_stage" AS ENUM ('PICKUP', 'DROPOFF');

-- CreateEnum
CREATE TYPE "screening_verdict" AS ENUM ('PASS', 'FLAG', 'REVIEW');

-- CreateEnum
CREATE TYPE "storage_condition" AS ENUM ('ROOM_TEMPERATURE', 'HOT_HELD', 'REFRIGERATED', 'FROZEN');

-- CreateEnum
CREATE TYPE "unusable_reason" AS ENUM ('SPOILED_ON_ARRIVAL', 'DAMAGED', 'OTHER');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('DONOR', 'VOLUNTEER', 'ADMIN');

-- CreateTable
CREATE TABLE "achievements" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "role" "user_role" NOT NULL,
    "metric" "achievement_metric" NOT NULL,
    "threshold" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "street_line1" VARCHAR(200) NOT NULL,
    "street_line2" VARCHAR(200),
    "barangay" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL,
    "province_or_state" VARCHAR(120),
    "postal_code" VARCHAR(20),
    "country_code" CHAR(2) NOT NULL DEFAULT 'PH',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergens" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "allergens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiary_groups" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "beneficiary_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dietary_tags" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "dietary_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "distributed_on" DATE NOT NULL,
    "place" VARCHAR(200) NOT NULL,
    "group_id" SMALLINT NOT NULL,
    "people_served" INTEGER NOT NULL,
    "portions_distributed" INTEGER NOT NULL,
    "notes" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_entry_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entry_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_entry_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_allergens" (
    "donation_id" UUID NOT NULL,
    "allergen_id" SMALLINT NOT NULL,

    CONSTRAINT "donation_allergens_pkey" PRIMARY KEY ("donation_id","allergen_id")
);

-- CreateTable
CREATE TABLE "donation_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "assigned_by_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "end_reason" TEXT,

    CONSTRAINT "donation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_dietary_tags" (
    "donation_id" UUID NOT NULL,
    "dietary_tag_id" SMALLINT NOT NULL,

    CONSTRAINT "donation_dietary_tags_pkey" PRIMARY KEY ("donation_id","dietary_tag_id")
);

-- CreateTable
CREATE TABLE "donation_exits" (
    "donation_id" UUID NOT NULL,
    "exit_status" "donation_status" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "user_role",
    "screening_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_exits_pkey" PRIMARY KEY ("donation_id")
);

-- CreateTable
CREATE TABLE "donation_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "image_role" "image_role" NOT NULL DEFAULT 'FOOD_PHOTO',
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "donation_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_message_reads" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_message_reads_pkey" PRIMARY KEY ("message_id","user_id")
);

-- CreateTable
CREATE TABLE "donation_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "donation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_pickup_inspections" (
    "donation_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "photo_image_id" UUID,
    "screening_id" UUID,
    "matches_description" BOOLEAN NOT NULL,
    "packaging_sealed_clean" BOOLEAN NOT NULL,
    "looks_smells_normal" BOOLEAN NOT NULL,
    "decision" "pickup_decision" NOT NULL,
    "reason" TEXT,
    "inspected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_pickup_inspections_pkey" PRIMARY KEY ("donation_id")
);

-- CreateTable
CREATE TABLE "donation_qr_scans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "stage" "qr_scan_stage" NOT NULL,
    "scanned_by_user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_qr_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donation_safety_checklists" (
    "donation_id" UUID NOT NULL,
    "prepared_at" TIMESTAMPTZ(6),
    "consume_by_at" TIMESTAMPTZ(6),
    "storage_condition" "storage_condition",
    "storage_temperature_c" DECIMAL(5,2),
    "packaging_intact" BOOLEAN,
    "allergens_confirmed" BOOLEAN,
    "not_customer_plate_leftovers" BOOLEAN,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_safety_checklists_pkey" PRIMARY KEY ("donation_id")
);

-- CreateTable
CREATE TABLE "donation_tracking_events" (
    "id" BIGSERIAL NOT NULL,
    "donation_id" UUID NOT NULL,
    "event_type" VARCHAR(20) NOT NULL DEFAULT 'TRANSITION',
    "from_status" "donation_status",
    "to_status" "donation_status" NOT NULL,
    "actor_user_id" UUID,
    "event_note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "donation_tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donor_id" UUID NOT NULL,
    "food_category_id" SMALLINT NOT NULL,
    "food_name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "portions" INTEGER NOT NULL,
    "status" "donation_status" NOT NULL DEFAULT 'DRAFT',
    "pickup_address_id" UUID,
    "pickup_start" TIMESTAMPTZ(6),
    "pickup_end" TIMESTAMPTZ(6),
    "posted_at" TIMESTAMPTZ(6),
    "accepted_by_id" UUID,
    "accepted_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "qr_token" TEXT,
    "qr_rotated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "donations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_categories" (
    "id" SMALLSERIAL NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "allowed_for_individuals" BOOLEAN NOT NULL DEFAULT false,
    "requires_prepared_time" BOOLEAN NOT NULL DEFAULT false,
    "requires_storage_info" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "food_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_screenings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "image_id" UUID,
    "provider" VARCHAR(80) NOT NULL,
    "model_version" VARCHAR(120),
    "verdict" "screening_verdict" NOT NULL,
    "confidence" DECIMAL(5,4),
    "signs" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_screenings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "host_organization" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "name" VARCHAR(180) NOT NULL,
    "mission" TEXT,
    "vision" TEXT,
    "goals" JSONB NOT NULL DEFAULT '[]',
    "organization_chart" JSONB NOT NULL DEFAULT '[]',
    "contact_email" VARCHAR(254),
    "contact_phone" VARCHAR(20),
    "address_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "incident_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "incident_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "reported_by_user_id" UUID NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "incident_status" NOT NULL DEFAULT 'OPEN',
    "resolution_note" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "suspended_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "notification_type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "body" TEXT NOT NULL,
    "related_donation_id" UUID,
    "related_incident_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "email" VARCHAR(254) NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unusable_portions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "donation_id" UUID NOT NULL,
    "portions" INTEGER NOT NULL,
    "reason" "unusable_reason" NOT NULL,
    "note" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unusable_portions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "user_id" UUID NOT NULL,
    "achievement_id" SMALLINT NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "user_achievements_pkey" PRIMARY KEY ("user_id","achievement_id")
);

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "consent_type" VARCHAR(40) NOT NULL,
    "policy_version" VARCHAR(30) NOT NULL,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_address" INET,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ(6),
    "failed_login_count" SMALLINT NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "document_type_id" SMALLINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "reviewed_by_user_id" UUID NOT NULL,
    "resulting_status" "account_status" NOT NULL,
    "reason" TEXT,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role" "user_role" NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'PENDING',
    "full_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "contact_number" VARCHAR(20) NOT NULL,
    "donor_type" "donor_type",
    "business_name" VARCHAR(180),
    "address_id" UUID,
    "availability" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "achievements_code_key" ON "achievements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "allergens_code_key" ON "allergens"("code");

-- CreateIndex
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs"("actor_user_id", "occurred_at" DESC) WHERE (actor_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "audit_logs_target_idx" ON "audit_logs"("target_type", "target_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_timeline_idx" ON "audit_logs"("occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_groups_code_key" ON "beneficiary_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_groups_name_key" ON "beneficiary_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "dietary_tags_code_key" ON "dietary_tags"("code");

-- CreateIndex
CREATE INDEX "distribution_entries_donation_idx" ON "distribution_entries"("donation_id", "distributed_on");

-- CreateIndex
CREATE INDEX "distribution_entries_group_idx" ON "distribution_entries"("group_id");

-- CreateIndex
CREATE INDEX "distribution_entries_recorded_by_idx" ON "distribution_entries"("recorded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_entry_photos_storage_key_key" ON "distribution_entry_photos"("storage_key");

-- CreateIndex
CREATE INDEX "distribution_entry_photos_entry_idx" ON "distribution_entry_photos"("entry_id");

-- CreateIndex
CREATE INDEX "distribution_entry_photos_uploaded_by_idx" ON "distribution_entry_photos"("uploaded_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");

-- CreateIndex
CREATE INDEX "donation_allergens_allergen_idx" ON "donation_allergens"("allergen_id");

-- CreateIndex
CREATE UNIQUE INDEX "donation_assignments_one_current_uq" ON "donation_assignments"("donation_id") WHERE (ended_at IS NULL);

-- CreateIndex
CREATE INDEX "donation_assignments_assigned_by_idx" ON "donation_assignments"("assigned_by_id");

-- CreateIndex
CREATE INDEX "donation_assignments_donation_idx" ON "donation_assignments"("donation_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "donation_assignments_volunteer_idx" ON "donation_assignments"("volunteer_id") WHERE (ended_at IS NULL);

-- CreateIndex
CREATE INDEX "donation_dietary_tags_tag_idx" ON "donation_dietary_tags"("dietary_tag_id");

-- CreateIndex
CREATE INDEX "donation_exits_actor_idx" ON "donation_exits"("actor_user_id") WHERE (actor_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "donation_exits_screening_idx" ON "donation_exits"("screening_id") WHERE (screening_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "donation_images_one_food_photo_uq" ON "donation_images"("donation_id") WHERE ((image_role = 'FOOD_PHOTO'::image_role) AND (deleted_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "donation_images_storage_key_key" ON "donation_images"("storage_key");

-- CreateIndex
CREATE INDEX "donation_images_donation_idx" ON "donation_images"("donation_id", "created_at") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "donation_images_uploaded_by_idx" ON "donation_images"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "message_reads_user_idx" ON "donation_message_reads"("user_id");

-- CreateIndex
CREATE INDEX "messages_sender_idx" ON "donation_messages"("sender_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_thread_idx" ON "donation_messages"("donation_id", "created_at") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "pickup_inspections_photo_idx" ON "donation_pickup_inspections"("photo_image_id") WHERE (photo_image_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "pickup_inspections_screening_idx" ON "donation_pickup_inspections"("screening_id") WHERE (screening_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "pickup_inspections_volunteer_idx" ON "donation_pickup_inspections"("volunteer_id");

-- CreateIndex
CREATE INDEX "donation_qr_scans_scanned_by_idx" ON "donation_qr_scans"("scanned_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "donation_qr_scans_donation_id_stage_key" ON "donation_qr_scans"("donation_id", "stage");

-- CreateIndex
CREATE INDEX "tracking_actor_idx" ON "donation_tracking_events"("actor_user_id", "occurred_at" DESC) WHERE (actor_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "tracking_donation_timeline_idx" ON "donation_tracking_events"("donation_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "donations_qr_token_key" ON "donations"("qr_token");

-- CreateIndex
CREATE INDEX "donations_accepted_by_idx" ON "donations"("accepted_by_id") WHERE (accepted_by_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "donations_admin_queue_idx" ON "donations"("pickup_end") WHERE ((status = 'POSTED'::donation_status) AND (deleted_at IS NULL));

-- CreateIndex
CREATE INDEX "donations_category_status_idx" ON "donations"("food_category_id", "status") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "donations_donor_status_idx" ON "donations"("donor_id", "status", "created_at" DESC) WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "donations_expiry_idx" ON "donations"("pickup_end") WHERE (status = ANY (ARRAY['POSTED'::donation_status, 'ACCEPTED'::donation_status, 'ASSIGNED'::donation_status]));

-- CreateIndex
CREATE INDEX "donations_pickup_address_idx" ON "donations"("pickup_address_id") WHERE (pickup_address_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "food_categories_code_key" ON "food_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "food_categories_name_key" ON "food_categories"("name");

-- CreateIndex
CREATE INDEX "food_screenings_donation_idx" ON "food_screenings"("donation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "food_screenings_image_idx" ON "food_screenings"("image_id") WHERE (image_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "food_screenings_review_queue_idx" ON "food_screenings"("created_at") WHERE ((verdict = 'REVIEW'::screening_verdict) AND (reviewed_at IS NULL));

-- CreateIndex
CREATE INDEX "food_screenings_reviewed_by_idx" ON "food_screenings"("reviewed_by_user_id") WHERE (reviewed_by_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "host_organization_address_idx" ON "host_organization"("address_id") WHERE (address_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "incident_attachments_storage_key_key" ON "incident_attachments"("storage_key");

-- CreateIndex
CREATE INDEX "incident_attachments_incident_idx" ON "incident_attachments"("incident_id") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "incident_attachments_uploaded_by_idx" ON "incident_attachments"("uploaded_by_user_id");

-- CreateIndex
CREATE INDEX "incidents_donation_idx" ON "incidents"("donation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_queue_idx" ON "incidents"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_reported_by_idx" ON "incidents"("reported_by_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_resolved_by_idx" ON "incidents"("resolved_by_user_id") WHERE (resolved_by_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "incidents_suspended_user_idx" ON "incidents"("suspended_user_id") WHERE (suspended_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "notifications_read_cleanup_idx" ON "notifications"("read_at") WHERE (read_at IS NOT NULL);

-- CreateIndex
CREATE INDEX "notifications_related_donation_idx" ON "notifications"("related_donation_id") WHERE (related_donation_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "notifications_related_incident_idx" ON "notifications"("related_incident_id") WHERE (related_incident_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "notifications_unread_idx" ON "notifications"("user_id", "created_at" DESC) WHERE (read_at IS NULL);

-- CreateIndex
CREATE INDEX "one_time_codes_expires_idx" ON "one_time_codes"("expires_at");

-- CreateIndex
CREATE INDEX "otp_rate_limit_idx" ON "one_time_codes"("email", "purpose", "created_at" DESC);

-- CreateIndex
CREATE INDEX "otp_user_idx" ON "one_time_codes"("user_id", "created_at" DESC) WHERE (user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "unusable_portions_donation_idx" ON "unusable_portions"("donation_id");

-- CreateIndex
CREATE INDEX "unusable_portions_recorded_by_idx" ON "unusable_portions"("recorded_by_user_id");

-- CreateIndex
CREATE INDEX "user_achievements_achievement_idx" ON "user_achievements"("achievement_id");

-- CreateIndex
CREATE INDEX "user_consents_user_idx" ON "user_consents"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_consents_user_id_consent_type_policy_version_key" ON "user_consents"("user_id", "consent_type", "policy_version");

-- CreateIndex
CREATE UNIQUE INDEX "user_documents_storage_key_key" ON "user_documents"("storage_key");

-- CreateIndex
CREATE INDEX "user_documents_review_queue_idx" ON "user_documents"("created_at") WHERE ((status = 'PENDING'::document_status) AND (deleted_at IS NULL));

-- CreateIndex
CREATE INDEX "user_documents_reviewed_by_idx" ON "user_documents"("reviewed_by_user_id") WHERE (reviewed_by_user_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "user_documents_type_idx" ON "user_documents"("document_type_id");

-- CreateIndex
CREATE INDEX "user_documents_user_idx" ON "user_documents"("user_id", "status") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "user_reviews_reviewer_idx" ON "user_reviews"("reviewed_by_user_id");

-- CreateIndex
CREATE INDEX "user_reviews_user_idx" ON "user_reviews"("user_id", "reviewed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_active_uq" ON "users"("email") WHERE (deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "users_address_idx" ON "users"("address_id") WHERE (address_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "users_pending_queue_idx" ON "users"("created_at") WHERE ((status = 'PENDING'::account_status) AND (deleted_at IS NULL));

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status") WHERE (deleted_at IS NULL);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distribution_entries" ADD CONSTRAINT "distribution_entries_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distribution_entries" ADD CONSTRAINT "distribution_entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "beneficiary_groups"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distribution_entries" ADD CONSTRAINT "distribution_entries_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distribution_entry_photos" ADD CONSTRAINT "distribution_entry_photos_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "distribution_entries"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "distribution_entry_photos" ADD CONSTRAINT "distribution_entry_photos_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_allergens" ADD CONSTRAINT "donation_allergens_allergen_id_fkey" FOREIGN KEY ("allergen_id") REFERENCES "allergens"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_allergens" ADD CONSTRAINT "donation_allergens_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_assignments" ADD CONSTRAINT "donation_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_assignments" ADD CONSTRAINT "donation_assignments_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_assignments" ADD CONSTRAINT "donation_assignments_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_dietary_tags" ADD CONSTRAINT "donation_dietary_tags_dietary_tag_id_fkey" FOREIGN KEY ("dietary_tag_id") REFERENCES "dietary_tags"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_dietary_tags" ADD CONSTRAINT "donation_dietary_tags_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_exits" ADD CONSTRAINT "donation_exits_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_exits" ADD CONSTRAINT "donation_exits_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_exits" ADD CONSTRAINT "donation_exits_screening_id_fkey" FOREIGN KEY ("screening_id") REFERENCES "food_screenings"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_images" ADD CONSTRAINT "donation_images_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_images" ADD CONSTRAINT "donation_images_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_message_reads" ADD CONSTRAINT "donation_message_reads_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "donation_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_message_reads" ADD CONSTRAINT "donation_message_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_messages" ADD CONSTRAINT "donation_messages_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_messages" ADD CONSTRAINT "donation_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_pickup_inspections" ADD CONSTRAINT "donation_pickup_inspections_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_pickup_inspections" ADD CONSTRAINT "donation_pickup_inspections_photo_image_id_fkey" FOREIGN KEY ("photo_image_id") REFERENCES "donation_images"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_pickup_inspections" ADD CONSTRAINT "donation_pickup_inspections_screening_id_fkey" FOREIGN KEY ("screening_id") REFERENCES "food_screenings"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_pickup_inspections" ADD CONSTRAINT "donation_pickup_inspections_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_qr_scans" ADD CONSTRAINT "donation_qr_scans_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_qr_scans" ADD CONSTRAINT "donation_qr_scans_scanned_by_user_id_fkey" FOREIGN KEY ("scanned_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_safety_checklists" ADD CONSTRAINT "donation_safety_checklists_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_tracking_events" ADD CONSTRAINT "donation_tracking_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donation_tracking_events" ADD CONSTRAINT "donation_tracking_events_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_id_fkey" FOREIGN KEY ("donor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_food_category_id_fkey" FOREIGN KEY ("food_category_id") REFERENCES "food_categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "donations" ADD CONSTRAINT "donations_pickup_address_id_fkey" FOREIGN KEY ("pickup_address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_screenings" ADD CONSTRAINT "food_screenings_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_screenings" ADD CONSTRAINT "food_screenings_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "donation_images"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_screenings" ADD CONSTRAINT "food_screenings_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "host_organization" ADD CONSTRAINT "host_organization_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incident_attachments" ADD CONSTRAINT "incident_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_suspended_user_id_fkey" FOREIGN KEY ("suspended_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_donation_id_fkey" FOREIGN KEY ("related_donation_id") REFERENCES "donations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_incident_id_fkey" FOREIGN KEY ("related_incident_id") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "one_time_codes" ADD CONSTRAINT "one_time_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unusable_portions" ADD CONSTRAINT "unusable_portions_donation_id_fkey" FOREIGN KEY ("donation_id") REFERENCES "donations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "unusable_portions" ADD CONSTRAINT "unusable_portions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_fkey" FOREIGN KEY ("achievement_id") REFERENCES "achievements"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_documents" ADD CONSTRAINT "user_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_reviews" ADD CONSTRAINT "user_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

