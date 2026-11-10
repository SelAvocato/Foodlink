# FoodLink: Project Notes

Living notes for teammates and AI tools. Read this before making changes.
Keep it short. When a PR changes a decision, a rule or a gotcha below, update this file in the same PR.

Last updated: 2026-11-09

## 1. What FoodLink is

A web platform that moves safe surplus food from food establishments and individual donors to one host food-recovery organization. The host organization is the Admin. There is **no Receiver role** (an old version had one; ignore anything Receiver-related).

Source of truth for behavior: the "FoodLink System Structure & Development Plan" PDF (Oct 31 version). Where this file and the PDF disagree, ask the team.

## 2. Stack and versions

- Next.js 16 (App Router, TypeScript, `src/` dir, `@/*` alias), React 19, React Compiler on, Cache Components off
- Tailwind CSS v4 with shadcn/ui (Radix base). Components live in `src/components/ui`
- Zod 4 for validation, Vitest 5 for tests
- PostgreSQL + Prisma 7 (Supabase): the schema, baseline migration and `src/server/db.ts` (Prisma client with the `@prisma/adapter-pg` driver adapter) are merged. The Auth.js JWT login backend (`src/server/auth/login.ts`), Donor and Volunteer registration (`src/server/registration/`, routes `/api/auth/register/donor` and `/api/auth/register/volunteer`) and the Supabase Storage wiring (`src/server/storage.ts`, helper `src/lib/storage.ts`) are merged too
- Hosting: Vercel Hobby (free). Preview per PR, production from `main`
- Node **26** (Active LTS). Pinned in `.nvmrc`, `package.json` `engines`, `@types/node` and the Vercel setting. Run `nvm install 26` once
- Next.js 16 renamed `middleware.ts` to **`proxy.ts`**. The PDF still says middleware

Held back on purpose (do not "fix" these):
- TypeScript 7 and ESLint 10: the lint tooling (`typescript-eslint`, React and import plugins) does not support them yet. Dependabot ignores them
- Do not run `npm audit fix --force`. It downgrades `shadcn`. The remaining audit warnings are inside the shadcn CLI, not the shipped app
- Prisma 8: the `latest` tag on npm is a release candidate. Stay on 7.10.1

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

- One long-lived branch: `main`. Work on a feature branch, open a PR into `main`, merge with a merge commit (not squash). Head branches delete automatically
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

**Accounts:** Donors and Volunteers self-register and wait for Admin approval: `PENDING` then `ACTIVE` or `REJECTED`, and an account can be `SUSPENDED`. Admin accounts are seeded, never created through public registration. Existing Admins can also create staff accounts (planned for the next sprint). Login is refused with a named reason for Pending, Rejected or Suspended accounts. Admin review moves: approve and reject only from PENDING, suspend only from ACTIVE, reactivate only from SUSPENDED. Reject and suspend need a reason. The reviewer comes from the session and the target user from the URL (`src/contracts/review.ts`).

**Donation statuses (13):** `DRAFT`, `SCREENED`, `POSTED`, `ACCEPTED`, `ASSIGNED`, `PICKED_UP`, `DELIVERED`, `CLOSED`, plus exits `REJECTED`, `DECLINED`, `REJECTED_AT_PICKUP`, `CANCELLED`, `EXPIRED`. Shared enums live in `src/contracts/enums.ts` and must match the database.

**Rules that must not be broken:**
- Every status change goes through one function, `transitionDonation({ store }, id, to, actor, payload)`. It checks the allowed-transition table and, in one transaction, updates the row, writes the TrackingEvent, creates Notifications and appends the AuditLog. Emails are sent after the transaction commits. No other code changes `Donation.status`
- Draft rows are created directly with status `DRAFT`; `transitionDonation()` changes existing donation status only.
- Automatic expiry and screening use a null system actor. Null actors are allowed only for `EXPIRED` after `pickup_end`, or system screening transitions from `DRAFT` to `SCREENED`/`REJECTED`; human transitions always require a verified actor.
- Accepting a donation is one atomic update: `UPDATE ... SET status = 'ACCEPTED', accepted_by = $1 WHERE id = $2 AND status = 'POSTED'` and the pickup window not yet passed. One row changed means accepted. Zero means someone else got it
- Two independent food checks: the Donor's photo, AI screening and checklist at posting, and the Volunteer's photo, AI screening and three yes/no questions at pickup. The Volunteer's pickup decision is the final gate
- The Volunteer completes the donation after recording distribution entries. Portions distributed plus unusable portions must equal portions donated, and at least one distribution record must exist, before `CLOSED`. Admin can only view and reassign
- Quantity is in whole portions. One food photo per donation in version 1
- AI screening is a visual aid only. A malformed reply, timeout or low confidence becomes `REVIEW`
- Never end a volunteer assignment when delivering or closing (impact statistics find the Volunteer through the current assignment)

**Privacy and security:**
- Data Privacy Act (RA 10173): record consent with a timestamp, show contact details only to users involved in a donation, never store names of individual beneficiaries (distribution reports show places and groups served only), no identifiable faces in photos
- Role checks happen in every API handler (`requireRole(...)` plus an ownership check); `src/proxy.ts` adds a coarse first gate. The role comes from the verified JWT, never the request body
- Zod validation on every request, unknown fields rejected, free text stored as plain text
- Login uses Auth.js credentials with JWT sessions. Unknown users and incorrect passwords receive `Invalid username or password`; PENDING, REJECTED and SUSPENDED users receive their named account status. Login failures and successes are written to append-only `audit_logs` without passwords, email addresses or raw IP addresses
- Login lockout is progressive and non-permanent: the fifth consecutive failed password attempt locks the account for 15 minutes, the sixth for 30 minutes, and the seventh or later for 60 minutes. A successful login resets the counter and lock
- Uploads: JPEG, PNG or WebP up to 5 MB, random names, private bucket, signed URLs
- QR token: 32 bytes, never expose raw ids, scans validated (assigned volunteer, correct stage, not expired) and idempotent
- OTP: 6 digits, 5-minute expiry, at most 3 per 15 minutes. Passwords need uppercase, lowercase, number, special character and 8 to 128 characters at registration and password reset. Login only checks that a password was sent (1 to 128 characters), so a seeded Admin or a later policy change never fails validation

**Routes:** `/`, `/login`, `/register/donor`, `/register/volunteer`, `/forgot`, `/admin/login`, `/donor/*`, `/volunteer/*`, `/admin/*`.

## 6. Environment variables

- Copy `.env.example` to `.env.local`. Never commit real values
- Adding a variable means three changes in the same PR: `.env.example`, `src/lib/env.schema.ts`, and Vercel (Preview and Production)
- Read variables with `getEnv()` from `src/lib/env.server.ts`, never `process.env` directly. Browser code may only use `NEXT_PUBLIC_` variables
- A test keeps `.env.example` and the schema in sync
- When the database arrives, Preview deployments must use a different database from Production

## 7. Database status

- The database author's schema replaces an older Receiver-based design and matches the System PDF. All fixes sent back to the author are in. The files live in `db/baseline/`: `001_schema.sql`, then `002_objects.sql`. Apply them in that order
- Applies cleanly on PostgreSQL 16 through Prisma (`prisma migrate deploy` runs in the CI `database` job). Not tested on PostgreSQL 15. Not confirmed on the hosted Supabase database
- `donations.qr_token` (random 32 bytes, base64url) is required by a CHECK for POSTED and every later status, so the update to POSTED must write it. Never select it in list queries
- Proof documents and photos are images only (JPEG, PNG or WebP, up to 5 MB)
- `fn_donation_report` does not check who is calling. The API handler must confirm ownership or role first
- The SQL files are the schema source of truth and are concatenated into `prisma/migrations/0_init/migration.sql`. Use `npm run db:migrate` only; do not use `prisma migrate dev` because Prisma cannot express triggers, views, CHECK constraints or partial unique indexes
- Every new table needs row-level security enabled in its migration. CI should fail if any table in `public` has it off
- `prisma generate` writes the client to `src/generated/prisma`, which is ignored by Git and generated before Vercel builds

## 8. Gotchas

- `.gitignore` ignores `.env*` but allows `.env.example`
- Vercel Hobby cron jobs run at most once per day. The PDF's 15-minute expiry job needs another runner (a scheduled GitHub Actions workflow calling a secured endpoint, or expire on read plus a daily sweep)
- JWT sessions keep a suspended user signed in until the token expires. Re-check account status in `requireRole()`; the proxy only reads JWT claims, which can be stale.
- The Tailwind setup uses a custom Turbopack loader in `next.config.ts`. If styles break, switch to the documented `@tailwindcss/postcss` setup
- GitHub repo invitations expire. Resend from Settings, Collaborators if a teammate cannot see the repo
- FoodLink uses the pinned `next-auth` v4.24.15 release because the existing Auth.js route and `authOptions` use the v4 API; do not upgrade to the v5 beta without an explicit migration.
- The password hash lives in `user_credentials`, not in `users`. Creating a user means writing both rows in one transaction
- The Donor and Volunteer signup routes (`/api/auth/register/donor` and `/api/auth/register/volunteer`) are public and have no rate limit yet, so a client can create many pending accounts and proof uploads with different emails. A rate limit on both signup routes is a release gate: it must be in place before the site is public. The limiter is planned for the next sprint
- The signup route answers 409 when an email is already registered, which reveals that the email has an account. Accepted for now because the System PDF says a duplicate email is refused
- Vercel Functions reject request bodies over 4.5 MB before the code runs (413). The signup routes therefore accept proofs up to 4 MB, even though the shared image rule (`src/contracts/image.ts`) allows 5 MB, so the browser must compress photos before sending. If 4 MB proves too small, upload proofs directly to Supabase with a signed upload URL instead
- Account review sends no email or in-app notification yet. The System PDF says the user is emailed on approval and rejection; add the email after the transaction commits once the email provider is chosen
- The transition service currently notifies only the donor. Volunteer assignment/pickup notifications and Admin rejection-at-pickup notifications belong to the notification phase.
- There is no HTML-stripping sanitizer yet. Free text such as the food name and description is stored as trimmed plain text, while the System PDF asks for HTML to be stripped. Add it in the security pass for every free-text field
- Reassigning a Volunteer is not implemented. Add reassignment for ASSIGNED donations and DELIVERED donations with an unfinished distribution report, preserving assignment history.
- Admin list queries never select `storage_key` or `original_filename`, and the responses are built from an explicit allow-list, so neither value can reach an Admin list response
- `src/proxy.ts` is the coarse JWT gate for `/admin`, `/donor`, `/volunteer` and their `/api/*` paths. `/admin/login` is intentionally public. API paths receive JSON 401/403 responses; page paths redirect to login. Handlers must still call `requireRole()` because proxy JWT claims can be stale.
- Proof files are never served through the app: Admins get short-lived signed URLs only, the storage key and original file name never leave the server, and every view is audited.
- updateDraft and discardDraft do not re-check the donor's account status; the route's requireRole() does. A suspended donor with a still-valid JWT is only stopped there.
- The donor sets the pickup window after the checklist (wizard step 3), so pickup_end is often null when the checklist is saved. The database re-checks consume-by against the pickup end when the window is set (trigger donations_recheck_checklist); the post step must map that error to a clear message.
- A retake soft-deletes the old donation_images row but leaves its file in the bucket until a cleanup job exists (retention is still an open question). A retake is refused (REVIEW_PENDING) while a REVIEW verdict is pending, and the photo is locked once the donation is SCREENED.
- The storage cleanup paths (saveFoodPhoto, registerAccount) and the admin proof URL route log failures only through safeErrorSummary() (a short error name and code, never the message or stack), and the photo routes log only the error name, because storage and Prisma error messages can contain the key. Other routes still log raw errors; new code that touches storage keys or signed URLs must not. Never log a storage key or signed URL.
- The screening row is saved before the status transition because transitionDonation() opens its own transaction; if the transition fails the screening row stays and the donation is still DRAFT, and screening can be run again (a retake is refused meanwhile, because the active photo already has a PASS or FLAG screening). The final checks and the screening insert run under the same donation row lock as photo uploads, so a retake either happens first (screening answers PHOTO_CHANGED) or is refused afterwards (REVIEW_PENDING, or NOT_EDITABLE once the active photo has a PASS or FLAG screening). A double submit can create two PASS or FLAG screening rows; the second transition is refused.
- The provider receives a 60-second signed URL (matching screenFoodImage(imageUrl) in the PDF); when a real provider is chosen, prefer sending the file bytes from the server, which needs a download helper in src/lib/storage.ts. The 0.7 confidence threshold is our choice, the PDF gives none.
- Provider text (signs) is stored and shown in the rejection reason after stripping angle brackets and control characters; there is still no HTML sanitizer.
- The Admin cannot resolve a REVIEW case yet: the transition table has no ADMIN for DRAFT to SCREENED or REJECTED, and the screening review queue is not built. Until both exist a donor whose photo is in review can only discard the draft.
- The PDF says posting sets expiresAt, but the schema has no expires_at column: pickup_end is the single source of truth for expiry (decision D5 in the schema), and the expiry job and queue use it.
- The pickup window is validated again when the donation is posted (B10b), because the checklist can change after the pickup is saved and the start time can pass.
- The posting checks and the transition are not atomic: transitionDonation() opens its own transaction, so a checklist or pickup save from the same donor landing in those few milliseconds could post a donation whose final state was not checked (the database triggers still guard consume-by against the pickup end). A guard hook inside transitionDonation() would close it.
- The PDF's optional pickup notes have no column in donations (description is the food description); the field is not stored yet.
- A donor cancel notifies nobody: transitionDonation() creates notifications for the donor only (the donor is the actor), so Admin is not told when a donor cancels a POSTED or ACCEPTED donation until the notification phase.
- A REVIEW verdict keeps the donation in DRAFT and freezes the donor's photo until an Admin decides; the seed has no REVIEW case and the mock provider always passes, so the queue is empty in a fresh environment.

## 9. Decision log

| Date | Decision |
|---|---|
| Oct 28 | Single `main` branch, no staging. CI only on GitHub, deploys handled by Vercel |
| Oct 30 | Team now works by feature (full stack per feature). Prettier check not needed. CODEOWNERS skipped |
| Oct 31 | `pr-title` made a required check. Dependabot and secret scanning turned on. Minimum token permissions in CI. Vitest and env validation added |
| Nov 1 | Moved to Node 26 LTS. Dependabot ignores TypeScript 7 and ESLint major bumps |
| Nov 4 | SQL baseline became the initial Prisma migration; deploy-only workflow and PostgreSQL CI checks are required |
| Nov 5 | Login schema checks only a non-empty password (max 128); the complexity rules apply at registration and reset |
| Nov 5 | Uploads go only through `src/lib/storage.ts`: random keys like `folder/uuid.ext` (unknown folders and content types are refused), the database stores only the key, signed URLs last 5 minutes by default (max 1 hour) and are created only after role and ownership checks |
| Nov 5 | Registration contracts: Donor must send a map pin, Volunteer's pin is optional (the PDF asks Volunteers only for an address). Consent is stored in `user_consents`, with the type and policy version as constants in `src/contracts/registration.ts` |
| Nov 6 | Passwords are hashed with Argon2id (`@node-rs/argon2`: 19 MiB, 2 passes, 1 lane) only through `src/lib/password.ts`. Registration will use `hashPassword` and Auth.js login will use `verifyPassword` when those flows are built, so there is one place to change |
| Nov 6 | Account review rules live in `src/contracts/review.ts` (`resolveReview` checks the current status). A rejected account cannot be re-approved, and suspend applies to ACTIVE accounts only |
| Nov 6 | Donor registration is one function (`src/server/registration/register-donor.ts`) with an injected store. It hashes the password, uploads the proof, then writes the address, user (PENDING), credentials, consent and proof document in one transaction, and removes the uploaded file if the transaction fails. The proof arrives in the same request because a pending user has no session. `user_documents.original_filename` stores only the random file name from the storage key, never the name the user chose |
| Nov 6 | Pull requests are merged with merge commits, not squash |
| Nov 7 | Uploads go to the private Supabase Storage bucket `foodlink-uploads` with the server-side secret key, wired in `src/server/storage.ts`. Photos are compressed in the browser first because Vercel Functions reject request bodies over 4.5 MB |
| Nov 7 | Volunteer registration reuses the shared flow in `src/server/registration/register-account.ts`; Donor and Volunteer differ only in the user row and the proof type. The Volunteer's proof is saved as `VALID_ID`. The map pin is optional and is saved only when both coordinates are sent. `availability` is saved for Volunteers only |
| Nov 7 | Account review is one function (`src/server/review/review-account.ts`) with an injected store. In one transaction it changes the status with a conditional update, marks the user's pending proof documents APPROVED (approve) or REJECTED (reject, with the reason as review note), and writes one `user_reviews` row and one `audit_logs` row (the reason text is not copied into the audit details). Suspend and reactivate leave documents alone. Only Donor and Volunteer accounts can be reviewed, and nobody can review themselves. The admin route calls it behind `requireRole(["ADMIN"])` (Nov 8) |
| Nov 7 | Donation drafts are inserted directly with the database default status DRAFT (`src/server/drafts/`); creating, editing or discarding a draft is not a status change, so it writes no tracking event or audit row and `transitionDonation()` is not involved. The screening flow advances an existing draft from DRAFT to SCREENED through `transitionDonation()`. A Donor can edit a draft in DRAFT or SCREENED, change its category only in DRAFT, and discard it in either (sets `deleted_at`). Individual Donors can only use categories with `allowed_for_individuals`. The API uses category, allergen and tag codes, not numeric ids. Pickup address and window are saved at posting (B10) |
| Nov 8 | A4 authorization is implemented in `src/server/auth/require-role.ts` and `src/proxy.ts`. The proxy gates admin, donor and volunteer paths, leaves `/admin/login` public, returns JSON 401/403 for API paths and redirects page paths. Every handler still calls `requireRole()`, which re-reads the user from the database and rejects deleted, PENDING, REJECTED or SUSPENDED accounts before checking the allowed role. B3 seed data remains a development-only direct SQL insert exception; normal application status changes still use `transitionDonation()` |
| Nov 8 | The generic `POST /api/donations/[id]/transition` route is ADMIN-only and authenticates before reading or validating the request body. It accepts only `to`, `reason`, `volunteerId` and `eventNote`. It does not accept client-controlled QR tokens, distribution flags, metadata, notification recipients or screening ids. Donor and Volunteer lifecycle actions must use dedicated routes that compute server-side payloads and enforce ownership. Admin and system actors may move DRAFT to SCREENED or REJECTED; audit transition fields cannot be overwritten by metadata |
| Nov 8 | The transition service currently creates in-app notifications only for the donor. Volunteer notifications for ASSIGNED and Admin notifications for REJECTED_AT_PICKUP remain notification-phase work. Volunteer reassignment remains open for ASSIGNED donations and DELIVERED donations with an unfinished report |
| Nov 8 | Admin account review routes (`GET /api/admin/users`, `POST /api/admin/users/[id]/review`): each handler calls `requireRole(["ADMIN"])` itself before reading any input (the proxy alone is not enough). The reviewer id comes from the session and the target id from the URL, never the body. Errors: NOT_FOUND 404, TARGET_NOT_REVIEWABLE 403, INVALID_TRANSITION 409. Proof files are not served by these routes; a separate signed-URL route will do that. |
| Nov 8 | Admin proof viewing (`GET /api/admin/users/[id]/documents/[documentId]/signed-url`): the handler calls `requireRole(["ADMIN"])` first, then returns a 300-second signed URL (`Cache-Control: no-store`) only for a non-deleted document that belongs to the user in the URL; a mismatched or unknown document is a 404. Each view writes an `audit_logs` row (`proof_document_viewed`, target the document, details only the user id; never the key or URL). |
| Nov 8 | Donor draft routes live under /api/donor/drafts (POST create, GET list, PATCH and DELETE on [id]). The list returns DRAFT and SCREENED donations only, newest first, max 50. A malformed draft id returns 400 INVALID_REQUEST; a missing or foreign draft id returns 404 NOT_FOUND. |
| Nov 8 | Donation safety checklist routes live at /api/donor/drafts/[id]/checklist (PUT saves the whole checklist, GET reads it). Saving progress is allowed while the donation is DRAFT or SCREENED; completed_at is set by the server only when every rule for the category passes, otherwise it stays null. Fields the category does not use (prepared time, storage condition and temperature) are stored as null. The rules mirror fn_assert_checklist_rules; the database remains the last line of defence. |
| Nov 8 | Donor food photo routes live at /api/donor/drafts/[id]/photo (POST uploads or retakes, GET returns a 300-second signed URL for the donor's own photo, no audit row). One active FOOD_PHOTO per donation (unique partial index): a retake soft-deletes the old row and inserts the new one in one locked transaction. Upload and retake are allowed only while the donation is DRAFT. The file is uploaded before the database write and removed again if the write is refused or fails. The upload does not run screening and does not change the donation status. |
| Nov 9 | Food screening runs behind a provider interface (screenDraftPhoto, src/server/screening/): the provider's reply is validated with Zod and anything that throws, times out (10 s), is malformed or has confidence below 0.7 becomes REVIEW. PASS moves the DRAFT donation to SCREENED and FLAG to REJECTED (with the reason and the screening id) through transitionDonation() with a null system actor; REVIEW leaves it in DRAFT with the verdict saved, and a pending review is a food_screenings row with verdict REVIEW and reviewed_at null. The provider is a mock that always passes until a real one is chosen after the demo. |
| Nov 9 | Screening route POST /api/donor/drafts/[id]/screening (donor only, no body): runs the provider and returns the verdict, the resulting donation status and, for a FLAG, the rejection reason. The provider is chosen in one file (get-provider.ts) and is still the mock. Photo uploads and retakes are refused with 409 REVIEW_PENDING while a REVIEW verdict is pending, so the Admin reviews the photo the donor sees; a donor whose photo is in review can discard the draft. Screening cannot be repeated after PASS (SCREENED) or FLAG (REJECTED), which also limits provider calls. |
| Nov 9 | Donation pickup routes live at /api/donor/drafts/[id]/pickup (PUT saves the whole pickup, GET reads it). Allowed while the donation is DRAFT or SCREENED. The pickup start must be in the future and, when the checklist has a consume-by time, the window must end before it; the checks run under the donation row lock, so the checklist trigger never surfaces as a raw error. Each save inserts a new addresses row for the donation and deletes the previous one only when nothing else references it, so a profile or seed address is never changed. The pickup address map pin is optional (same schema as signup). |
| Nov 9 | Posting: POST /api/donor/drafts/[id]/post (donor only, body { confirmed: true }). It re-validates everything the PDF requires (donation is SCREENED, an active food photo exists, the checklist is complete under the category rules, the pickup address and window are set, the start is in the future and consume-by is after the pickup end) and then calls transitionDonation() as the donor with a server-generated QR token (32 random bytes, base64url, 43 characters). The token is never returned or logged; the donor reads it from the QR label route (GET /api/donor/donations/[id]/qr). The expiry is the pickup end (no expires_at column), returned as expiresAt. |
| Nov 9 | Donor cancel: POST /api/donor/donations/[id]/cancel (donor only, optional reason up to 500 characters) while the donation is POSTED or ACCEPTED, through transitionDonation() as the donor; once a volunteer is assigned only an Admin can cancel. QR label: GET /api/donor/donations/[id]/qr returns the token for the owner while the donation is POSTED, ACCEPTED or ASSIGNED, with Cache-Control: no-store; the token is never logged. The scan URL format is decided with the volunteer scan route. |
| Nov 9 | Admin donation queue (list): GET /api/admin/donations/queue (Admin only) returns POSTED, unexpired donations by soonest pickup end through fn_admin_donation_queue, with the donor's display name and the pickup address as text, and an optional foodCategoryId filter. Accepting or declining goes through the generic transition route until dedicated routes exist. No phone, email, QR token or storage keys are returned. |
| Nov 9 | Admin screening queue (read side): GET /api/admin/screenings lists donations whose latest screening is REVIEW with no reviewer, ordered oldest first, with a short-lived signed photo URL and the checklist; no donor contact data. The decision route (pass or reject) will be added separately. |
| Nov 9 | The transition matrix is pinned down by tests (`src/server/donations/transition-donation.test.ts`): every from-to pair that is not in the table answers INVALID_TRANSITION, every wrong actor for an allowed pair answers FORBIDDEN_ACTOR (with a reason supplied), and every allowed pair is covered with its payload preconditions (QR token, active volunteer, reason, reconciled distribution) plus the null system actor for screening and expiry |
| Nov 10 | A8 admin donation actions: `POST /api/admin/donations/[id]/accept`, `/decline`, `/assign`, `/cancel`. All Admin-only (`requireRole(["ADMIN"])` before any input is read; the proxy alone is not enough), thin handlers over `transitionDonation()` via `src/server/admin/admin-donation-action.ts`. Accept takes an empty JSON body and returns 409 INVALID_TRANSITION when the pickup window has passed or the row changed first (the update is one conditional `updateMany`, one row means accepted). Decline and cancel require a trimmed reason (1 to 500 characters); assign requires a `volunteerId` uuid and the volunteer must be ACTIVE at transition time. Admin routes assume no ownership check (an Admin acts on any donation); every route rejects unknown fields and carries a wrong-role test. The generic `/api/donations/[id]/transition` route stays for the other transitions (SCREENED, REJECTED, EXPIRED, pickup and delivery moves) |
| Nov 10 | API conventions (A5): one error body everywhere — `src/server/http/errors.ts` (`errorResponse`, `authErrorResponse`); route handlers authenticate before reading input, then validate with `parseJsonBody(request, schema, message)` from `src/server/http/parse-json.ts`, which returns 400 INVALID_REQUEST (with `z.flattenError` details) for non-JSON bodies and schema failures; schemas are `z.strictObject` so unknown fields are rejected. Multipart routes (registration) do not use `parseJsonBody`. Audit writes go through `writeAuditLog({ actorUserId, action, targetType, targetId, details }, client?)` in `src/server/audit.ts`: pass the transaction client to join the running transaction, otherwise the global Prisma client is used; never put passwords, IPs, storage keys or signed URLs in `details`. The donation transition route no longer defines its own error helper. Other routes keep their current shape for now; migrate them to `parseJsonBody` as they are touched |

## 10. Open questions

- Beneficiary group labels and the allowed food categories for individual donors (confirm with the adviser and the beneficiary organization)
- Whether pending accounts may log in with posting locked, or are blocked at login
- Email provider (Resend needs a verified domain; plain SMTP is the fallback) and AI vision provider
- Badge thresholds for achievements
- How to run the expiry job on the free Vercel plan (sprint plan A9: a GitHub Actions workflow every 15 minutes calling a secured endpoint)
- Retention for cleanup (1 day for one-time codes, 90 days for read notifications) and whether Volunteers keep seeing the Donor's phone number after a donation closes
- Wizard order: the System PDF starts the donation wizard with the photo, but a draft needs category, food name and portions to exist, so the draft is created before the photo is attached. Draft creation is a direct insert using the database default DRAFT status; DRAFT to SCREENED is the first lifecycle transition.

## 11. Next up
1. Finish the backend sprint (3 to 16 Nov). Sprint demo on 16 Nov: one donation goes from DRAFT to CLOSED
2. After the sprint, work through the next-sprint list in the Task Tracker (admin screening queue, real AI provider, notifications, incidents, audit log viewer, rate limiter)
3. Auth pages and dashboards with shadcn/ui once the UI/UX designs arrive
4. Open reassignment work: support reassignment for ASSIGNED donations and DELIVERED donations with an unfinished report, preserving assignment history