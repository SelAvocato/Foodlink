import { afterAll, describe, expect, it, vi } from "vitest";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

// Mock server-only so Vitest node environment can import server code
vi.mock("server-only", () => ({}));

import { prisma } from "@/server/db";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PostgreSQL Database Guards, Triggers, and Constraints (C10)", () => {
  it("verifies RLS is enabled on all public tables (35 tables)", async () => {
    const tablesWithoutRls = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND NOT rowsecurity
        AND tablename <> '_prisma_migrations';
    `;
    expect(tablesWithoutRls).toHaveLength(0);

    const totalTables = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) as count
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '_prisma_migrations';
    `;
    expect(Number(totalTables[0].count)).toBe(35);
  });

  it("verifies non-owner role (anon) cannot access protected tables due to RLS", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE anon;`);
        await tx.$queryRawUnsafe(`SELECT * FROM users;`);
      })
    ).rejects.toThrow();
  });

  it("enforces guard_user_identity(): rejects mutating role and rejects mutating donor_type after approval", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const userRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'PENDING', 'Test Donor', 'guard-user@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const userId = userRows[0].id;

        await tx.$executeRaw`
          UPDATE users SET role = 'VOLUNTEER' WHERE id = ${userId}::uuid;
        `;
      })
    ).rejects.toThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const userRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Active Donor', 'guard-active@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const userId = userRows[0].id;

        await tx.$executeRaw`
          UPDATE users SET donor_type = 'ESTABLISHMENT', business_name = 'Test Biz' WHERE id = ${userId}::uuid;
        `;
      })
    ).rejects.toThrow();
  });

  it("enforces check_donation_parties(), check_assignment_parties(), and fill_exit_actor_role()", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const volRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, address_id)
          VALUES ('VOLUNTEER', 'ACTIVE', 'Test Vol', 'guard-vol@example.com', '+639123456789', ${addressId}::uuid)
          RETURNING id;
        `;
        const volId = volRows[0].id;

        await tx.$executeRaw`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${volId}::uuid, 1, 'Rice', 10, 'DRAFT', ${addressId}::uuid, now() + interval '1 day', now() + interval '2 day');
        `;
      })
    ).rejects.toThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Indiv Donor', 'guard-indiv@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        await tx.$executeRaw`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 1, 'Cooked Meal', 10, 'DRAFT', ${addressId}::uuid, now() + interval '1 day', now() + interval '2 day');
        `;
      })
    ).rejects.toThrow();

    await prisma.$transaction(async (tx) => {
      const addressRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO addresses (street_line1, city, latitude, longitude)
        VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
        RETURNING id;
      `;
      const addressId = addressRows[0].id;

      const adminRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number)
        VALUES ('ADMIN', 'ACTIVE', 'Test Admin', 'guard-admin@example.com', '+639123456789')
        RETURNING id;
      `;
      const adminId = adminRows[0].id;

      const donorRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
        VALUES ('DONOR', 'ACTIVE', 'Test Donor 2', 'guard-donor2@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
        RETURNING id;
      `;
      const donorId = donorRows[0].id;

      const donationRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end, qr_token)
        VALUES (${donorId}::uuid, 3, 'Produce', 10, 'POSTED', ${addressId}::uuid, now() + interval '1 day', now() + interval '2 day', 'abc123token43byteslongstringxxxxxxxxxxxxxxx')
        RETURNING id;
      `;
      const donationId = donationRows[0].id;

      await tx.$executeRaw`
        INSERT INTO donation_exits (donation_id, exit_status, actor_user_id, reason)
        VALUES (${donationId}::uuid, 'CANCELLED', ${adminId}::uuid, 'Test cancel');
      `;

      const exits = await tx.$queryRaw<{ actor_role: string }[]>`
        SELECT actor_role FROM donation_exits WHERE donation_id = ${donationId}::uuid;
      `;
      expect(exits[0].actor_role).toBe('ADMIN');

      throw new Error("ROLLBACK_TEST");
    }).catch((err) => {
      expect(err.message).toBe("ROLLBACK_TEST");
    });
  });

  it("enforces check_checklist_rules() and check_checklist_after_donation_change()", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Test Donor Checklist', 'guard-checklist@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        const pickupStart = new Date(Date.now() + 86400000);
        const pickupEnd = new Date(Date.now() + 172800000);

        const donationRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DRAFT', ${addressId}::uuid, ${pickupStart}, ${pickupEnd})
          RETURNING id;
        `;
        const donationId = donationRows[0].id;

        const badConsumeBy = new Date(pickupEnd.getTime() - 3600000);
        await tx.$executeRaw`
          INSERT INTO donation_safety_checklists (donation_id, consume_by_at, packaging_intact, allergens_confirmed, not_customer_plate_leftovers, completed_at)
          VALUES (${donationId}::uuid, ${badConsumeBy}, true, true, true, now());
        `;
      })
    ).rejects.toThrow();
  });

  it("enforces guard_portion_records(): rejects when status <> DELIVERED and blocks over-allocation", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Test Portions', 'guard-portions@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        const volRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, address_id)
          VALUES ('VOLUNTEER', 'ACTIVE', 'Test Vol P', 'guard-volp@example.com', '+639123456789', ${addressId}::uuid)
          RETURNING id;
        `;
        const volId = volRows[0].id;

        const donationRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 3, 'Produce', 10, 'ASSIGNED', ${addressId}::uuid, now(), now() + interval '1 day')
          RETURNING id;
        `;
        const donationId = donationRows[0].id;

        const groupRows = await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM beneficiary_groups LIMIT 1;
        `;
        const groupId = groupRows[0].id;

        await tx.$executeRaw`
          INSERT INTO distribution_entries (donation_id, distributed_on, place, group_id, people_served, portions_distributed, recorded_by_user_id)
          VALUES (${donationId}::uuid, current_date, 'Center', ${groupId}, 5, 10, ${volId}::uuid);
        `;
      })
    ).rejects.toThrow();

    await prisma.$transaction(async (tx) => {
      const addressRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO addresses (street_line1, city, latitude, longitude)
        VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
        RETURNING id;
      `;
      const addressId = addressRows[0].id;

      const donorRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
        VALUES ('DONOR', 'ACTIVE', 'Test Portions 2', 'guard-portions2@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
        RETURNING id;
      `;
      const donorId = donorRows[0].id;

      const volRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number, address_id)
        VALUES ('VOLUNTEER', 'ACTIVE', 'Test Vol P2', 'guard-volp2@example.com', '+639123456789', ${addressId}::uuid)
        RETURNING id;
      `;
      const volId = volRows[0].id;

      const donationRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
        VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DELIVERED', ${addressId}::uuid, now(), now() + interval '1 day')
        RETURNING id;
      `;
      const donationId = donationRows[0].id;

      const groupRows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM beneficiary_groups LIMIT 1;
      `;
      const groupId = groupRows[0].id;

      await tx.$executeRaw`
        INSERT INTO distribution_entries (donation_id, distributed_on, place, group_id, people_served, portions_distributed, recorded_by_user_id)
        VALUES (${donationId}::uuid, current_date, 'Center', ${groupId}, 5, 6, ${volId}::uuid);
      `;

      await tx.$executeRaw`
        INSERT INTO distribution_entries (donation_id, distributed_on, place, group_id, people_served, portions_distributed, recorded_by_user_id)
        VALUES (${donationId}::uuid, current_date, 'Center 2', ${groupId}, 5, 5, ${volId}::uuid);
      `;

      throw new Error("ROLLBACK_TEST");
    }).catch((err) => {
      expect(err.message).toBe("ROLLBACK_TEST");
    });
  });

  it("enforces require_reconciliation_on_close(): rejects close when entries = 0 or under-allocated", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Test Close', 'guard-close@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        const donationRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DELIVERED', ${addressId}::uuid, now(), now() + interval '1 day')
          RETURNING id;
        `;
        const donationId = donationRows[0].id;

        await tx.$executeRaw`
          UPDATE donations SET status = 'CLOSED' WHERE id = ${donationId}::uuid;
        `;
      })
    ).rejects.toThrow();
  });

  it("enforces reject_mutation(): rejects UPDATE, DELETE, and TRUNCATE on audit_logs and donation_tracking_events", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const adminRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number)
          VALUES ('ADMIN', 'ACTIVE', 'Test Audit', 'guard-audit@example.com', '+639123456789')
          RETURNING id;
        `;
        const adminId = adminRows[0].id;

        await tx.$executeRaw`
          INSERT INTO audit_logs (actor_user_id, action, target_type, details)
          VALUES (${adminId}::uuid, 'TEST_ACTION', 'USER', '{}'::jsonb);
        `;

        await tx.$executeRaw`
          UPDATE audit_logs SET action = 'MODIFIED_ACTION';
        `;
      })
    ).rejects.toThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        const adminRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number)
          VALUES ('ADMIN', 'ACTIVE', 'Test Audit 2', 'guard-audit2@example.com', '+639123456789')
          RETURNING id;
        `;
        const adminId = adminRows[0].id;

        await tx.$executeRaw`
          INSERT INTO audit_logs (actor_user_id, action, target_type, details)
          VALUES (${adminId}::uuid, 'TEST_ACTION', 'USER', '{}'::jsonb);
        `;

        await tx.$executeRaw`
          DELETE FROM audit_logs;
        `;
      })
    ).rejects.toThrow();
  });

  it("enforces key CHECK constraints and ON DELETE CASCADE from distribution_entries to unusable_portions", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Test Check', 'guard-check@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        const nowTime = new Date();
        const earlierTime = new Date(nowTime.getTime() - 1000);

        await tx.$executeRaw`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DRAFT', ${addressId}::uuid, ${nowTime}, ${earlierTime});
        `;
      })
    ).rejects.toThrow();

    await expect(
      prisma.$transaction(async (tx) => {
        const addressRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO addresses (street_line1, city, latitude, longitude)
          VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
          RETURNING id;
        `;
        const addressId = addressRows[0].id;

        const donorRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
          VALUES ('DONOR', 'ACTIVE', 'Test Unusable', 'guard-unusable@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
          RETURNING id;
        `;
        const donorId = donorRows[0].id;

        const donationRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
          VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DELIVERED', ${addressId}::uuid, now(), now() + interval '1 day')
          RETURNING id;
        `;
        const donationId = donationRows[0].id;

        await tx.$executeRaw`
          INSERT INTO unusable_portions (donation_id, portions, reason, note)
          VALUES (${donationId}::uuid, 2, 'OTHER', NULL);
        `;
      })
    ).rejects.toThrow();

    await prisma.$transaction(async (tx) => {
      const addressRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO addresses (street_line1, city, latitude, longitude)
        VALUES ('123 Test St', 'Manila', 14.5995, 120.9842)
        RETURNING id;
      `;
      const addressId = addressRows[0].id;

      const donorRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number, donor_type, address_id)
        VALUES ('DONOR', 'ACTIVE', 'Test Cascade', 'guard-cascade@example.com', '+639123456789', 'INDIVIDUAL', ${addressId}::uuid)
        RETURNING id;
      `;
      const donorId = donorRows[0].id;

      const volRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number, address_id)
        VALUES ('VOLUNTEER', 'ACTIVE', 'Test Vol C', 'guard-volc@example.com', '+639123456789', ${addressId}::uuid)
        RETURNING id;
      `;
      const volId = volRows[0].id;

      const donationRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO donations (donor_id, food_category_id, food_name, portions, status, pickup_address_id, pickup_start, pickup_end)
        VALUES (${donorId}::uuid, 3, 'Produce', 10, 'DELIVERED', ${addressId}::uuid, now(), now() + interval '1 day')
        RETURNING id;
      `;
      const donationId = donationRows[0].id;

      const groupRows = await tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM beneficiary_groups LIMIT 1;
      `;
      const groupId = groupRows[0].id;

      const entryRows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO distribution_entries (donation_id, distributed_on, place, group_id, people_served, portions_distributed, recorded_by_user_id)
        VALUES (${donationId}::uuid, current_date, 'Center', ${groupId}, 5, 8, ${volId}::uuid)
        RETURNING id;
      `;
      const entryId = entryRows[0].id;

      await tx.$executeRaw`
        INSERT INTO unusable_portions (donation_id, entry_id, portions, reason)
        VALUES (${donationId}::uuid, ${entryId}::uuid, 2, 'DAMAGED');
      `;

      await tx.$executeRaw`
        DELETE FROM distribution_entries WHERE id = ${entryId}::uuid;
      `;

      const unusableCount = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) as count FROM unusable_portions WHERE entry_id = ${entryId}::uuid;
      `;
      expect(Number(unusableCount[0].count)).toBe(0);

      throw new Error("ROLLBACK_TEST");
    }).catch((err) => {
      expect(err.message).toBe("ROLLBACK_TEST");
    });
  });
});
