# FoodLink: Project Notes

Living notes for teammates and AI tools. Read this before making changes.
Keep it short. When a PR changes a decision, a rule or a gotcha below, update this file in the same PR.

Last updated: 2026-11-01

## 1. What FoodLink is

A web platform that moves safe surplus food from food establishments and individual donors to one host food-recovery organization. The host organization is the Admin. There is **no Receiver role** (an old version had one; ignore anything Receiver-related).

Source of truth for behavior: the "FoodLink System Structure & Development Plan" PDF (Oct 31 version). Where this file and the PDF disagree, ask the team.

## 2. Stack and versions

- Next.js 16 (App Router, TypeScript, `src/` dir, `@/*` alias), React 19, React Compiler on, Cache Components off
- Tailwind CSS v4 with shadcn/ui (Radix base). Components live in `src/components/ui`
- Zod 4 for validation, Vitest 5 for tests
- Planned, not built yet: PostgreSQL + Prisma (Supabase), Auth.js with JWT sessions, Supabase storage
- Hosting: Vercel Hobby (free). Preview per PR, production from `main`
- Node **26** (Active LTS). Pinned in `.nvmrc`, `package.json` `engines`, `@types/node` and the Vercel setting. Run `nvm install 26` once
- Next.js 16 renamed `middleware.ts` to **`proxy.ts`**. The PDF still says middleware

Held back on purpose (do not "fix" these):
- TypeScript 7 and ESLint 10: the lint tooling (`typescript-eslint`, React and import plugins) does not support them yet. Dependabot ignores them
- Do not run `npm audit fix --force`. It downgrades `shadcn`. The remaining audit warnings are inside the shadcn CLI, not the shipped app

## 3. Commands

```bash
npm run dev         # local dev server
npm run lint
npm run typecheck   # next typegen && tsc --noEmit (route types are generated, so CI needs typegen)
npm test            # vitest run
npm run build
```

Before opening a PR: lint, typecheck, test and build must pass locally.

## 4. Workflow

- One long-lived branch: `main`. Work on a feature branch, open a PR into `main`, squash merge. Head branches delete automatically
- Never push to `main` directly. The `protect-main` ruleset blocks it
- Commit messages and **PR titles**: `type(scope): description`. Types: feat, fix, chore, ci, docs, refactor, style, test, build. A scope is required. Scopes: donor, volunteer, admin, landing, auth, contracts, ui, db, workflow, config, deps, build
- Required checks on every PR: `checks` (lint, typecheck, test, build) and `pr-title`
- Required approvals are 0 so nobody waits. Review each other's PRs anyway, and click through the Vercel preview for UI changes
- No CODEOWNERS and no "require branch up to date" rule (decided: too slow for 3 people)
- Dependabot opens grouped weekly PRs for npm and GitHub Actions. Merge them only when CI is green
- Open PRs in the GitHub web UI. The PR template fills in automatically
- Folder ownership and the UI conventions are in `CONTRIBUTING.md`

## 5. Domain rules (from the System Structure PDF)

**Actors:** Visitor, Donor (establishment or individual), Volunteer, Admin, AI Vision API.

**Accounts:** Donors and Volunteers self-register and wait for Admin approval: `PENDING` then `ACTIVE` or `REJECTED`, and an account can be `SUSPENDED`. Admin accounts are seeded, never created through public registration. Login is refused with a named reason for Pending, Rejected or Suspended accounts.

**Donation statuses (13):** `DRAFT`, `SCREENED`, `POSTED`, `ACCEPTED`, `ASSIGNED`, `PICKED_UP`, `DELIVERED`, `CLOSED`, plus exits `REJECTED`, `DECLINED`, `REJECTED_AT_PICKUP`, `CANCELLED`, `EXPIRED`. Shared enums live in `src/contracts/enums.ts` and must match the database.

**Rules that must not be broken:**
- Every status change goes through one function, `transitionDonation(id, to, actor, payload)`. It checks the allowed-transition table and, in one transaction, updates the row, writes the TrackingEvent, creates Notifications and appends the AuditLog. Emails are sent after the transaction commits. No other code changes `Donation.status`
- Accepting a donation is one atomic update: `UPDATE ... SET status = 'ACCEPTED', accepted_by = $1 WHERE id = $2 AND status = 'POSTED'` and the pickup window not yet passed. One row changed means accepted. Zero means someone else got it
- Two independent food checks: the Donor's photo, AI screening and checklist at posting, and the Volunteer's photo, AI screening and three yes/no questions at pickup. The Volunteer's pickup decision is the final gate
- The Volunteer completes the donation after recording distribution entries. Portions distributed plus unusable portions must equal portions donated, and at least one distribution record must exist, before `CLOSED`. Admin can only view and reassign
- Quantity is in whole portions. One food photo per donation in version 1
- AI screening is a visual aid only. A malformed reply, timeout or low confidence becomes `REVIEW`
- Never end a volunteer assignment when delivering or closing (impact statistics find the Volunteer through the current assignment)

**Privacy and security:**
- Data Privacy Act (RA 10173): record consent with a timestamp, show contact details only to users involved in a donation, never store names of individual beneficiaries (distribution reports show places and groups served only), no identifiable faces in photos
- Role checks happen in `proxy.ts` and again in every API handler (`requireRole(...)` plus an ownership check). The role comes from the verified JWT, never the request body
- Zod validation on every request, unknown fields rejected, free text stored as plain text
- Uploads: JPEG, PNG or WebP up to 5 MB, random names, private bucket, signed URLs
- QR token: 32 bytes, never expose raw ids, scans validated (assigned volunteer, correct stage, not expired) and idempotent
- OTP: 6 digits, 5-minute expiry, at most 3 per 15 minutes. Passwords need uppercase, lowercase, number, special character and 8+ characters

**Routes:** `/`, `/login`, `/register/donor`, `/register/volunteer`, `/forgot`, `/admin/login`, `/donor/*`, `/volunteer/*`, `/admin/*`.

## 6. Environment variables

- Copy `.env.example` to `.env.local`. Never commit real values
- Adding a variable means three changes in the same PR: `.env.example`, `src/lib/env.schema.ts`, and Vercel (Preview and Production)
- Read variables with `getEnv()` from `src/lib/env.server.ts`, never `process.env` directly. Browser code may only use `NEXT_PUBLIC_` variables
- A test keeps `.env.example` and the schema in sync
- When the database arrives, Preview deployments must use a different database from Production

## 7. Database status

- The database author's schema (`foodlink_schema_v3.sql`) replaces an older Receiver-based design and matches the System PDF on almost everything
- A short list of required fixes was sent back to the author: group labels as a lookup table instead of free text, at least one distribution entry before closing, block `TRUNCATE` on the append-only tables, row-level security on every table, a revocable QR token (`qr_version`), volunteer availability, drop the unused LOGIN one-time-code purpose, and rename the three pickup quick-check columns
- Not decided yet: whether Prisma Migrate or the SQL files are the source of truth. Prisma cannot express triggers, views, CHECK constraints or partial unique indexes, so those need hand-written SQL in migrations
- Every new table needs row-level security enabled in its migration
- No Prisma schema exists yet

## 8. Gotchas

- `.gitignore` ignores `.env*` but allows `.env.example`
- Vercel Hobby cron jobs run at most once per day. The PDF's 15-minute expiry job needs another runner (a scheduled GitHub Actions workflow calling a secured endpoint, or expire on read plus a daily sweep)
- JWT sessions keep a suspended user signed in until the token expires. Re-check account status in `proxy.ts` or `requireRole()`
- The Tailwind setup uses a custom Turbopack loader in `next.config.ts`. If styles break, switch to the documented `@tailwindcss/postcss` setup
- GitHub repo invitations expire. Resend from Settings, Collaborators if a teammate cannot see the repo

## 9. Decision log

| Date | Decision |
|---|---|
| Oct 28 | Single `main` branch, no staging. CI only on GitHub, deploys handled by Vercel |
| Oct 30 | Team now works by feature (full stack per feature). Prettier check not needed. CODEOWNERS skipped |
| Oct 31 | `pr-title` made a required check. Dependabot and secret scanning turned on. Minimum token permissions in CI. Vitest and env validation added |
| Nov 1 | Moved to Node 26 LTS. Dependabot ignores TypeScript 7 and ESLint major bumps |

## 10. Open questions

- Beneficiary group labels and the allowed food categories for individual donors (confirm with the adviser and the beneficiary organization)
- Whether pending accounts may log in with posting locked, or are blocked at login
- Email provider (Resend needs a verified domain; plain SMTP is the fallback) and AI vision provider
- Badge thresholds for achievements
- How to run the expiry job on the free Vercel plan
- QR token wording: the PDF says random, the database derives it from the donation id (to be aligned)
- Whether Prisma Migrate or the SQL files own the schema

## 11. Next up

1. Finish the Vercel checks once teammates accept the repo invite (test a PR from a teammate)
2. `src/contracts/auth.ts`: Zod schemas for login, donor and volunteer registration, forgot password and OTP, with tests
3. Prisma schema once the database author's fixes are in, then a Prisma CI job (validate, generate, migrate against a Postgres service container, enum alignment check)
4. Auth pages with shadcn/ui and mock data, then wait for the UI/UX designs on the landing page and dashboards
