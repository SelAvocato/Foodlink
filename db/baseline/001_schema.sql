-- =====================================================================
-- FoodLink PostgreSQL schema v3
-- Target: PostgreSQL 15+ (Supabase compatible)
--
-- Replaces foodlink_schema_v2.sql + foodlink_schema_v2_1.sql + foodlink_db_objects.sql.
-- Fresh-install script, written from "FoodLink - Database documentation review"
-- (Oct 31, 2026) so it matches the System Structure & Development Plan.
-- Finding IDs from the review (A1, B5, C3 ...) are noted in comments.
--
-- Review status (Nov 1, 2026): applied cleanly on PostgreSQL 16 (this file first, then
-- foodlink_db_objects_v3.sql). Not yet tested on PostgreSQL 15, Supabase or Prisma.
--
-- Design rules (review C1, C2, C3, C7, C8):
--   * transitionDonation() in the application is the ONLY writer of status
--     changes, tracking events, notifications and audit logs. There are no
--     status, notification, expiry or audit triggers here.
--   * The allowed-transition table lives in the application. The database only
--     keeps hard constraints (CHECK, UNIQUE, append-only) plus a few small,
--     non-deferred guards on money-like data (portions) and roles.
--   * No pg_cron, no DDL event trigger, no superuser-only objects (C12).
--
-- Prisma (C11): treat this file as the baseline migration. Prisma cannot
-- express the triggers, views, partial unique indexes or CHECK constraints
-- below, so keep them as hand-written SQL inside a Prisma migration.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
-- A1: RECEIVER removed from every enum.
CREATE TYPE user_role AS ENUM ('DONOR', 'VOLUNTEER', 'ADMIN');

-- A6: one status model for every account (Donor and Volunteer self-register).
CREATE TYPE account_status AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED');

-- A4
CREATE TYPE donor_type AS ENUM ('ESTABLISHMENT', 'INDIVIDUAL');

-- B1: the 13 values from the System document (CLAIMED -> ACCEPTED, RECEIVED removed).
CREATE TYPE donation_status AS ENUM (
  'DRAFT', 'SCREENED', 'POSTED', 'ACCEPTED', 'ASSIGNED',
  'PICKED_UP', 'DELIVERED', 'CLOSED',
  'REJECTED', 'DECLINED', 'REJECTED_AT_PICKUP', 'CANCELLED', 'EXPIRED'
);

CREATE TYPE screening_verdict  AS ENUM ('PASS', 'FLAG', 'REVIEW');
CREATE TYPE incident_status    AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'DISMISSED');
CREATE TYPE document_status    AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
-- B8: storage condition (cooked meals). ASSUMED values: confirm with the team.
CREATE TYPE storage_condition  AS ENUM ('ROOM_TEMPERATURE', 'HOT_HELD', 'REFRIGERATED', 'FROZEN');
-- B10
CREATE TYPE image_role         AS ENUM ('FOOD_PHOTO', 'PICKUP_PHOTO', 'HANDOVER_PROOF');
CREATE TYPE pickup_decision    AS ENUM ('ACCEPTED', 'REJECTED');
-- B12
CREATE TYPE qr_scan_stage      AS ENUM ('PICKUP', 'DROPOFF');
-- B11
CREATE TYPE unusable_reason    AS ENUM ('SPOILED_ON_ARRIVAL', 'DAMAGED', 'OTHER');
-- A7: EMAIL_VERIFICATION dropped. The System document uses one-time codes for password
-- reset only. Add 'LOGIN' only if the team decides to build one-time-code login.
CREATE TYPE otp_purpose        AS ENUM ('PASSWORD_RESET');
-- A8
CREATE TYPE achievement_metric AS ENUM (
  'DONATIONS_COMPLETED', 'PORTIONS_DONATED', 'PEOPLE_SERVED',   -- Donors
  'TASKS_COMPLETED'                                              -- Volunteers
);

-- ---------------------------------------------------------------------
-- Generic trigger functions
-- ---------------------------------------------------------------------
CREATE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

-- ---------------------------------------------------------------------
-- Addresses (immutable rows: to change an address insert a new row and repoint,
-- so past donations keep their original pickup address)
-- ---------------------------------------------------------------------
CREATE TABLE addresses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  street_line1      varchar(200) NOT NULL,
  street_line2      varchar(200),
  barangay          varchar(120),
  city              varchar(120) NOT NULL,
  province_or_state varchar(120),
  postal_code       varchar(20),
  country_code      char(2) NOT NULL DEFAULT 'PH',
  latitude          numeric(9,6),                    -- map pin
  longitude         numeric(9,6),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_country_upper    CHECK (country_code = upper(country_code)),
  CONSTRAINT addresses_latitude_range   CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  CONSTRAINT addresses_longitude_range  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT addresses_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL))
);

-- ---------------------------------------------------------------------
-- A2: HostOrganization (single row; public landing-page information)
-- ---------------------------------------------------------------------
CREATE TABLE host_organization (
  id                 smallint PRIMARY KEY DEFAULT 1,
  name               varchar(180) NOT NULL,
  mission            text,
  vision             text,
  goals              jsonb NOT NULL DEFAULT '[]'::jsonb,
  organization_chart jsonb NOT NULL DEFAULT '[]'::jsonb,
  contact_email      varchar(254),
  contact_phone      varchar(20),
  address_id         uuid REFERENCES addresses(id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT host_organization_single_row CHECK (id = 1),
  CONSTRAINT host_organization_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT host_organization_goals_array CHECK (jsonb_typeof(goals) = 'array'),
  CONSTRAINT host_organization_chart_type CHECK (jsonb_typeof(organization_chart) IN ('array', 'object'))
);

-- ---------------------------------------------------------------------
-- Users (A3, A4, A6, A10): standalone accounts, no organization table.
-- Donors and Volunteers self-register and wait for Admin approval.
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role           user_role NOT NULL,
  status         account_status NOT NULL DEFAULT 'PENDING',
  full_name      varchar(160) NOT NULL,
  email          varchar(254) NOT NULL,
  contact_number varchar(20) NOT NULL,
  donor_type     donor_type,                         -- DONOR only, fixed after approval
  business_name  varchar(180),                       -- ESTABLISHMENT donors only
  address_id     uuid REFERENCES addresses(id) ON DELETE RESTRICT,
  availability   text,                               -- optional, Volunteers only
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT users_full_name_not_blank CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT users_email_normalized    CHECK (email = lower(btrim(email))),
  CONSTRAINT users_contact_number_fmt  CHECK (contact_number ~ '^\+?[0-9]{7,15}$'),
  CONSTRAINT users_donor_type_by_role  CHECK ((role = 'DONOR') = (donor_type IS NOT NULL)),
  CONSTRAINT users_business_name_rule  CHECK (
    (donor_type IS DISTINCT FROM 'ESTABLISHMENT' AND business_name IS NULL)
    OR (donor_type = 'ESTABLISHMENT' AND business_name IS NOT NULL AND length(btrim(business_name)) > 0)
  ),
  -- Address (with map pin) is part of both Donor and Volunteer registration.
  CONSTRAINT users_donor_volunteer_need_address CHECK (role NOT IN ('DONOR', 'VOLUNTEER') OR address_id IS NOT NULL),
  CONSTRAINT users_availability_volunteer_only CHECK (availability IS NULL OR role = 'VOLUNTEER')
);

-- 1:1 with users. Auth.js uses stateless JWT sessions, so there is no sessions table (A7).
CREATE TABLE user_credentials (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash       text NOT NULL,                 -- argon2id/bcrypt hash only
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  failed_login_count  smallint NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Versioned consent history (system requires recorded consent, section 8)
CREATE TABLE user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_type   varchar(40) NOT NULL,               -- e.g. PRIVACY_POLICY, TERMS
  policy_version varchar(30) NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  ip_address     inet,
  UNIQUE (user_id, consent_type, policy_version),
  CONSTRAINT user_consents_revoke_order CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- A6: approval / rejection / suspension history, one row per Admin decision
CREATE TABLE user_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  resulting_status    account_status NOT NULL CHECK (resulting_status <> 'PENDING'),
  reason              text,                          -- emailed to the user on rejection
  reviewed_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_reviews_reason_required CHECK (
    resulting_status NOT IN ('REJECTED', 'SUSPENDED')
    OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

-- ---------------------------------------------------------------------
-- Proof documents (A6): business permit (establishments) or valid ID.
-- Upload rule matches the project rule: JPEG, PNG or WebP, up to 5 MB (no PDF).
-- To accept PDFs, add 'application/pdf' to the CHECK and raise the size limit.
-- ---------------------------------------------------------------------
CREATE TABLE document_types (
  id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      varchar(40) NOT NULL UNIQUE,
  name      varchar(120) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE user_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_type_id    smallint NOT NULL REFERENCES document_types(id) ON DELETE RESTRICT,
  storage_key         text NOT NULL UNIQUE,          -- opaque key in private object storage
  original_filename   varchar(255) NOT NULL,
  mime_type           varchar(100) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes          bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  status              document_status NOT NULL DEFAULT 'PENDING',
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT user_documents_review_fields CHECK (
    (status = 'PENDING' AND reviewed_at IS NULL)
    OR (status <> 'PENDING' AND reviewed_at IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------
-- A5 + B8: the flags let the server enforce donor-type limits and the
-- conditional safety checklist without hard-coding category names.
CREATE TABLE food_categories (
  id                     smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                   varchar(40) NOT NULL UNIQUE,
  name                   varchar(80) NOT NULL UNIQUE,
  allowed_for_individuals boolean NOT NULL DEFAULT false,  -- sealed packaged food, sealed beverages, whole fresh produce
  requires_prepared_time  boolean NOT NULL DEFAULT false,  -- cooked meals and bakery
  requires_storage_info   boolean NOT NULL DEFAULT false,  -- cooked meals: storage condition + temperature
  is_active              boolean NOT NULL DEFAULT true
);

CREATE TABLE allergens (
  id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      varchar(40) NOT NULL UNIQUE,
  name      varchar(80) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE dietary_tags (
  id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      varchar(40) NOT NULL UNIQUE,
  name      varchar(80) NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);

-- Groups served are picked from this list, never typed as free text, so reports
-- cannot contain the name of an individual beneficiary. Labels are still unconfirmed
-- with the beneficiary; being a table, they can be edited without a schema change.
CREATE TABLE beneficiary_groups (
  id        smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code      varchar(40) NOT NULL UNIQUE,
  name      varchar(80) NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- Donations
-- ---------------------------------------------------------------------
-- B7: quantity is whole portions. D5: pickup_end is the single source of truth
-- for expiry (there is no expires_at). B3: acceptance lives on the donation.
-- Atomic accept (B4, D2) is done in application code:
--   UPDATE donations
--      SET status = 'ACCEPTED', accepted_by_id = $1, accepted_at = now()
--    WHERE id = $2 AND status = 'POSTED' AND pickup_end > now();
CREATE TABLE donations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donor_id          uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  food_category_id  smallint NOT NULL REFERENCES food_categories(id) ON DELETE RESTRICT,
  food_name         varchar(160) NOT NULL,
  description       text,
  portions          integer NOT NULL CHECK (portions > 0),
  status            donation_status NOT NULL DEFAULT 'DRAFT',
  pickup_address_id uuid REFERENCES addresses(id) ON DELETE RESTRICT,
  pickup_start      timestamptz,
  pickup_end        timestamptz,
  posted_at         timestamptz,
  accepted_by_id    uuid REFERENCES users(id) ON DELETE RESTRICT,   -- Admin who accepted
  accepted_at       timestamptz,
  closed_at         timestamptz,
  qr_token          text UNIQUE,                                    -- random 32 bytes, base64url, set at posting
  qr_rotated_at     timestamptz,                                    -- set when the label is revoked and replaced
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,                                    -- D4: discard drafts
  CONSTRAINT donations_food_name_not_blank CHECK (length(btrim(food_name)) > 0),
  CONSTRAINT donations_pickup_all_or_none CHECK (
    (pickup_address_id IS NULL) = (pickup_start IS NULL)
    AND (pickup_start IS NULL) = (pickup_end IS NULL)
  ),
  CONSTRAINT donations_pickup_window CHECK (pickup_end IS NULL OR pickup_end > pickup_start),
  CONSTRAINT donations_posting_fields CHECK (
    status NOT IN ('POSTED', 'ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CLOSED')
    OR (posted_at IS NOT NULL AND pickup_start IS NOT NULL AND qr_token IS NOT NULL)
  ),
  CONSTRAINT donations_qr_token_format CHECK (qr_token IS NULL OR qr_token ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT donations_accept_pair CHECK ((accepted_by_id IS NULL) = (accepted_at IS NULL)),
  CONSTRAINT donations_accept_fields CHECK (
    status NOT IN ('ACCEPTED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CLOSED')
    OR accepted_by_id IS NOT NULL
  ),
  CONSTRAINT donations_closed_fields CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

-- 1:1 safety checklist (B8, B9)
CREATE TABLE donation_safety_checklists (
  donation_id                  uuid PRIMARY KEY REFERENCES donations(id) ON DELETE CASCADE,
  prepared_at                  timestamptz,           -- cooked meals and bakery only
  consume_by_at                timestamptz,
  storage_condition            storage_condition,     -- cooked meals only
  storage_temperature_c        numeric(5,2) CHECK (storage_temperature_c IS NULL OR storage_temperature_c BETWEEN -50 AND 100),
  packaging_intact             boolean,
  allergens_confirmed          boolean,               -- B9: donor confirmed allergens are declared (true even when there are none)
  not_customer_plate_leftovers boolean,
  completed_at                 timestamptz,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_consume_after_prepared CHECK (
    prepared_at IS NULL OR consume_by_at IS NULL OR consume_by_at > prepared_at
  ),
  CONSTRAINT checklist_confirmations_required CHECK (
    completed_at IS NULL
    OR (
      consume_by_at IS NOT NULL
      AND packaging_intact IS TRUE
      AND allergens_confirmed IS TRUE
      AND not_customer_plate_leftovers IS TRUE
    )
  )
);

-- M:M donations <-> allergens (the list of allergens; the confirmation is on the checklist)
CREATE TABLE donation_allergens (
  donation_id uuid NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  allergen_id smallint NOT NULL REFERENCES allergens(id) ON DELETE RESTRICT,
  PRIMARY KEY (donation_id, allergen_id)
);

-- M:M donations <-> dietary_tags (donor-declared, not verified)
CREATE TABLE donation_dietary_tags (
  donation_id    uuid NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  dietary_tag_id smallint NOT NULL REFERENCES dietary_tags(id) ON DELETE RESTRICT,
  PRIMARY KEY (donation_id, dietary_tag_id)
);

-- B3: assignment history. The row with ended_at IS NULL is the current Volunteer.
-- Reassignment (while ASSIGNED, or DELIVERED with an unfinished report) ends the
-- current row and inserts a new one (D3).
CREATE TABLE donation_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id    uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  volunteer_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_by_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  ended_at       timestamptz,
  end_reason     text,
  CONSTRAINT assignments_end_order  CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  CONSTRAINT assignments_end_reason CHECK (end_reason IS NULL OR ended_at IS NOT NULL)
);

-- ---------------------------------------------------------------------
-- Images, screening, pickup inspection
-- ---------------------------------------------------------------------
CREATE TABLE donation_images (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id         uuid NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key         text NOT NULL UNIQUE,
  image_role          image_role NOT NULL DEFAULT 'FOOD_PHOTO',
  mime_type           varchar(100) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes          bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Advisory only: AI screening does not prove food safety.
-- Used for the donor's photo (visual screening) and the Volunteer's pickup photo.
CREATE TABLE food_screenings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id         uuid NOT NULL REFERENCES donations(id) ON DELETE CASCADE,
  image_id            uuid REFERENCES donation_images(id) ON DELETE SET NULL,
  provider            varchar(80) NOT NULL,
  model_version       varchar(120),
  verdict             screening_verdict NOT NULL,
  confidence          numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  signs               jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(signs) = 'array'),
  notes               text,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT screenings_review_pair CHECK (reviewed_by_user_id IS NULL OR reviewed_at IS NOT NULL)
);

-- B10: Volunteer pickup inspection (1:1). A FLAG verdict or any "no" blocks accepting.
CREATE TABLE donation_pickup_inspections (
  donation_id    uuid PRIMARY KEY REFERENCES donations(id) ON DELETE RESTRICT,
  volunteer_id   uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  photo_image_id uuid REFERENCES donation_images(id) ON DELETE RESTRICT,   -- optional only when rejecting
  screening_id   uuid REFERENCES food_screenings(id) ON DELETE SET NULL,
  matches_description    boolean NOT NULL,
  packaging_sealed_clean boolean NOT NULL,
  looks_smells_normal    boolean NOT NULL,
  decision       pickup_decision NOT NULL,
  reason         text,
  inspected_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_accept_needs_all_yes CHECK (
    decision <> 'ACCEPTED' OR (matches_description AND packaging_sealed_clean AND looks_smells_normal)
  ),
  CONSTRAINT inspection_accept_needs_photo CHECK (
    decision = 'REJECTED' OR photo_image_id IS NOT NULL
  ),
  CONSTRAINT inspection_reject_needs_reason CHECK (
    decision <> 'REJECTED' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

-- ---------------------------------------------------------------------
-- B2, B6: one generic exit record for REJECTED, DECLINED, REJECTED_AT_PICKUP, CANCELLED.
-- The application writes it in the same transaction as the status change.
-- ---------------------------------------------------------------------
CREATE TABLE donation_exits (
  donation_id   uuid PRIMARY KEY REFERENCES donations(id) ON DELETE CASCADE,
  exit_status   donation_status NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,   -- NULL only for an automatic REJECTED
  actor_role    user_role,                                      -- filled from users.role by trigger
  screening_id  uuid REFERENCES food_screenings(id) ON DELETE SET NULL,
  reason        text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exits_status_allowed CHECK (
    exit_status IN ('REJECTED', 'DECLINED', 'REJECTED_AT_PICKUP', 'CANCELLED')
  ),
  CONSTRAINT exits_actor_pair CHECK ((actor_user_id IS NULL) = (actor_role IS NULL)),
  CONSTRAINT exits_actor_required CHECK (exit_status = 'REJECTED' OR actor_user_id IS NOT NULL),
  CONSTRAINT exits_actor_role CHECK (
    CASE exit_status
      WHEN 'DECLINED'           THEN actor_role IS NOT DISTINCT FROM 'ADMIN'
      WHEN 'REJECTED_AT_PICKUP' THEN actor_role IS NOT DISTINCT FROM 'VOLUNTEER'
      WHEN 'CANCELLED'          THEN COALESCE(actor_role IN ('ADMIN', 'DONOR'), false)
      ELSE true
    END
  ),
  -- Reason required: DECLINED, REJECTED_AT_PICKUP, and CANCELLED by an Admin.
  CONSTRAINT exits_reason_required CHECK (
    NOT (
      exit_status IN ('DECLINED', 'REJECTED_AT_PICKUP')
      OR (exit_status = 'CANCELLED' AND actor_role = 'ADMIN')
    )
    OR (reason IS NOT NULL AND length(btrim(reason)) > 0)
  )
);

-- ---------------------------------------------------------------------
-- B12: QR label. The token is a random 32-byte value (base64url, 43 characters) generated
-- by the application at posting and stored in donations.qr_token (unique index), so the
-- Donor can always see or save the label again and the scan URL needs no raw donation id:
-- the server finds the donation from the token. To revoke a leaked or reprinted label,
-- generate a new random token, store it and set qr_rotated_at; the old token stops working.
-- Scans are events with a stage; (donation_id, stage) is unique, so a repeated
-- scan is a no-op (INSERT ... ON CONFLICT DO NOTHING).
-- ---------------------------------------------------------------------
CREATE TABLE donation_qr_scans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id        uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  stage              qr_scan_stage NOT NULL,
  scanned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scanned_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (donation_id, stage)
);

-- ---------------------------------------------------------------------
-- B11: distribution entries and portion reconciliation.
-- No beneficiary names are stored, only counts.
-- Rule: distributed + unusable = portions donated before the donation can be CLOSED.
-- ---------------------------------------------------------------------
CREATE TABLE distribution_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id          uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  distributed_on       date NOT NULL,
  place                varchar(200) NOT NULL CHECK (length(btrim(place)) > 0),   -- distribution site or barangay area, never a home address (validate and hint in the app)
  group_id             smallint NOT NULL REFERENCES beneficiary_groups(id) ON DELETE RESTRICT,
  people_served        integer NOT NULL CHECK (people_served > 0),
  portions_distributed integer NOT NULL CHECK (portions_distributed > 0),
  notes                text,
  recorded_by_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE distribution_entry_photos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id            uuid NOT NULL REFERENCES distribution_entries(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key         text NOT NULL UNIQUE,
  mime_type           varchar(100) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes          bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unusable_portions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id         uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  portions            integer NOT NULL CHECK (portions > 0),
  reason              unusable_reason NOT NULL,
  note                text,
  recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unusable_other_needs_note CHECK (
    reason <> 'OTHER' OR (note IS NOT NULL AND length(btrim(note)) > 0)
  )
);

-- ---------------------------------------------------------------------
-- Tracking timeline (append-only). Written ONLY by transitionDonation() (C1).
-- Photos and reasons for the timeline go in metadata.
-- ---------------------------------------------------------------------
CREATE TABLE donation_tracking_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  donation_id   uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  event_type    varchar(20) NOT NULL DEFAULT 'TRANSITION' CHECK (event_type IN ('TRANSITION', 'REASSIGNED')),
  from_status   donation_status,
  to_status     donation_status NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  event_note    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  -- D3: a reassignment does not change status
  CONSTRAINT tracking_reassign_same_status CHECK (event_type <> 'REASSIGNED' OR from_status = to_status)
);

-- ---------------------------------------------------------------------
-- Incidents (B13), messaging (B14), notifications
-- ---------------------------------------------------------------------
CREATE TABLE incidents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id         uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  reported_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title               varchar(180) NOT NULL,
  description         text NOT NULL,
  status              incident_status NOT NULL DEFAULT 'OPEN',
  resolution_note     text,
  resolved_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at         timestamptz,
  suspended_user_id   uuid REFERENCES users(id) ON DELETE RESTRICT,   -- account suspended as a result, if any
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_resolution_consistency CHECK (
    (status IN ('RESOLVED', 'DISMISSED')
       AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL
       AND resolution_note IS NOT NULL AND length(btrim(resolution_note)) > 0)
    OR (status NOT IN ('RESOLVED', 'DISMISSED') AND resolved_at IS NULL)
  ),
  CONSTRAINT incident_suspension_only_when_resolved CHECK (suspended_user_id IS NULL OR status = 'RESOLVED')
);

CREATE TABLE incident_attachments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id         uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key         text NOT NULL UNIQUE,
  original_filename   varchar(255) NOT NULL,
  mime_type           varchar(100) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes          bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- One thread per donation (donation_id). Opens at POSTED and is read-only once
-- CLOSED, CANCELLED, DECLINED or EXPIRED: enforced in application code (B14).
CREATE TABLE donation_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id    uuid NOT NULL REFERENCES donations(id) ON DELETE RESTRICT,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body           text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 5000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);

CREATE TABLE donation_message_reads (
  message_id uuid NOT NULL REFERENCES donation_messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- Created inside transitionDonation(); emails are sent after the transaction commits.
CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type   varchar(60) NOT NULL,
  title               varchar(180) NOT NULL,
  body                text NOT NULL,
  related_donation_id uuid REFERENCES donations(id) ON DELETE SET NULL,
  related_incident_id uuid REFERENCES incidents(id) ON DELETE SET NULL,
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Audit (append-only) and one-time codes
-- ---------------------------------------------------------------------
-- C7: the application writes a row for every transition, approval, suspension,
-- content change and incident resolution.
CREATE TABLE audit_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  action        varchar(100) NOT NULL,
  target_type   varchar(80) NOT NULL,
  target_id     text,
  ip_address    inet,
  user_agent    text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

-- 6-digit OTP (password reset), 5-minute expiry. Rate limit (max 3 per 15 minutes) is applied by the
-- application by counting recent rows per (email, purpose) on created_at (A9).
CREATE TABLE one_time_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE CASCADE,
  email         varchar(254) NOT NULL CHECK (email = lower(btrim(email))),
  purpose       otp_purpose NOT NULL,
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_expiry_after_creation CHECK (expires_at > created_at)
);

-- ---------------------------------------------------------------------
-- A8: achievements belong to users. Badge thresholds are still undecided, so
-- threshold is nullable and no badges are seeded.
-- ---------------------------------------------------------------------
CREATE TABLE achievements (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        varchar(80) NOT NULL UNIQUE,
  name        varchar(120) NOT NULL,
  description text,
  role        user_role NOT NULL CHECK (role IN ('DONOR', 'VOLUNTEER')),
  metric      achievement_metric NOT NULL,
  threshold   integer CHECK (threshold IS NULL OR threshold > 0),
  is_active   boolean NOT NULL DEFAULT true,
  CONSTRAINT achievements_metric_by_role CHECK (
    (role = 'DONOR'     AND metric IN ('DONATIONS_COMPLETED', 'PORTIONS_DONATED', 'PEOPLE_SERVED'))
    OR (role = 'VOLUNTEER' AND metric = 'TASKS_COMPLETED')
  )
);

CREATE TABLE user_achievements (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id smallint NOT NULL REFERENCES achievements(id) ON DELETE RESTRICT,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  PRIMARY KEY (user_id, achievement_id)
);

-- ---------------------------------------------------------------------
-- Indexes (PostgreSQL does not index referencing FK columns automatically)
-- ---------------------------------------------------------------------
-- users / accounts
CREATE UNIQUE INDEX users_email_active_uq ON users (email) WHERE deleted_at IS NULL;
CREATE INDEX users_role_status_idx ON users (role, status) WHERE deleted_at IS NULL;
CREATE INDEX users_pending_queue_idx ON users (created_at) WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX users_address_idx ON users (address_id) WHERE address_id IS NOT NULL;
CREATE INDEX host_organization_address_idx ON host_organization (address_id) WHERE address_id IS NOT NULL;
CREATE INDEX user_consents_user_idx ON user_consents (user_id);
CREATE INDEX user_reviews_user_idx ON user_reviews (user_id, reviewed_at DESC);
CREATE INDEX user_reviews_reviewer_idx ON user_reviews (reviewed_by_user_id);
CREATE INDEX user_documents_user_idx ON user_documents (user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX user_documents_review_queue_idx ON user_documents (created_at) WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX user_documents_type_idx ON user_documents (document_type_id);
CREATE INDEX user_documents_reviewed_by_idx ON user_documents (reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;

-- donations. C9: the Admin queue is ordered by soonest pickup_end.
CREATE INDEX donations_admin_queue_idx ON donations (pickup_end) WHERE status = 'POSTED' AND deleted_at IS NULL;
-- Expiry job: donations past pickup_end that are still open for pickup. ASSUMED statuses: adjust to the job's rule.
CREATE INDEX donations_expiry_idx ON donations (pickup_end) WHERE status IN ('POSTED', 'ACCEPTED', 'ASSIGNED');
CREATE INDEX donations_donor_status_idx ON donations (donor_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX donations_category_status_idx ON donations (food_category_id, status) WHERE deleted_at IS NULL;
CREATE INDEX donations_accepted_by_idx ON donations (accepted_by_id) WHERE accepted_by_id IS NOT NULL;
CREATE INDEX donations_pickup_address_idx ON donations (pickup_address_id) WHERE pickup_address_id IS NOT NULL;
CREATE INDEX donation_allergens_allergen_idx ON donation_allergens (allergen_id);
CREATE INDEX donation_dietary_tags_tag_idx ON donation_dietary_tags (dietary_tag_id);

-- assignments
CREATE UNIQUE INDEX donation_assignments_one_current_uq ON donation_assignments (donation_id) WHERE ended_at IS NULL;
CREATE INDEX donation_assignments_donation_idx ON donation_assignments (donation_id, assigned_at DESC);
CREATE INDEX donation_assignments_volunteer_idx ON donation_assignments (volunteer_id) WHERE ended_at IS NULL;
CREATE INDEX donation_assignments_assigned_by_idx ON donation_assignments (assigned_by_id);

-- images / screenings / inspections / exits / scans
CREATE INDEX donation_images_donation_idx ON donation_images (donation_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX donation_images_uploaded_by_idx ON donation_images (uploaded_by_user_id);
-- Version 1: one food photo per donation. A retake soft-deletes the previous photo
-- (sets deleted_at). Drop this index when more photos are allowed.
CREATE UNIQUE INDEX donation_images_one_food_photo_uq ON donation_images (donation_id)
  WHERE image_role = 'FOOD_PHOTO' AND deleted_at IS NULL;
CREATE INDEX food_screenings_donation_idx ON food_screenings (donation_id, created_at DESC);
CREATE INDEX food_screenings_review_queue_idx ON food_screenings (created_at) WHERE verdict = 'REVIEW' AND reviewed_at IS NULL;
CREATE INDEX food_screenings_image_idx ON food_screenings (image_id) WHERE image_id IS NOT NULL;
CREATE INDEX food_screenings_reviewed_by_idx ON food_screenings (reviewed_by_user_id) WHERE reviewed_by_user_id IS NOT NULL;
CREATE INDEX pickup_inspections_volunteer_idx ON donation_pickup_inspections (volunteer_id);
CREATE INDEX pickup_inspections_photo_idx ON donation_pickup_inspections (photo_image_id) WHERE photo_image_id IS NOT NULL;
CREATE INDEX pickup_inspections_screening_idx ON donation_pickup_inspections (screening_id) WHERE screening_id IS NOT NULL;
CREATE INDEX donation_exits_actor_idx ON donation_exits (actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX donation_exits_screening_idx ON donation_exits (screening_id) WHERE screening_id IS NOT NULL;
CREATE INDEX donation_qr_scans_scanned_by_idx ON donation_qr_scans (scanned_by_user_id);

-- distribution
CREATE INDEX distribution_entries_donation_idx ON distribution_entries (donation_id, distributed_on);
CREATE INDEX distribution_entries_recorded_by_idx ON distribution_entries (recorded_by_user_id);
CREATE INDEX distribution_entries_group_idx ON distribution_entries (group_id);
CREATE INDEX distribution_entry_photos_entry_idx ON distribution_entry_photos (entry_id);
CREATE INDEX distribution_entry_photos_uploaded_by_idx ON distribution_entry_photos (uploaded_by_user_id);
CREATE INDEX unusable_portions_donation_idx ON unusable_portions (donation_id);
CREATE INDEX unusable_portions_recorded_by_idx ON unusable_portions (recorded_by_user_id);

-- tracking / incidents / messages / notifications
CREATE INDEX tracking_donation_timeline_idx ON donation_tracking_events (donation_id, occurred_at);
CREATE INDEX tracking_actor_idx ON donation_tracking_events (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX incidents_queue_idx ON incidents (status, created_at DESC);
CREATE INDEX incidents_donation_idx ON incidents (donation_id, created_at DESC);
CREATE INDEX incidents_reported_by_idx ON incidents (reported_by_user_id, created_at DESC);
CREATE INDEX incidents_resolved_by_idx ON incidents (resolved_by_user_id) WHERE resolved_by_user_id IS NOT NULL;
CREATE INDEX incidents_suspended_user_idx ON incidents (suspended_user_id) WHERE suspended_user_id IS NOT NULL;
CREATE INDEX incident_attachments_incident_idx ON incident_attachments (incident_id) WHERE deleted_at IS NULL;
CREATE INDEX incident_attachments_uploaded_by_idx ON incident_attachments (uploaded_by_user_id);
CREATE INDEX messages_thread_idx ON donation_messages (donation_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX messages_sender_idx ON donation_messages (sender_user_id, created_at DESC);
CREATE INDEX message_reads_user_idx ON donation_message_reads (user_id);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_related_donation_idx ON notifications (related_donation_id) WHERE related_donation_id IS NOT NULL;
CREATE INDEX notifications_related_incident_idx ON notifications (related_incident_id) WHERE related_incident_id IS NOT NULL;

-- audit / otp / achievements
CREATE INDEX audit_logs_timeline_idx ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, occurred_at DESC) WHERE actor_user_id IS NOT NULL;
CREATE INDEX otp_rate_limit_idx ON one_time_codes (email, purpose, created_at DESC);
CREATE INDEX otp_user_idx ON one_time_codes (user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX user_achievements_achievement_idx ON user_achievements (achievement_id);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER host_organization_set_updated_at BEFORE UPDATE ON host_organization FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_credentials_set_updated_at BEFORE UPDATE ON user_credentials FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_documents_set_updated_at BEFORE UPDATE ON user_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER donations_set_updated_at BEFORE UPDATE ON donations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER donation_checklists_set_updated_at BEFORE UPDATE ON donation_safety_checklists FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER distribution_entries_set_updated_at BEFORE UPDATE ON distribution_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER incidents_set_updated_at BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- Append-only tables (kept, per the review appendix)
-- ---------------------------------------------------------------------
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER donation_tracking_events_append_only BEFORE UPDATE OR DELETE ON donation_tracking_events
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
-- TRUNCATE does not fire row triggers, so it needs its own statement-level trigger.
-- A test database that needs a reset should be dropped and recreated instead.
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
CREATE TRIGGER donation_tracking_events_no_truncate BEFORE TRUNCATE ON donation_tracking_events
  FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();

-- ---------------------------------------------------------------------
-- Small, non-deferred guards (no status, claim, notification or audit logic)
-- ---------------------------------------------------------------------

-- A4: role never changes; donor type is fixed once the account leaves PENDING.
CREATE FUNCTION guard_user_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'user role cannot be changed';
  END IF;
  IF NEW.donor_type IS DISTINCT FROM OLD.donor_type AND OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'donor type is fixed after approval';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_guard_identity
  BEFORE UPDATE OF role, donor_type ON users
  FOR EACH ROW EXECUTE FUNCTION guard_user_identity();

-- A5: the donor must be a DONOR user; individuals may only post allowed categories;
-- the accepting user must be an ADMIN. (Whether the donor is ACTIVE is checked in
-- transitionDonation(), C5.)
CREATE FUNCTION check_donation_parties()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role donor_type;
  v_user_role user_role;
  v_allowed boolean;
BEGIN
  SELECT role, donor_type INTO v_user_role, v_role FROM users WHERE id = NEW.donor_id;
  IF v_user_role IS DISTINCT FROM 'DONOR' THEN
    RAISE EXCEPTION 'donor_id must reference a user with role DONOR';
  END IF;
  IF v_role = 'INDIVIDUAL' THEN
    SELECT allowed_for_individuals INTO v_allowed FROM food_categories WHERE id = NEW.food_category_id;
    IF NOT COALESCE(v_allowed, false) THEN
      RAISE EXCEPTION 'individual donors cannot post this food category';
    END IF;
  END IF;
  IF NEW.accepted_by_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users WHERE id = NEW.accepted_by_id AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'accepted_by_id must reference a user with role ADMIN';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER donations_check_parties
  BEFORE INSERT OR UPDATE OF donor_id, food_category_id, accepted_by_id ON donations
  FOR EACH ROW EXECUTE FUNCTION check_donation_parties();

-- Assignments: volunteer must be a VOLUNTEER, assigner an ADMIN.
CREATE FUNCTION check_assignment_parties()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.volunteer_id AND role = 'VOLUNTEER') THEN
    RAISE EXCEPTION 'volunteer_id must reference a user with role VOLUNTEER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.assigned_by_id AND role = 'ADMIN') THEN
    RAISE EXCEPTION 'assigned_by_id must reference a user with role ADMIN';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER donation_assignments_check_parties
  BEFORE INSERT OR UPDATE OF volunteer_id, assigned_by_id ON donation_assignments
  FOR EACH ROW EXECUTE FUNCTION check_assignment_parties();

-- Exit rows: copy the actor's role so the CHECK constraints cannot be fooled.
CREATE FUNCTION fill_exit_actor_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_user_id IS NULL THEN
    NEW.actor_role := NULL;
  ELSE
    SELECT role INTO NEW.actor_role FROM users WHERE id = NEW.actor_user_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER donation_exits_fill_actor_role
  BEFORE INSERT OR UPDATE OF actor_user_id ON donation_exits
  FOR EACH ROW EXECUTE FUNCTION fill_exit_actor_role();

-- B8: conditional checklist rules.
--   * consume-by is required when the checklist is completed
--   * prepared time required for categories flagged requires_prepared_time
--   * storage condition and temperature required for categories flagged requires_storage_info
--   * the pickup window must end before consume-by
CREATE FUNCTION fn_assert_checklist_rules(c donation_safety_checklists)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_prep       boolean;
  v_store      boolean;
  v_pickup_end timestamptz;
BEGIN
  SELECT cat.requires_prepared_time, cat.requires_storage_info, d.pickup_end
    INTO v_prep, v_store, v_pickup_end
  FROM donations d
  JOIN food_categories cat ON cat.id = d.food_category_id
  WHERE d.id = c.donation_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF c.consume_by_at IS NOT NULL AND v_pickup_end IS NOT NULL AND c.consume_by_at <= v_pickup_end THEN
    RAISE EXCEPTION 'donation %: the pickup window must end before the consume-by time', c.donation_id;
  END IF;

  IF c.completed_at IS NOT NULL THEN
    IF v_prep AND c.prepared_at IS NULL THEN
      RAISE EXCEPTION 'donation %: prepared time is required for this food category', c.donation_id;
    END IF;
    IF v_store AND (c.storage_condition IS NULL OR c.storage_temperature_c IS NULL) THEN
      RAISE EXCEPTION 'donation %: storage condition and temperature are required for this food category', c.donation_id;
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION check_checklist_rules()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_assert_checklist_rules(NEW);
  RETURN NEW;
END;
$$;
CREATE TRIGGER donation_checklists_check_rules
  BEFORE INSERT OR UPDATE ON donation_safety_checklists
  FOR EACH ROW EXECUTE FUNCTION check_checklist_rules();

-- Re-check an existing checklist when the pickup window or category changes.
CREATE FUNCTION check_checklist_after_donation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  cl donation_safety_checklists;
BEGIN
  SELECT * INTO cl FROM donation_safety_checklists WHERE donation_id = NEW.id;
  IF FOUND THEN
    PERFORM fn_assert_checklist_rules(cl);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER donations_recheck_checklist
  AFTER UPDATE OF pickup_end, food_category_id ON donations
  FOR EACH ROW
  WHEN (OLD.pickup_end IS DISTINCT FROM NEW.pickup_end OR OLD.food_category_id IS DISTINCT FROM NEW.food_category_id)
  EXECUTE FUNCTION check_checklist_after_donation_change();

-- B11: distribution entries and unusable portions may only change while the
-- donation is DELIVERED, and never exceed the portions donated. The donation row
-- is locked so two Volunteers cannot overshoot at the same time.
CREATE FUNCTION guard_portion_records()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_id       uuid;
  v_status   donation_status;
  v_portions integer;
  v_dist     bigint;
  v_unusable bigint;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.donation_id ELSE NEW.donation_id END;

  SELECT status, portions INTO v_status, v_portions
  FROM donations WHERE id = v_id FOR UPDATE;
  IF v_status IS DISTINCT FROM 'DELIVERED' THEN
    RAISE EXCEPTION 'donation %: distribution records can only change while the donation is DELIVERED', v_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT COALESCE(sum(portions_distributed), 0) INTO v_dist
    FROM distribution_entries
    WHERE donation_id = v_id AND (TG_TABLE_NAME <> 'distribution_entries' OR id <> NEW.id);

    SELECT COALESCE(sum(portions), 0) INTO v_unusable
    FROM unusable_portions
    WHERE donation_id = v_id AND (TG_TABLE_NAME <> 'unusable_portions' OR id <> NEW.id);

    IF TG_TABLE_NAME = 'distribution_entries' THEN
      v_dist := v_dist + NEW.portions_distributed;
    ELSE
      v_unusable := v_unusable + NEW.portions;
    END IF;

    IF v_dist + v_unusable > v_portions THEN
      RAISE EXCEPTION 'donation %: distributed (%) plus unusable (%) exceeds portions donated (%)',
        v_id, v_dist, v_unusable, v_portions;
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER distribution_entries_guard
  BEFORE INSERT OR UPDATE OR DELETE ON distribution_entries
  FOR EACH ROW EXECUTE FUNCTION guard_portion_records();
CREATE TRIGGER unusable_portions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON unusable_portions
  FOR EACH ROW EXECUTE FUNCTION guard_portion_records();

-- B5: CLOSED is tied to the reconciliation check: at least one distribution entry, and
-- distributed + unusable = portions.
-- This replaces the old "Receiver receipt" rule.
CREATE FUNCTION require_reconciliation_on_close()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entries  bigint;
  v_dist     bigint;
  v_unusable bigint;
BEGIN
  SELECT count(*), COALESCE(sum(portions_distributed), 0) INTO v_entries, v_dist
  FROM distribution_entries WHERE donation_id = NEW.id;
  SELECT COALESCE(sum(portions), 0) INTO v_unusable
  FROM unusable_portions WHERE donation_id = NEW.id;

  IF v_entries = 0 THEN
    RAISE EXCEPTION 'donation %: cannot close without at least one distribution entry', NEW.id;
  END IF;
  IF v_dist + v_unusable <> NEW.portions THEN
    RAISE EXCEPTION 'donation %: cannot close, distributed (%) plus unusable (%) does not equal portions donated (%)',
      NEW.id, v_dist, v_unusable, NEW.portions;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER donations_require_reconciliation
  BEFORE UPDATE OF status ON donations
  FOR EACH ROW
  WHEN (NEW.status = 'CLOSED' AND OLD.status IS DISTINCT FROM 'CLOSED')
  EXECUTE FUNCTION require_reconciliation_on_close();

-- ---------------------------------------------------------------------
-- Views (C6, A8). Everything is computed from CLOSED donations and distribution
-- entries. security_invoker keeps them behind row-level security.
-- ---------------------------------------------------------------------
CREATE VIEW v_closed_donation_impact WITH (security_invoker = true) AS
SELECT
  d.id          AS donation_id,
  d.donor_id,
  a.volunteer_id,                                   -- the Volunteer assigned at closing
  d.closed_at,
  d.portions    AS portions_donated,
  COALESCE(e.portions_distributed, 0) AS portions_distributed,
  COALESCE(e.people_served, 0)        AS people_served,
  COALESCE(u.portions, 0)             AS portions_unusable
FROM donations d
LEFT JOIN LATERAL (
  SELECT sum(portions_distributed) AS portions_distributed, sum(people_served) AS people_served
  FROM distribution_entries WHERE donation_id = d.id
) e ON true
LEFT JOIN LATERAL (
  SELECT sum(portions) AS portions FROM unusable_portions WHERE donation_id = d.id
) u ON true
LEFT JOIN donation_assignments a ON a.donation_id = d.id AND a.ended_at IS NULL
WHERE d.status = 'CLOSED' AND d.deleted_at IS NULL;

-- Landing page: donations completed, portions moved, people served, active volunteers (totals only)
CREATE VIEW v_impact_totals WITH (security_invoker = true) AS
SELECT
  count(*)                                     AS donations_completed,
  COALESCE(sum(portions_distributed), 0)::bigint AS portions_moved,
  COALESCE(sum(people_served), 0)::bigint        AS people_served,
  (SELECT count(*) FROM users
    WHERE role = 'VOLUNTEER' AND status = 'ACTIVE' AND deleted_at IS NULL) AS active_volunteers
FROM v_closed_donation_impact;

CREATE VIEW v_impact_monthly WITH (security_invoker = true) AS
SELECT
  date_trunc('month', closed_at AT TIME ZONE 'Asia/Manila')::date AS month,
  count(*)                                       AS donations_completed,
  COALESCE(sum(portions_distributed), 0)::bigint AS portions_moved,
  COALESCE(sum(people_served), 0)::bigint        AS people_served
FROM v_closed_donation_impact
GROUP BY 1
ORDER BY 1;

-- Donor achievements: donations completed, portions donated, people served
CREATE VIEW v_donor_stats WITH (security_invoker = true) AS
SELECT
  donor_id                                   AS user_id,
  count(*)                                   AS donations_completed,
  sum(portions_donated)::bigint              AS portions_donated,
  sum(people_served)::bigint                 AS people_served
FROM v_closed_donation_impact
GROUP BY donor_id;

-- Volunteer achievements: tasks completed
CREATE VIEW v_volunteer_stats WITH (security_invoker = true) AS
SELECT
  volunteer_id                               AS user_id,
  count(*)                                   AS tasks_completed
FROM v_closed_donation_impact
WHERE volunteer_id IS NOT NULL
GROUP BY volunteer_id;

-- C4: fn_donation_report() is defined once, in foodlink_db_objects_v3.sql.

-- ---------------------------------------------------------------------
-- C12: row-level security on every table that exists now. This DO block runs once, so
-- tables added later are NOT covered automatically. Rules for later migrations:
--   1) every migration that creates a table ends with:
--        ALTER TABLE <new_table> ENABLE ROW LEVEL SECURITY;
--   2) CI fails if this query returns any row:
--        SELECT tablename FROM pg_tables
--        WHERE schemaname = 'public' AND NOT rowsecurity
--          AND tablename <> '_prisma_migrations';
-- No policies are created, so the public
-- (anon / authenticated) keys of the Supabase Data API see nothing. The server
-- connects through Prisma with the owner role, which bypasses RLS.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------
INSERT INTO host_organization (id, name) VALUES (1, 'FoodLink Host Organization')
ON CONFLICT (id) DO NOTHING;

-- Categories are EDITABLE: confirm the list with the System document.
INSERT INTO food_categories (code, name, allowed_for_individuals, requires_prepared_time, requires_storage_info) VALUES
  ('COOKED_MEALS',   'Cooked Meals',                 false, true,  true),
  ('BAKERY',         'Bakery',                       false, true,  false),
  ('FRESH_PRODUCE',  'Whole Fresh Produce',          true,  false, false),
  ('PACKAGED_FOOD',  'Sealed Packaged Food',         true,  false, false),
  ('BEVERAGES',      'Sealed Beverages',             true,  false, false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO document_types (code, name) VALUES
  ('BUSINESS_PERMIT', 'Business permit'),
  ('VALID_ID',        'Valid government ID')
ON CONFLICT (code) DO NOTHING;

INSERT INTO allergens (code, name) VALUES
  ('CRUSTACEANS', 'Crustaceans (shrimp, crab, lobster)'),
  ('MOLLUSCS',    'Molluscs (squid, clams, mussels)'),
  ('EGGS',        'Eggs'),
  ('FISH',        'Fish'),
  ('MILK',        'Milk and dairy'),
  ('PEANUTS',     'Peanuts'),
  ('TREE_NUTS',   'Tree nuts'),
  ('SOY',         'Soy'),
  ('WHEAT_GLUTEN','Wheat / gluten'),
  ('SESAME',      'Sesame'),
  ('SULFITES',    'Sulfites'),
  ('OTHER',       'Other allergen (specify in description)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO dietary_tags (code, name) VALUES
  ('HALAL',       'Halal'),
  ('VEGETARIAN',  'Vegetarian'),
  ('VEGAN',       'Vegan'),
  ('GLUTEN_FREE', 'Gluten-free (donor-declared)')
ON CONFLICT (code) DO NOTHING;

-- Labels from the System document (unconfirmed with the beneficiary).
INSERT INTO beneficiary_groups (code, name) VALUES
  ('FAMILIES',                  'Families'),
  ('CHILDREN',                  'Children'),
  ('ELDERLY',                   'Elderly'),
  ('PERSONS_WITH_DISABILITIES', 'Persons with disabilities'),
  ('STUDENTS',                  'Students'),
  ('MIXED_COMMUNITY',           'Mixed community')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Follow-up (application level, not enforceable by the schema alone):
-- 1. Create the first ADMIN with a one-time secure seed process (status ACTIVE), never public registration.
-- 2. transitionDonation() owns: the allowed-transition table, the donation update, the exit row,
--    the tracking event, notifications and the audit log, all in ONE transaction.
--    Check that the Donor / Volunteer account is ACTIVE there (C5).
-- 3. Accept with the single conditional UPDATE shown above the donations table, and check the
--    affected row count (B4, D2).
-- 4. Expiry job (D1/C3): for each donation past pickup_end, call transitionDonation(..., 'EXPIRED').
--    Run it from a scheduled GitHub Actions workflow or expire lazily on read plus a daily sweep.
-- 5. Re-check account status on every request (proxy.ts / requireRole()) because JWTs outlive a suspension (D6).
-- 6. Rate-limit OTP and login in the application (3 per 15 minutes) using one_time_codes.created_at.
-- 7. Achievements: inside the DELIVERED -> CLOSED transaction, read v_donor_stats / v_volunteer_stats and
--    insert missing user_achievements rows once badge thresholds are decided.
