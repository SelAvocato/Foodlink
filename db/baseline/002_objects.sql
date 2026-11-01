-- =====================================================================
-- FoodLink database objects v3: functions, procedures and indexes
-- Target: PostgreSQL 15+
--
-- Apply order:
--   1. foodlink_schema_v3.sql
--   2. foodlink_db_objects_v3.sql   (this file)
--
-- Rewritten from foodlink_db_objects.sql using the review PDF (Oct 31, 2026)
-- and the v3 tables. Review status (Nov 1, 2026): applied cleanly on PostgreSQL 16 after
-- foodlink_schema_v3.sql. Not yet tested on PostgreSQL 15, Supabase or Prisma.
--
-- Rule behind most removals (review C1, C2, C3, C5, C7, C8): transitionDonation()
-- in the application is the single writer of status changes, tracking events,
-- notifications and audit rows. The database keeps only read helpers, one
-- housekeeping procedure and indexes. The small integrity guards (roles, portions,
-- reconciliation on CLOSED, checklist rules) already live in foodlink_schema_v3.sql.
--
-- What happened to each old object (review appendix):
--   fn_haversine_km, fn_available_donations_near, addresses_lat_lng_idx
--       DROPPED, distance ranking is retired (C9). Replaced by fn_admin_donation_queue.
--   fn_donation_report                   REWRITTEN on the new tables, with privacy rules (C4).
--   fn_log_donation_status_change + 2 triggers
--       DROPPED, transitionDonation() writes the TrackingEvent (C1).
--   fn_notify_donation_status_change + trigger
--       DROPPED, notifications are created inside transitionDonation() (C2).
--   fn_require_active_donor_on_post + trigger
--       MOVED to transitionDonation(): check the Donor user's status (C5).
--   fn_require_valid_claim + trigger, sp_claim_donation
--       DROPPED, replaced by the atomic accept UPDATE in application code (B4, D2).
--   fn_notify_admins_on_incident + trigger
--       MOVED to application code.
--   sp_expire_donations                  REWRITTEN as fn_donations_due_for_expiry(): the
--       application job calls transitionDonation(..., 'EXPIRED') for each row (C3).
--   sp_cleanup_expired_records           REWRITTEN: no daily audit row, no sessions part.
--   sp_complete_erasure_request          DEFERRED, beyond the system scope (C10).
--   pg_cron schedules, DDL event trigger
--       DROPPED, hosting is Supabase + Vercel (C12, D1). See the scheduling note at the end.
-- =====================================================================
BEGIN;

-- =====================================================================
-- 1. FUNCTIONS
-- =====================================================================

-- 1.1 Admin queue: POSTED donations that can still be accepted, soonest
-- pickup_end first (C9). The accept itself is the conditional UPDATE in the
-- application (status = 'POSTED' AND pickup_end > now()).
CREATE FUNCTION fn_admin_donation_queue(p_food_category_id smallint DEFAULT NULL)
RETURNS TABLE (
  donation_id    uuid,
  food_name      varchar,
  category       varchar,
  portions       integer,
  donor_name     varchar,
  donor_type     donor_type,
  pickup_address text,
  pickup_start   timestamptz,
  pickup_end     timestamptz,
  posted_at      timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.food_name, c.name, d.portions,
         COALESCE(du.business_name, du.full_name), du.donor_type,
         concat_ws(', ', a.street_line1, a.street_line2, a.barangay, a.city, a.province_or_state),
         d.pickup_start, d.pickup_end, d.posted_at
  FROM donations d
  JOIN food_categories c ON c.id = d.food_category_id
  JOIN users du          ON du.id = d.donor_id
  LEFT JOIN addresses a  ON a.id = d.pickup_address_id
  WHERE d.status = 'POSTED'
    AND d.deleted_at IS NULL
    AND d.pickup_end > now()
    AND (p_food_category_id IS NULL OR d.food_category_id = p_food_category_id)
  ORDER BY d.pickup_end, d.posted_at;
$$;

-- 1.2 Donations the expiry job must move to EXPIRED. The job (run every 15 minutes,
-- see the scheduling note) loops over these rows and calls transitionDonation() for
-- each one, so every donation gets a TrackingEvent, notifications and an AuditLog row.
-- ASSUMED statuses: POSTED, ACCEPTED, ASSIGNED. Adjust to the System document's rule.
CREATE FUNCTION fn_donations_due_for_expiry(p_limit integer DEFAULT 200)
RETURNS TABLE (
  donation_id  uuid,
  status       donation_status,
  pickup_end   timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT d.id, d.status, d.pickup_end
  FROM donations d
  WHERE d.status IN ('POSTED', 'ACCEPTED', 'ASSIGNED')
    AND d.pickup_end < now()
    AND d.deleted_at IS NULL
  ORDER BY d.pickup_end
  LIMIT p_limit;
$$;

-- 1.3 One-donation report, rewritten for the new tables (C4).
-- Works for individual donors (no organization join) and reports portions.
-- This is the only definition of fn_donation_report (it is not created in the schema file).
-- Privacy by viewer role:
--   ADMIN         full names, phone numbers, distribution notes and unusable notes,
--                 assignment history, incidents
--   VOLUNTEER     only for a donation currently assigned to p_viewer_user_id (otherwise
--                 NULL is returned): donor name and phone, pickup address and window,
--                 own name and phone. No notes, no assignment history, no incidents.
--   DONOR (default) and anyone else: Volunteer first name only, Volunteer phone only
--                 inside the pickup window. No notes (free text can contain a
--                 beneficiary's name), no assignment history, no incidents.
-- The function does NOT check who the caller is, except the Volunteer assignment gate above:
-- the application must first confirm that a Donor owns the donation / an Admin is signed in.
--   SELECT fn_donation_report('<donation>', 'DONOR');
--   SELECT fn_donation_report('<donation>', 'VOLUNTEER', '<volunteer user id>');
CREATE FUNCTION fn_donation_report(
  p_donation_id    uuid,
  p_viewer_role    user_role DEFAULT 'DONOR',
  p_viewer_user_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'donation', jsonb_build_object(
      'id', d.id, 'food_name', d.food_name, 'category', fc.name,
      'portions', d.portions, 'status', d.status,
      'posted_at', d.posted_at, 'accepted_at', d.accepted_at, 'closed_at', d.closed_at
    ),
    'donor', CASE WHEN p_viewer_role = 'ADMIN' THEN jsonb_build_object(
        'user_id', du.id,
        'name', COALESCE(du.business_name, du.full_name),
        'full_name', du.full_name,
        'donor_type', du.donor_type,
        'phone', du.contact_number
      )
      WHEN p_viewer_role = 'VOLUNTEER' THEN jsonb_build_object(
        'name', COALESCE(du.business_name, du.full_name),
        'donor_type', du.donor_type,
        'phone', du.contact_number
      )
      ELSE jsonb_build_object(
        'name', COALESCE(du.business_name, du.full_name),
        'donor_type', du.donor_type
      ) END,
    'volunteer', CASE
      WHEN a.id IS NULL THEN NULL
      WHEN p_viewer_role IN ('ADMIN', 'VOLUNTEER') THEN jsonb_build_object(
        'user_id', vu.id, 'name', vu.full_name, 'phone', vu.contact_number
      )
      ELSE jsonb_build_object(
        'first_name', split_part(btrim(vu.full_name), ' ', 1),
        'phone', CASE WHEN now() BETWEEN d.pickup_start AND d.pickup_end THEN vu.contact_number END
      ) END,
    'pickup', CASE WHEN d.pickup_start IS NULL THEN NULL ELSE jsonb_build_object(
      'address', concat_ws(', ', pa.street_line1, pa.street_line2, pa.barangay, pa.city, pa.province_or_state),
      'pickup_start', d.pickup_start, 'pickup_end', d.pickup_end
    ) END,
    'safety_checklist', CASE WHEN sc.donation_id IS NULL THEN NULL ELSE jsonb_build_object(
      'prepared_at', sc.prepared_at, 'consume_by_at', sc.consume_by_at,
      'storage_condition', sc.storage_condition,
      'storage_temperature_c', sc.storage_temperature_c,
      'packaging_intact', sc.packaging_intact,
      'allergens_confirmed', sc.allergens_confirmed,
      'completed_at', sc.completed_at
    ) END,
    'allergens', COALESCE((
      SELECT jsonb_agg(al.name ORDER BY al.name)
      FROM donation_allergens da JOIN allergens al ON al.id = da.allergen_id
      WHERE da.donation_id = d.id
    ), '[]'::jsonb),
    'pickup_inspection', CASE WHEN pi.donation_id IS NULL THEN NULL ELSE jsonb_build_object(
      'decision', pi.decision, 'inspected_at', pi.inspected_at
    ) END,
    'exit', CASE WHEN ex.donation_id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', ex.exit_status, 'actor_role', ex.actor_role,
      'reason', ex.reason, 'occurred_at', ex.occurred_at
    ) END,
    'qr_scans', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', s.stage, 'scanned_at', s.scanned_at) ORDER BY s.scanned_at)
      FROM donation_qr_scans s WHERE s.donation_id = d.id
    ), '[]'::jsonb),
    'distribution', jsonb_build_object(
      'entries', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'distributed_on', e.distributed_on, 'place', e.place, 'group_served', bg.name,
          'people_served', e.people_served, 'portions_distributed', e.portions_distributed,
          'notes', CASE WHEN p_viewer_role = 'ADMIN' THEN e.notes END
        )) ORDER BY e.distributed_on, e.created_at)
        FROM distribution_entries e JOIN beneficiary_groups bg ON bg.id = e.group_id
        WHERE e.donation_id = d.id
      ), '[]'::jsonb),
      'unusable', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'portions', u.portions, 'reason', u.reason,
          'note', CASE WHEN p_viewer_role = 'ADMIN' THEN u.note END
        )) ORDER BY u.created_at)
        FROM unusable_portions u WHERE u.donation_id = d.id
      ), '[]'::jsonb)
    ),
    'impact', jsonb_build_object(
      'portions_donated',     d.portions,
      'portions_distributed', COALESCE((SELECT sum(e.portions_distributed) FROM distribution_entries e WHERE e.donation_id = d.id), 0),
      'portions_unusable',    COALESCE((SELECT sum(u.portions) FROM unusable_portions u WHERE u.donation_id = d.id), 0),
      'people_served',        COALESCE((SELECT sum(e.people_served) FROM distribution_entries e WHERE e.donation_id = d.id), 0)
    ),
    'assignments', CASE WHEN p_viewer_role = 'ADMIN' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'volunteer', av.full_name, 'assigned_at', x.assigned_at,
        'ended_at', x.ended_at, 'end_reason', x.end_reason
      ) ORDER BY x.assigned_at)
      FROM donation_assignments x JOIN users av ON av.id = x.volunteer_id
      WHERE x.donation_id = d.id
    ), '[]'::jsonb) END,
    'timeline', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', t.event_type, 'from', t.from_status, 'to', t.to_status, 'at', t.occurred_at,
        'note', t.event_note, 'metadata', t.metadata
      ) ORDER BY t.occurred_at, t.id)
      FROM donation_tracking_events t WHERE t.donation_id = d.id
    ), '[]'::jsonb),
    'incidents', CASE WHEN p_viewer_role = 'ADMIN' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', inc.id, 'title', inc.title, 'status', inc.status, 'created_at', inc.created_at
      ) ORDER BY inc.created_at)
      FROM incidents inc WHERE inc.donation_id = d.id
    ), '[]'::jsonb) END
  )
  FROM donations d
  JOIN food_categories fc ON fc.id = d.food_category_id
  JOIN users du ON du.id = d.donor_id
  LEFT JOIN addresses pa ON pa.id = d.pickup_address_id
  LEFT JOIN donation_assignments a ON a.donation_id = d.id AND a.ended_at IS NULL
  LEFT JOIN users vu ON vu.id = a.volunteer_id
  LEFT JOIN donation_safety_checklists sc ON sc.donation_id = d.id
  LEFT JOIN donation_pickup_inspections pi ON pi.donation_id = d.id
  LEFT JOIN donation_exits ex ON ex.donation_id = d.id
  WHERE d.id = p_donation_id AND d.deleted_at IS NULL
    -- Volunteer mode: assigned donations only (fails closed when p_viewer_user_id is NULL)
    AND (p_viewer_role <> 'VOLUNTEER' OR a.volunteer_id = p_viewer_user_id);
$$;

-- =====================================================================
-- 2. PROCEDURES
-- =====================================================================

-- 2.1 Housekeeping: remove stale one-time codes and old read notifications.
-- PROPOSED retention (1 day for one-time codes, 90 days for read notifications): the
-- System document does not state these yet. Confirm the values with the team and document them.
-- The old daily audit row and the sessions cleanup are gone (Auth.js uses stateless
-- JWTs, and routine rows would only add noise to the append-only audit log, C7).
--   CALL sp_cleanup_expired_records();          -- defaults 1 / 90 days
--   CALL sp_cleanup_expired_records(1, 60);
CREATE PROCEDURE sp_cleanup_expired_records(
  p_otp_days integer DEFAULT 1,
  p_notification_days integer DEFAULT 90
)
LANGUAGE plpgsql AS $$
DECLARE
  v_otp           integer;
  v_notifications integer;
BEGIN
  DELETE FROM one_time_codes
  WHERE expires_at  < now() - make_interval(days => p_otp_days)
     OR consumed_at < now() - make_interval(days => p_otp_days);
  GET DIAGNOSTICS v_otp = ROW_COUNT;

  DELETE FROM notifications
  WHERE read_at IS NOT NULL AND read_at < now() - make_interval(days => p_notification_days);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;

  RAISE NOTICE 'sp_cleanup_expired_records: % code(s), % notification(s) removed', v_otp, v_notifications;
END;
$$;

-- =====================================================================
-- 3. INDEXES (in addition to those in foodlink_schema_v3.sql)
-- =====================================================================

-- Case-insensitive donor name lookup / search-as-you-type prefix match for the Admin
-- (replaces organizations_name_lower_idx).
CREATE INDEX users_display_name_lower_idx
  ON users (lower(COALESCE(business_name, full_name)) text_pattern_ops)
  WHERE deleted_at IS NULL;

-- Range scans used by sp_cleanup_expired_records().
CREATE INDEX one_time_codes_expires_idx ON one_time_codes (expires_at);
CREATE INDEX notifications_read_cleanup_idx ON notifications (read_at)
  WHERE read_at IS NOT NULL;
-- fn_admin_donation_queue() uses donations_admin_queue_idx and
-- fn_donations_due_for_expiry() uses donations_expiry_idx, both from foodlink_schema_v3.sql.

COMMIT;

-- =====================================================================
-- Scheduling note (review D1, C12)
-- =====================================================================
-- There is no pg_cron schedule in this file. Vercel's Hobby plan only runs cron jobs
-- once a day, so use a scheduled GitHub Actions workflow that calls a secured API
-- endpoint (or expire lazily on read plus a daily sweep):
--   every 15 minutes: SELECT * FROM fn_donations_due_for_expiry();
--                     then transitionDonation(id, 'EXPIRED') for each row
--   daily:            CALL sp_cleanup_expired_records();
