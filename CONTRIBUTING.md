# Contributing

## Workflow
1. Branch off `main`: `git switch -c type/short-name` (for example `feat/donor-dashboard`)
2. Commit small and often.
3. Open a PR into `main`. CI must be green before merging.
4. Never push directly to `main`.

## Commit messages
Format: `type(scope): description`

Types: `feat`, `fix`, `chore`, `ci`, `docs`, `refactor`, `style`, `test`, `build`

Scopes: the area you touched, such as `donor`, `volunteer`, `admin`, `landing`, `auth`, `contracts`, `ui`, `db`, `workflow`

Examples:
- `feat(donor): add donation status timeline`
- `fix(auth): redirect pending users to approval page`
- `ci(workflow): add CI pipeline for lint, typecheck, and build`

Use lowercase, present tense, and no trailing period. The PR title uses the same format.

## Folder ownership
- Frontend: `src/app` (pages), `src/features`, `src/components`, `src/mocks`, `src/lib`, `public`
- Backend: `src/app/api`, `src/server`, `prisma`
- Shared (tell the team before changing): `src/contracts`