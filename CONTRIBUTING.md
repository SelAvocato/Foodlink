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
- Shared (tell the team before changing): `src/contracts`, `src/components/ui`, `src/app/globals.css`

## UI conventions
- shadcn/ui components live in `src/components/ui`. Add one with `npx shadcn@latest add <name>` in its own small PR, after pulling `main`, so two people don't add the same component and conflict in `package-lock.json`.
- Use theme classes (`bg-primary`, `text-muted-foreground`, `border`) and never hard-coded colors like `bg-green-600`. Colors, radius and fonts are CSS variables in `src/app/globals.css`, so the UI/UX palette can be applied there later in one change.
- Don't restyle files in `src/components/ui` for a single page. Use variants or wrap the component.