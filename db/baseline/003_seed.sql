-- =====================================================================
-- FoodLink DEVELOPMENT seed data
-- Run AFTER foodlink_schema_v3.sql and foodlink_db_objects_v3.sql.
--
-- DEV / TEST ONLY. Every account uses the password:  Password123!
-- Never run this on a production database (it refuses if the database name contains "prod").
--
-- Safe to run twice: if admin@foodlink.test already exists it does nothing.
-- It runs in one transaction, so if anything fails, nothing is saved.
-- To start over, drop and recreate the database (the log tables are append-only,
-- so they cannot be emptied).
--
-- How to run:
--   psql "$DIRECT_URL" -f foodlink_seed.sql
--   or paste it into the Supabase SQL editor
--   or: npx prisma db execute --file foodlink_seed.sql --schema prisma/schema.prisma
--
-- What you get:
--   10 accounts: 1 Admin, 5 Donors, 4 Volunteers, in every account status
--   14 donations, one for each of the 13 statuses (POSTED appears twice)
--   checklists, allergens, photos (keys only), screenings, assignments, pickup inspections,
--   QR scans, distribution entries and one reconciled CLOSED donation
-- Not seeded on purpose: notifications, audit logs, messages, incidents, achievements
-- (badge thresholds are undecided). Each donation has one tracking event; the app's
-- transitionDonation() writes the real timeline.
--
-- Passwords are hashed with argon2id (m=19456 KiB, t=2, p=1, 32-byte tag), the same
-- hash for every seeded account. It verifies with any standard argon2id library
-- (for example @node-rs/argon2), because the settings are stored inside the hash string.
-- This file needs no extension: the hash is a ready-made value, and QR tokens use
-- the built-in gen_random_uuid().
-- =====================================================================
BEGIN;

DO $seed$
DECLARE
  -- users
  k_admin   uuid := 'b0000000-0000-4000-8000-000000000001';
  k_est1    uuid := 'b0000000-0000-4000-8000-000000000002';  -- ESTABLISHMENT donor, ACTIVE
  k_est2    uuid := 'b0000000-0000-4000-8000-000000000003';  -- ESTABLISHMENT donor, ACTIVE
  k_ind1    uuid := 'b0000000-0000-4000-8000-000000000004';  -- INDIVIDUAL donor, ACTIVE
  k_pend_d  uuid := 'b0000000-0000-4000-8000-000000000005';  -- donor, PENDING
  k_rej_d   uuid := 'b0000000-0000-4000-8000-000000000006';  -- donor, REJECTED
  k_vol1    uuid := 'b0000000-0000-4000-8000-000000000007';  -- Volunteer, ACTIVE
  k_vol2    uuid := 'b0000000-0000-4000-8000-000000000008';  -- Volunteer, ACTIVE
  k_pend_v  uuid := 'b0000000-0000-4000-8000-000000000009';  -- Volunteer, PENDING
  k_susp_v  uuid := 'b0000000-0000-4000-8000-000000000010';  -- Volunteer, SUSPENDED
  -- donations (one per status)
  k_dn01 uuid := 'd0000000-0000-4000-8000-000000000001';  -- DRAFT
  k_dn02 uuid := 'd0000000-0000-4000-8000-000000000002';  -- SCREENED
  k_dn03 uuid := 'd0000000-0000-4000-8000-000000000003';  -- POSTED
  k_dn04 uuid := 'd0000000-0000-4000-8000-000000000004';  -- POSTED
  k_dn05 uuid := 'd0000000-0000-4000-8000-000000000005';  -- ACCEPTED
  k_dn06 uuid := 'd0000000-0000-4000-8000-000000000006';  -- ASSIGNED
  k_dn07 uuid := 'd0000000-0000-4000-8000-000000000007';  -- PICKED_UP
  k_dn08 uuid := 'd0000000-0000-4000-8000-000000000008';  -- DELIVERED (8 portions still to record)
  k_dn09 uuid := 'd0000000-0000-4000-8000-000000000009';  -- CLOSED (reconciled)
  k_dn10 uuid := 'd0000000-0000-4000-8000-000000000010';  -- REJECTED
  k_dn11 uuid := 'd0000000-0000-4000-8000-000000000011';  -- DECLINED
  k_dn12 uuid := 'd0000000-0000-4000-8000-000000000012';  -- REJECTED_AT_PICKUP
  k_dn13 uuid := 'd0000000-0000-4000-8000-000000000013';  -- CANCELLED
  k_dn14 uuid := 'd0000000-0000-4000-8000-000000000014';  -- EXPIRED
BEGIN
  IF current_database() ILIKE '%prod%' THEN
    RAISE EXCEPTION 'foodlink_seed.sql is for development only and will not run on %', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email = 'admin@foodlink.test') THEN
    RAISE NOTICE 'Seed data already present, nothing done.';
    RETURN;
  END IF;

  -- ===================================================================
  -- 1. Addresses (sample locations in Quezon City). Address NN belongs to user NN; 01 is the host office.
  -- ===================================================================
  INSERT INTO addresses (id, street_line1, barangay, city, province_or_state, postal_code, latitude, longitude) VALUES
    ('a0000000-0000-4000-8000-000000000001', '12 Katipunan Avenue',     'Loyola Heights',    'Quezon City', 'Metro Manila', '1108', 14.640000, 121.075000),
    ('a0000000-0000-4000-8000-000000000002', '45 Tandang Sora Avenue',  'Tandang Sora',      'Quezon City', 'Metro Manila', '1116', 14.676000, 121.043700),
    ('a0000000-0000-4000-8000-000000000003', '8 Visayas Avenue',        'Vasra',             'Quezon City', 'Metro Manila', '1128', 14.669400, 121.051700),
    ('a0000000-0000-4000-8000-000000000004', '23 Kamias Road',          'East Kamias',       'Quezon City', 'Metro Manila', '1102', 14.624600, 121.058900),
    ('a0000000-0000-4000-8000-000000000005', '17 Commonwealth Avenue',  'Holy Spirit',       'Quezon City', 'Metro Manila', '1127', 14.693700, 121.081600),
    ('a0000000-0000-4000-8000-000000000006', '5 Congressional Avenue',  'Bahay Toro',        'Quezon City', 'Metro Manila', '1106', 14.657300, 121.023600),
    ('a0000000-0000-4000-8000-000000000007', '102 Aurora Boulevard',    'Cubao',             'Quezon City', 'Metro Manila', '1109', 14.620000, 121.050900),
    ('a0000000-0000-4000-8000-000000000008', '31 Quirino Highway',      'Novaliches Proper', 'Quezon City', 'Metro Manila', '1123', 14.727000, 121.039000),
    ('a0000000-0000-4000-8000-000000000009', '66 Mindanao Avenue',      'Pasong Tamo',       'Quezon City', 'Metro Manila', '1107', 14.687000, 121.024300),
    ('a0000000-0000-4000-8000-000000000010', '9 Regalado Avenue',       'Fairview',          'Quezon City', 'Metro Manila', '1118', 14.710700, 121.058600);

  -- ===================================================================
  -- 2. Host organization (the single row already exists from the schema file)
  -- ===================================================================
  UPDATE host_organization SET
    name = 'FoodLink',
    mission = 'Connect surplus food with the communities that need it, safely and with full accountability.',
    vision = 'A community where no edible food goes to waste and no one goes hungry.',
    goals = '["Reduce food waste", "Feed communities in need", "Connect donors with volunteers"]'::jsonb,
    organization_chart = '[{"role": "Director", "name": "To be filled"}, {"role": "Operations Lead", "name": "To be filled"}]'::jsonb,
    contact_email = 'hello@foodlink.test',
    contact_phone = '+639171230000',
    address_id = 'a0000000-0000-4000-8000-000000000001'
  WHERE id = 1;

  -- ===================================================================
  -- 3. Users, logins, consents, Admin reviews, proof documents
  -- ===================================================================
  INSERT INTO users (id, role, status, full_name, email, contact_number, donor_type, business_name, address_id, availability)
  SELECT v.id, v.role::user_role, v.status::account_status, v.full_name, v.email, v.contact_number,
         v.donor_type::donor_type, v.business_name,
         CASE WHEN v.addr IS NOT NULL THEN ('a0000000-0000-4000-8000-0000000000' || lpad(v.addr::text, 2, '0'))::uuid END,
         v.availability
  FROM (VALUES
    (k_admin,  'ADMIN',     'ACTIVE',    'FoodLink Admin', 'admin@foodlink.test',               '+639171230001', NULL,            NULL,                      NULL, NULL),
    (k_est1,   'DONOR',     'ACTIVE',    'Maria Santos',   'donor.bakery@foodlink.test',        '+639171230002', 'ESTABLISHMENT', 'Sunrise Bakery and Cafe', 2,    NULL),
    (k_est2,   'DONOR',     'ACTIVE',    'Jose Reyes',     'donor.catering@foodlink.test',      '+639171230003', 'ESTABLISHMENT', 'Reyes Catering Services', 3,    NULL),
    (k_ind1,   'DONOR',     'ACTIVE',    'Ana Cruz',       'donor.individual@foodlink.test',    '+639171230004', 'INDIVIDUAL',    NULL,                      4,    NULL),
    (k_pend_d, 'DONOR',     'PENDING',   'Pedro Lim',      'donor.pending@foodlink.test',       '+639171230005', 'INDIVIDUAL',    NULL,                      5,    NULL),
    (k_rej_d,  'DONOR',     'REJECTED',  'Rico Tan',       'donor.rejected@foodlink.test',      '+639171230006', 'ESTABLISHMENT', 'Tan Food Cart',           6,    NULL),
    (k_vol1,   'VOLUNTEER', 'ACTIVE',    'Luis Garcia',    'volunteer.one@foodlink.test',       '+639171230007', NULL,            NULL,                      7,    'Weekdays after 5 PM and weekends'),
    (k_vol2,   'VOLUNTEER', 'ACTIVE',    'Carla Mendoza',  'volunteer.two@foodlink.test',       '+639171230008', NULL,            NULL,                      8,    'Weekends only'),
    (k_pend_v, 'VOLUNTEER', 'PENDING',   'Nina Ramos',     'volunteer.pending@foodlink.test',   '+639171230009', NULL,            NULL,                      9,    NULL),
    (k_susp_v, 'VOLUNTEER', 'SUSPENDED', 'Mark Dizon',     'volunteer.suspended@foodlink.test', '+639171230010', NULL,            NULL,                      10,   'Weekdays')
  ) AS v(id, role, status, full_name, email, contact_number, donor_type, business_name, addr, availability);

  -- Login for every seeded account: Password123!  (argon2id)
  INSERT INTO user_credentials (user_id, password_hash)
  SELECT u.id, '$argon2id$v=19$m=19456,t=2,p=1$559kHpq2/AmAgytiZWgIpQ$guDzplxa5oOOG9SzDutTU7/2bljGWN+UB4+zQ7Jgv5o'
  FROM users u
  WHERE u.email LIKE '%@foodlink.test';

  INSERT INTO user_consents (user_id, consent_type, policy_version)
  SELECT u.id, t.consent_type, '2026-11'
  FROM users u
  CROSS JOIN (VALUES ('PRIVACY_POLICY'), ('TERMS')) AS t(consent_type)
  WHERE u.email LIKE '%@foodlink.test';

  -- Admin decisions (PENDING accounts have none yet)
  INSERT INTO user_reviews (user_id, reviewed_by_user_id, resulting_status, reason, reviewed_at)
  SELECT v.user_id, k_admin, v.status::account_status, v.reason, now() - (v.days * interval '1 day')
  FROM (VALUES
    (k_est1,   'ACTIVE',    NULL,                                                           12),
    (k_est2,   'ACTIVE',    NULL,                                                           12),
    (k_ind1,   'ACTIVE',    NULL,                                                           11),
    (k_vol1,   'ACTIVE',    NULL,                                                           10),
    (k_vol2,   'ACTIVE',    NULL,                                                           10),
    (k_rej_d,  'REJECTED',  'Business permit is unreadable. Please upload a clear photo.',   9),
    (k_susp_v, 'ACTIVE',    NULL,                                                           10),
    (k_susp_v, 'SUSPENDED', 'Repeated no-show on assigned pickups.',                         2)
  ) AS v(user_id, status, reason, days);

  -- Proof documents (keys only, no real files)
  INSERT INTO user_documents (user_id, document_type_id, storage_key, original_filename, mime_type, size_bytes,
                              status, reviewed_by_user_id, reviewed_at, review_note)
  SELECT v.user_id, dt.id, 'seed/docs/' || v.user_id::text || '.jpg', 'proof.jpg', 'image/jpeg', 300000,
         v.status::document_status,
         CASE WHEN v.status <> 'PENDING' THEN k_admin END,
         CASE WHEN v.status <> 'PENDING' THEN now() - interval '9 days' END,
         CASE WHEN v.status = 'REJECTED' THEN 'Image is unreadable.' END
  FROM (VALUES
    (k_est1,   'BUSINESS_PERMIT', 'APPROVED'),
    (k_est2,   'BUSINESS_PERMIT', 'APPROVED'),
    (k_ind1,   'VALID_ID',        'APPROVED'),
    (k_pend_d, 'VALID_ID',        'PENDING'),
    (k_rej_d,  'BUSINESS_PERMIT', 'REJECTED'),
    (k_vol1,   'VALID_ID',        'APPROVED'),
    (k_vol2,   'VALID_ID',        'APPROVED'),
    (k_pend_v, 'VALID_ID',        'PENDING'),
    (k_susp_v, 'VALID_ID',        'APPROVED')
  ) AS v(user_id, doc_code, status)
  JOIN document_types dt ON dt.code = v.doc_code;

  -- ===================================================================
  -- 4. Donations (one per status). QR tokens are random 32 bytes, base64url, 43 characters.
  --    Pickup address is the donor's own address.
  -- ===================================================================
  INSERT INTO donations (id, donor_id, food_category_id, food_name, description, portions, status,
                         pickup_address_id, pickup_start, pickup_end, posted_at, accepted_by_id, accepted_at, qr_token)
  SELECT v.id, v.donor_id, c.id, v.food_name, v.description, v.portions, v.status::donation_status,
         CASE WHEN v.pickup_start IS NOT NULL THEN u.address_id END,
         v.pickup_start, v.pickup_end, v.posted_at, v.accepted_by_id, v.accepted_at,
         CASE WHEN v.with_qr THEN
           rtrim(translate(encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '+/', '-_'), '=')
         END
  FROM (VALUES
    (k_dn01, k_ind1, 'FRESH_PRODUCE', 'Mixed vegetables from home garden', 'Whole, unwashed squash, eggplant and string beans.',  12, 'DRAFT',
       NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::uuid, NULL::timestamptz, false),
    (k_dn02, k_ind1, 'PACKAGED_FOOD', 'Canned sardines (sealed)', 'Unopened cans with more than 6 months before expiry.',          20, 'SCREENED',
       NULL, NULL, NULL, NULL, NULL, false),
    (k_dn03, k_est1, 'BAKERY',        'Assorted bread and pan de sal', 'Baked this morning.',                                        30, 'POSTED',
       now() + interval '2 hours', now() + interval '8 hours', now() - interval '30 minutes', NULL, NULL, true),
    (k_dn04, k_est2, 'COOKED_MEALS',  'Chicken adobo with rice', 'Packed in sealed meal boxes.',                                     40, 'POSTED',
       now() + interval '1 day', now() + interval '1 day 4 hours', now() - interval '1 hour', NULL, NULL, true),
    (k_dn05, k_est1, 'BAKERY',        'Pastries and ensaymada', NULL,                                                                25, 'ACCEPTED',
       now() + interval '3 hours', now() + interval '9 hours', now() - interval '2 hours', k_admin, now() - interval '20 minutes', true),
    (k_dn06, k_est2, 'COOKED_MEALS',  'Pancit canton', 'Sealed trays.',                                                              35, 'ASSIGNED',
       now() + interval '2 hours', now() + interval '6 hours', now() - interval '3 hours', k_admin, now() - interval '2 hours', true),
    (k_dn07, k_est1, 'COOKED_MEALS',  'Vegetable soup', 'Hot soup in sealed containers.',                                            18, 'PICKED_UP',
       now() - interval '1 hour', now() + interval '3 hours', now() - interval '5 hours', k_admin, now() - interval '4 hours', true),
    (k_dn08, k_est2, 'COOKED_MEALS',  'Beef stew with rice', 'Delivered. 8 portions still need a distribution record.',              20, 'DELIVERED',
       now() - interval '5 hours', now() - interval '1 hour', now() - interval '1 day', k_admin, now() - interval '20 hours', true),
    (k_dn09, k_est1, 'BAKERY',        'Bread and pastries', 'Fully distributed. Used to test a closed donation.',                    10, 'DELIVERED',
       now() - interval '2 days', now() - interval '44 hours', now() - interval '3 days', k_admin, now() - interval '60 hours', true),
    (k_dn10, k_est1, 'COOKED_MEALS',  'Fried rice', 'Failed the visual screening.',                                                  14, 'REJECTED',
       NULL, NULL, NULL, NULL, NULL, false),
    (k_dn11, k_est2, 'COOKED_MEALS',  'Spaghetti party tray', NULL,                                                                  15, 'DECLINED',
       now() + interval '5 hours', now() + interval '9 hours', now() - interval '1 hour', NULL, NULL, true),
    (k_dn12, k_est1, 'BAKERY',        'Sandwiches', NULL,                                                                            16, 'REJECTED_AT_PICKUP',
       now() - interval '6 hours', now() - interval '2 hours', now() - interval '1 day', k_admin, now() - interval '22 hours', true),
    (k_dn13, k_ind1, 'BEVERAGES',     'Bottled water (sealed)', NULL,                                                                24, 'CANCELLED',
       now() + interval '1 day', now() + interval '1 day 3 hours', now() - interval '2 hours', NULL, NULL, true),
    (k_dn14, k_est2, 'COOKED_MEALS',  'Lumpia platter', 'Nobody picked it up in time.',                                              22, 'EXPIRED',
       now() - interval '2 days', now() - interval '45 hours', now() - interval '3 days', NULL, NULL, true)
  ) AS v(id, donor_id, cat, food_name, description, portions, status,
         pickup_start, pickup_end, posted_at, accepted_by_id, accepted_at, with_qr)
  JOIN food_categories c ON c.code = v.cat
  JOIN users u ON u.id = v.donor_id;

  -- Safety checklists for every donation except the DRAFT and the screening-rejected one.
  -- Cooked meals get prepared time and hot-held 65 C; consume-by is 12 h after the pickup window ends.
  INSERT INTO donation_safety_checklists (donation_id, prepared_at, consume_by_at, storage_condition, storage_temperature_c,
                                          packaging_intact, allergens_confirmed, not_customer_plate_leftovers, completed_at)
  SELECT d.id,
         CASE WHEN c.requires_prepared_time THEN COALESCE(d.pickup_start, now()) - interval '3 hours' END,
         COALESCE(d.pickup_end, now() + interval '2 days') + interval '12 hours',
         CASE WHEN c.requires_storage_info THEN 'HOT_HELD'::storage_condition END,
         CASE WHEN c.requires_storage_info THEN 65.00::numeric(5,2) END,
         true, true, true, now()
  FROM donations d
  JOIN food_categories c ON c.id = d.food_category_id
  WHERE d.id NOT IN (k_dn01, k_dn10);

  INSERT INTO donation_allergens (donation_id, allergen_id)
  SELECT v.donation_id, a.id
  FROM (VALUES
    (k_dn03, 'WHEAT_GLUTEN'), (k_dn03, 'MILK'), (k_dn03, 'EGGS'),
    (k_dn04, 'EGGS'), (k_dn04, 'SOY'),
    (k_dn06, 'WHEAT_GLUTEN'), (k_dn06, 'SOY'),
    (k_dn09, 'WHEAT_GLUTEN'), (k_dn09, 'MILK')
  ) AS v(donation_id, code)
  JOIN allergens a ON a.code = v.code;

  INSERT INTO donation_dietary_tags (donation_id, dietary_tag_id)
  SELECT v.donation_id, t.id
  FROM (VALUES (k_dn01, 'VEGETARIAN'), (k_dn01, 'VEGAN'), (k_dn07, 'VEGETARIAN')) AS v(donation_id, code)
  JOIN dietary_tags t ON t.code = v.code;

  -- ===================================================================
  -- 5. Photos (keys only), screenings
  -- ===================================================================
  INSERT INTO donation_images (donation_id, uploaded_by_user_id, storage_key, image_role, mime_type, size_bytes)
  SELECT d.id, d.donor_id, 'seed/food/' || d.id::text || '.jpg', 'FOOD_PHOTO'::image_role, 'image/jpeg', 250000
  FROM donations d;

  INSERT INTO donation_images (donation_id, uploaded_by_user_id, storage_key, image_role, mime_type, size_bytes)
  SELECT v.donation_id, v.volunteer_id, 'seed/pickup/' || v.donation_id::text || '.jpg', 'PICKUP_PHOTO'::image_role, 'image/jpeg', 200000
  FROM (VALUES (k_dn07, k_vol2), (k_dn08, k_vol1), (k_dn09, k_vol2)) AS v(donation_id, volunteer_id);

  -- Advisory screening result for every photo except the DRAFT's. The rejected donation gets a FLAG.
  INSERT INTO food_screenings (donation_id, image_id, provider, model_version, verdict, confidence, signs, notes)
  SELECT i.donation_id, i.id, 'seed-stub', 'v0',
         (CASE WHEN i.donation_id = k_dn10 THEN 'FLAG' ELSE 'PASS' END)::screening_verdict,
         (CASE WHEN i.donation_id = k_dn10 THEN 0.8800 ELSE 0.9700 END)::numeric(5,4),
         CASE WHEN i.donation_id = k_dn10 THEN '["possible spoilage"]'::jsonb ELSE '[]'::jsonb END,
         'Seeded stub result'
  FROM donation_images i
  WHERE i.storage_key LIKE 'seed/%' AND i.donation_id <> k_dn01;

  -- ===================================================================
  -- 6. Volunteer assignments, pickup inspections, QR scans
  -- ===================================================================
  INSERT INTO donation_assignments (donation_id, volunteer_id, assigned_by_id, assigned_at)
  SELECT v.donation_id, v.volunteer_id, k_admin, d.accepted_at + interval '10 minutes'
  FROM (VALUES
    (k_dn06, k_vol1), (k_dn07, k_vol2), (k_dn08, k_vol1), (k_dn09, k_vol2), (k_dn12, k_vol1)
  ) AS v(donation_id, volunteer_id)
  JOIN donations d ON d.id = v.donation_id;

  -- Accepted pickups: photo plus three yes answers
  INSERT INTO donation_pickup_inspections (donation_id, volunteer_id, photo_image_id, screening_id,
                                           matches_description, packaging_sealed_clean, looks_smells_normal,
                                           decision, reason, inspected_at)
  SELECT i.donation_id, i.uploaded_by_user_id, i.id,
         (SELECT s.id FROM food_screenings s WHERE s.image_id = i.id),
         true, true, true, 'ACCEPTED'::pickup_decision, NULL, d.pickup_start + interval '15 minutes'
  FROM donation_images i
  JOIN donations d ON d.id = i.donation_id
  WHERE i.image_role = 'PICKUP_PHOTO' AND i.storage_key LIKE 'seed/pickup/%';

  -- Rejected at pickup: a reason is enough, no photo needed
  INSERT INTO donation_pickup_inspections (donation_id, volunteer_id, photo_image_id, screening_id,
                                           matches_description, packaging_sealed_clean, looks_smells_normal,
                                           decision, reason, inspected_at)
  SELECT d.id, k_vol1, NULL::uuid, NULL::uuid, true, false, false,
         'REJECTED'::pickup_decision, 'Packaging was damaged and the food smelled sour.', d.pickup_start + interval '15 minutes'
  FROM donations d WHERE d.id = k_dn12;

  INSERT INTO donation_qr_scans (donation_id, stage, scanned_by_user_id, scanned_at)
  SELECT a.donation_id, 'PICKUP'::qr_scan_stage, a.volunteer_id, d.pickup_start + interval '20 minutes'
  FROM donation_assignments a
  JOIN donations d ON d.id = a.donation_id
  WHERE a.donation_id IN (k_dn07, k_dn08, k_dn09);

  INSERT INTO donation_qr_scans (donation_id, stage, scanned_by_user_id, scanned_at)
  SELECT a.donation_id, 'DROPOFF'::qr_scan_stage, a.volunteer_id, d.pickup_start + interval '40 minutes'
  FROM donation_assignments a
  JOIN donations d ON d.id = a.donation_id
  WHERE a.donation_id IN (k_dn08, k_dn09);

  -- ===================================================================
  -- 7. Exit records for REJECTED, DECLINED, REJECTED_AT_PICKUP and CANCELLED
  --    (EXPIRED needs no record). The database fills actor_role from the actor.
  -- ===================================================================
  INSERT INTO donation_exits (donation_id, exit_status, actor_user_id, screening_id, reason)
  VALUES
    (k_dn10, 'REJECTED'::donation_status, NULL::uuid,
       (SELECT s.id FROM food_screenings s WHERE s.donation_id = k_dn10 LIMIT 1),
       'Photo failed visual screening: possible spoilage.'),
    (k_dn11, 'DECLINED'::donation_status, k_admin, NULL::uuid,
       'Quantity is too small for the current pickup capacity.'),
    (k_dn12, 'REJECTED_AT_PICKUP'::donation_status, k_vol1, NULL::uuid,
       'Packaging was damaged and the food smelled sour.'),
    (k_dn13, 'CANCELLED'::donation_status, k_ind1, NULL::uuid, NULL);

  -- ===================================================================
  -- 8. Distribution records (allowed only while a donation is DELIVERED)
  --    DN08: 12 of 20 portions recorded, so you can test finishing the rest.
  --    DN09: 8 distributed + 2 unusable = 10, then it is closed (the database checks the sum).
  -- ===================================================================
  INSERT INTO distribution_entries (donation_id, distributed_on, place, group_id, people_served, portions_distributed, notes, recorded_by_user_id)
  VALUES
    (k_dn08, current_date,     'Barangay hall, Commonwealth',
       (SELECT id FROM beneficiary_groups WHERE code = 'FAMILIES'), 30, 12, 'Served after lunch.', k_vol1),
    (k_dn09, current_date - 1, 'Covered court, Holy Spirit',
       (SELECT id FROM beneficiary_groups WHERE code = 'MIXED_COMMUNITY'), 20, 8, NULL, k_vol2);

  INSERT INTO unusable_portions (donation_id, portions, reason, note, recorded_by_user_id)
  VALUES (k_dn09, 2, 'DAMAGED'::unusable_reason, NULL, k_vol2);

  UPDATE donations SET status = 'CLOSED', closed_at = now() - interval '1 day'
  WHERE id = k_dn09;

  -- ===================================================================
  -- 9. One starting tracking event per donation
  -- ===================================================================
  INSERT INTO donation_tracking_events (donation_id, event_type, from_status, to_status, actor_user_id, event_note)
  SELECT d.id, 'TRANSITION', NULL::donation_status, d.status, d.donor_id, 'Seeded demo data'
  FROM donations d;

  RAISE NOTICE 'Seed complete. Log in with any of these (password Password123!):';
  RAISE NOTICE '  admin@foodlink.test (ADMIN)';
  RAISE NOTICE '  donor.bakery@foodlink.test, donor.catering@foodlink.test (ESTABLISHMENT donors)';
  RAISE NOTICE '  donor.individual@foodlink.test (INDIVIDUAL donor)';
  RAISE NOTICE '  volunteer.one@foodlink.test, volunteer.two@foodlink.test (Volunteers)';
  RAISE NOTICE '  donor.pending@, donor.rejected@, volunteer.pending@, volunteer.suspended@ (test refused logins)';
END;
$seed$;

COMMIT;
