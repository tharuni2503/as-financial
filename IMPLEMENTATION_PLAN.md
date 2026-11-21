# IMPLEMENTATION_PLAN — AS Financial Services & Solutions (Upgrade to Production Quality)

**Audit date:** 2026-11-21 (Sat)  
**Auditor:** automated Phase 0 repository audit (no application code modified)  
**Scope:** Full repository inspection and upgrade roadmap (Phases 0–9)

---

## 1. Executive Summary

This is an existing **Node.js/Express + static HTML/CSS/JS** financial services website with optional **PostgreSQL** (Supabase-compatible) or **JSON file** storage, deployed via **Vercel serverless** (`api/index.js` wraps `server/index.js`). The product includes public marketing/loan pages, a guides/calculators experience, enquiry capture APIs, cookie-session admin authentication, admin CRM-like collections, basic uploads, and content publishing.

**Overall:** solid foundation and useful features exist, but the project is **not yet production-ready at 9.5/10**. Key gaps/risks: **critical PostgreSQL TLS verification bypass in code**, **in-memory/persisted-but-local rate limiting not shared across serverless instances**, **ephemeral local upload storage on Vercel**, **admin UI/data model still partially JSON/localStorage-driven with limited CRM workflows**, **no automated test suite**, **working tree has significant uncommitted structural changes (including 6 calculator HTML pages deleted in working dir)**, and several security/UX/performance hardening items remain.

**Phase 0 outcome:** audit complete, findings mapped, risks prioritized, and phase-by-phase implementation plan defined. **No application code changed in this phase** (this document added only).

---

## 2. Repository Inventory & Architecture Map

### 2.1 Top-level structure
- `api/index.js` — Vercel serverless entry; awaits `server.ready()` then delegates to Express app.
- `server/` — backend (Express app, auth, validation, stores, mailer, migration script, SQL migrations, default lender data).
  - `index.js` (large, ~65k): routes, middleware, authz, rate limiting, uploads, static serving, audit logging helpers.
  - `auth.js`: scrypt password hashing/verify, session issue/read/rotate/revoke, CSRF token per session, HttpOnly cookie helpers, login attempt tracking (memory + optional persisted state), reset token helpers.
  - `store.js`: backend selector (`DATABASE_URL`/`POSTGRES_URL` => `store-pg`, else `store-json`).
  - `store-json.js`: JSON datastore (`data/db.json`, backup/atomic writes) implementing async store API.
  - `store-pg.js`: PostgreSQL datastore (`pg` Pool), auto-migrates SQL files, same async API; **contains TLS handling concerns (see risks)**.
  - `validate.js`: request/content/enquiry/admin payload validation and sanitization (`HttpError`, image/data-src rules, lender/content/admin validators).
  - `mailer.js`: optional nodemailer SMTP for password reset; safe fallback/logging when unconfigured.
  - `migrate-json-to-pg.js`: imports `data/db.json` or export snapshot into Postgres (supports `--dry-run`).
  - `migrations/001_init.sql`: initial schema (`app_content`, `app_admin`, `app_meta`, `enquiries`, `users`, `sessions`, `audit_logs`, indexes, seeds/default keys).
  - `default-lenders.json`: default lender seed/content.
- `assets/` — frontend assets.
  - `css/`: `styles.css`, `pro-light.css`, `admin.css`, `lenders.css` (untracked in current working tree).
  - `js/`: `main.js`, `backend.js`, `admin.js`, `admin-sync.js`, `calculators.js` (untracked), `lenders.js` (untracked), `lenders-ui.js` (untracked), `icons.js`.
  - `img/`: site/hero/gallery/poster/brand/lender images (some lender assets untracked).
- HTML pages (tracked in HEAD): `index.html`, `about.html`, `loans.html`, `contact.html`, `guides.html`, `admin.html`, `privacy-policy.html`, `terms-of-use.html`, `404.html`, plus **6 calculator pages present in HEAD but deleted in current working tree**: `emi-calculator.html`, `balance-transfer-calculator.html`, `tenure-calculator.html`, `prepayment-calculator.html`, `buy-vs-rent-calculator.html`, `home-loan-tax-saving-calculator.html`.
- Config/docs: `package.json`, `package-lock.json`, `vercel.json`, `.env.example`, `.gitignore`, `.vercelignore`, `README.md`, `robots.txt`, `sitemap.xml`, `sitemap.xml.bak` (untracked), `favicon.svg`.
- Runtime/local data (gitignored/untracked as applicable): `data/db.json`, `data/db.backup.json`, `data/uploads/` (if created), `.env` (present locally, **not committed**), `node_modules/`.

### 2.2 HTML pages (15 required incl. admin) — current state
| Page | Status (HEAD / working tree) | Notes |
|---|---|---|
| `index.html` | tracked / modified | Home, hero/services/trust/partners/calculator hooks, lender UI, forms/popups, content hydration |
| `about.html` | tracked / modified | Company/about content |
| `loans.html` | tracked / modified | Loan products/details |
| `contact.html` | tracked / modified | Contact/enquiry form(s) |
| `guides.html` | tracked / modified | Guides + consolidated calculators hub (`#calculators` / tabbed calculators) |
| `admin.html` | tracked / modified | Admin dashboard/login/shell/views; heavy client-side UI logic |
| `privacy-policy.html` | tracked / modified | Legal/info |
| `terms-of-use.html` | tracked / modified | Legal/info |
| `404.html` | tracked / modified | Error page |
| `emi-calculator.html` | tracked / **deleted in working tree** | Calculator page removed locally; functionality appears consolidated |
| `balance-transfer-calculator.html` | tracked / **deleted in working tree** | Same |
| `tenure-calculator.html` | tracked / **deleted in working tree** | Same |
| `prepayment-calculator.html` | tracked / **deleted in working tree** | Same |
| `buy-vs-rent-calculator.html` | tracked / **deleted in working tree** | Same |
| `home-loan-tax-saving-calculator.html` | tracked / **deleted in working tree** | Same |

**Audit finding:** total 15 tracked HTML pages exist in HEAD including admin. Current working tree has 9 HTML files and 6 calculator deletions pending; `vercel.json` redirects `/calculators` and `/calculators.html` to `/guides#calculators`, but **preservation of existing pages/URLs requires careful handling** in Phase 1/8.

### 2.3 Frontend assets & integrations
- **CSS:** `assets/css/styles.css`, `assets/css/pro-light.css`, `assets/css/admin.css`, `assets/css/lenders.css` (lenders/admin/pro-light recently modified in worktree). Theme leans navy/gold/cream/ivory.
- **JS (public):** `main.js` (site interactions, forms/lead handling, content fetch/fallback behavior, UI logic), `backend.js` (API client, cookie auth + CSRF header, `available/content/login/logout/session/publish/enquire`), `calculators.js` (tabbed calculators: EMI/affordability/down-payment/BT currently evident), `lenders.js` + `lenders-ui.js` (lender data/rendering), `icons.js`.
- **JS (admin):** `admin.js` (large dashboard SPA-like logic, localStorage-backed state + rendering, auth/session handling integration), `admin-sync.js` (bridges local store keys and backend content/admin collections; pulls/pushes with CSRF/session checks).
- **Patterns:** progressive enhancement/fallback to local/demo data in places; cache-busting query params used in HTML; mixed client/server responsibilities for some admin data.

### 2.4 Backend/API map (Express, `server/index.js`)
**Middleware/infra:** JSON body parsing (large limit configured), request logging, basic CORS/headers behavior in app, static serving from project root, API 404/error handling, cookie parsing/session extraction via `auth.js`, CSRF enforcement on mutating protected routes, async route wrapper, rate limiting maps/helpers (login/enquiry/other buckets with persistence hooks in parts).

**Public/auth/content/enquiry endpoints (observed):**
- `GET /api/health`
- `POST /api/login`, `POST /api/logout`, `GET /api/session`
- `GET /api/content` (optional admin scope), `PUT /api/content/:section` (auth+role+csrf)
- `POST /api/enquiries` (public, rate limited), `GET/PATCH/DELETE /api/enquiries/:id` (auth+role+csrf where applicable)

**Admin/store/CRM endpoints (observed):**
- `GET /api/admin/store`, `PUT /api/admin/store/:name` (auth+role+csrf)
- `GET/POST /api/admin/:collection`, `GET/PATCH/DELETE /api/admin/:collection/:id` (granular CRUD, query filters/pagination in implementation)
- `POST /api/admin/resolve-logo` (auth+role+csrf)
- `POST /api/admin/uploads` (base64 JSON upload, auth+role+csrf), `GET /api/admin/uploads/:file` (auth)

**User/session/security/audit/export endpoints (observed):**
- `POST /api/change-password`, `POST /api/forgot-password`, `POST /api/reset-password`
- `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id`, `POST /api/users/:id/reset-token`, `POST /api/users/:id/revoke-sessions`
- `GET /api/audit`
- `GET /api/sessions`, `POST /api/sessions/revoke-others`, `DELETE /api/sessions/:id`
- `GET /api/admin/export` (super_admin)

**Static/other:** serves HTML/assets; SPA-like behavior not primary except admin app logic; rewrites all routes to `/api` on Vercel (`vercel.json`) so Express handles routing/static fallback.

### 2.5 Authentication, authorization, sessions
- **Password hashing:** Node `crypto.scryptSync` (salted), timing-safe comparison in `auth.js`.
- **Sessions:** random bearer/cookie token + per-session CSRF token; 8h TTL with sliding refresh; stored in memory and optionally persisted through store adapter (`sessions` table / JSON map).
- **Cookies:** HttpOnly, SameSite=Lax, `Secure` conditional by options; cookie name `as_session`.
- **RBAC:** route-level role checks in `server/index.js` (admin/super_admin and some user-management restrictions evident); frontend also enforces admin-only UI behavior in places.
- **Account/security flows:** password change/reset/forgot, session listing/revocation, login attempt limiting, audit logging hooks.

### 2.6 Database/storage/migrations
- **Selector:** `server/store.js` picks Postgres if `DATABASE_URL`/`POSTGRES_URL` else JSON.
- **JSON backend:** `data/db.json` with backup `data/db.backup.json`; collections for content, enquiries, admin CRM arrays/settings, users, sessions, audit, security state.
- **Postgres backend:** `server/store-pg.js` auto-runs SQL files in `server/migrations/`; API-compatible with JSON store.
- **Schema (`001_init.sql`):** key/value JSONB tables (`app_content`, `app_admin`, `app_meta`) plus relational tables for `enquiries`, `users`, `sessions`, `audit_logs` with basic indexes; seeds for content/admin keys and schema version. **No separate relational tables yet** for leads/applications/customers/documents/tasks/notifications/products/partners as first-class normalized entities (many stored in JSONB/admin collections).
- **Migration tooling:** `server/migrate-json-to-pg.js` (`npm run migrate:pg`, `:dry`) maps JSON/export data into store methods.
- **File storage:** uploads handled in backend (base64 payload path) with local filesystem storage under data/uploads when possible; not durable on Vercel. No S3/Supabase Storage integration yet.

### 2.7 Admin features (current)
- Admin login and dashboard UI (`admin.html`, `admin.css`, `admin.js`) with multiple views/sections (overview, leads, applications, customers/products/partners/tasks/settings/content-related areas inferred from code/assets and store collections).
- Backend-backed collections and granular CRUD/search endpoints exist for several entities; `admin-sync.js` syncs localStorage keys with server content/admin stores.
- Export endpoint for super_admin exists (`/api/admin/export`, sanitized).
- Audit/session/user management APIs present.
- **Gap:** CRM depth (assignment workflows, status history, notifications delivery, permissions granularity, real analytics/reporting, CSV exports, customer portal separation) is incomplete/inconsistent vs Phase 5/6 requirements.

### 2.8 Vercel/deployment configuration
- `vercel.json`: `trailingSlash: false`, redirects calculators -> `/guides#calculators`, rewrite `/(.*)` -> `/api` (all traffic handled by serverless Express).
- `api/index.js`: wraps server for Vercel runtime.
- `.vercelignore` present; `.vercel/` ignored.
- `robots.txt` allows crawl except `/admin.html`, `/admin`; sitemap/robots/canonicals point to `https://as-financial-services-psi.vercel.app/`.
- **Operational note:** durable DB and object storage required for production; filesystem-based JSON/uploads not reliable on serverless.

### 2.9 Dependencies & tooling
- **Runtime deps (`package.json`):** `express@^4.19.2`, `nodemailer@^6.9.16`, `pg@^8.13.1`.
- **Node:** `>=18`.
- **Scripts:** `start`, `dev` (`node --watch`), `migrate:pg`, `migrate:pg:dry`.
- **Tests/lint/format/CI:** no `test` script, no test framework config, no ESLint/Prettier/CI workflows found in repo root.
- **`package-lock.json`:** present (npm lockfile v2/v3 style content in repo).

---

## 3. Frontend ↔ Backend API Integration Map

| Frontend area/file | Backend/API used | Purpose | Notes/Risks |
|---|---|---|---|
| `assets/js/backend.js` | `/api/health`, `/api/login`, `/api/logout`, `/api/session`, `/api/content`, `/api/content/:section`, `/api/enquiries` | Shared client, cookie auth + CSRF, publish/enquiry helpers | Soft-fail fallback to local/demo behavior in some flows |
| `assets/js/admin-sync.js` | `/api/content?scope=admin` (indirect), `/api/admin/store`, `/api/admin/store/:name` | Sync published content and admin collections (localStorage keys <-> server) | Conflict/merge semantics basic; depends on session/CSRF |
| `assets/js/admin.js` | session/auth flows via backend client + direct API usage patterns, admin CRUD/export/user/session/audit endpoints (implementation-dependent) | Admin dashboard UI, auth gating, data management | Large monolithic script; mixed local/server state; must preserve functionality while hardening |
| `assets/js/main.js` | backend enquiry/content hooks (where available), localStorage fallbacks | Public UX, forms, calculators/content rendering behaviors | Some features may degrade to local-only without backend |
| `assets/js/lenders-ui.js` | `/api/content` fetch observed | Render lender/partner content | Depends on content shape and availability |
| `assets/js/calculators.js` | none (client-side math/UI) | Tabbed calculators on guides/home contexts | 4 calculator modes visible; must verify coverage vs “six financial calculators” requirement |
| Public HTML forms (index/contact/loans etc.) | typically `POST /api/enquiries` via JS | Lead/enquiry capture | Honeypot/rate limit exist; UX/validation/a11y hardening needed |
| Vercel routing | all HTTP paths rewritten to `/api` entry | Unified server/static handling in deployment | Must preserve compatibility during refactors |

---

## 4. Issues, Risks, and Gaps (Prioritized)

### 4.1 Critical / High (security, data integrity, deployment correctness)
1. **Postgres TLS verification bypass risk (`server/store-pg.js`)**  
   - Sets `NODE_TLS_REJECT_UNAUTHORIZED='0'` for non-verify SSL modes/Supabase scenarios and/or relaxes verification to keep connections working.  
   - **Risk:** weakens TLS certificate validation globally in-process; unacceptable for production security posture. Must implement correct SSL verification/CA handling per environment.
2. **Rate limiting not robust for production/serverless**  
   - Login/enquiry/other throttling uses in-memory maps with partial persistence concepts; not a shared distributed limiter across Vercel instances/cold starts.  
   - **Risk:** bypassable/ineffective at scale and inconsistent enforcement.
3. **Ephemeral local uploads / file handling**  
   - `POST /api/admin/uploads` stores files under local `data/uploads` when possible (base64 JSON upload flow). Vercel filesystem is not durable.  
   - **Risk:** data loss in production; missing private object storage, signed URLs, malware scanning, strong file signature enforcement pipeline.
4. **Large/complex security surface in monolithic server (`server/index.js`)**  
   - Many responsibilities in one file (auth, RBAC, CRUD, uploads, exports, static serving, logging). Harder to audit and safely change.  
   - **Risk:** authorization gaps/regressions during edits; needs careful hardening and tests.
5. **Data model not fully normalized for CRM entities**  
   - Many admin entities live in JSON/JSONB collections (`app_admin`) rather than relational tables with FKs/constraints/history.  
   - **Risk:** weak integrity, difficult reporting/auditing/status history/permissions enforcement at scale.

### 4.2 Medium (functional correctness, maintainability, UX/compliance)
6. **Uncommitted working tree / structural drift**  
   - Modified pages/assets/server files; **6 calculator HTML pages deleted in working tree** (still in HEAD); untracked lender/calculator assets and `sitemap.xml.bak`; local `.env` present.  
   - **Risk:** accidental loss/regression, deployment mismatch, broken links/SEO if deletions committed without replacements/redirects; must preserve pages/features unless technically justified.
7. **Calculator consolidation vs requirements**  
   - `guides.html` includes tabbed calculators and `assets/js/calculators.js` implements 4 modes (EMI, affordability, down-payment, BT). Requirement states “improve all existing loan pages and **six financial calculators**”.  
   - **Risk:** feature/URL parity gap if standalone pages removed or calculators incomplete.
8. **Admin depends on localStorage sync patterns**  
   - `admin-sync.js` and `admin.js` mix server-backed and browser-local data flows.  
   - **Risk:** stale/conflicting state, confusing behavior, harder permission enforcement and auditability.
9. **Validation/sanitization coverage uneven by endpoint**  
   - `validate.js` is strong in areas (content/images/enquiry/admin shapes) but full API-wide schema validation, consistent error mapping, and strict upload/file-signature checks need review/expansion.
10. **Session/cookie/CSRF hardening details to verify in production mode**  
   - SameSite/HttpOnly used; Secure flag conditional; CSRF required for many mutations. Needs consistent production enforcement, origin/host checks as appropriate, and robust session lifecycle controls.
11. **Potential exposure of sensitive operational info/logging**  
   - Need to verify no stack traces/credential leakage in API responses/logs across all error paths; audit logging exists but should be reviewed for sensitive data minimization.

### 4.3 Low / Quality (performance, SEO, accessibility, docs)
12. **No automated tests** (unit/integration/e2e/accessibility/security checks) and no CI config.
13. **SEO/perf/accessibility not fully verified**  
   - Canonicals/sitemap/robots/meta exist partially; Lighthouse/Core Web Vitals, structured data completeness, image optimization/caching strategy, and responsive/a11y verification (320–1920 incl. admin) not evidenced.
14. **Duplicated/large frontend scripts and CSS**  
   - Large files (`main.js`, `admin.js`, multiple CSS bundles) increase regression risk and maintenance cost; opportunity for careful modularization without rewrite.
15. **`.env` not ignored by `.gitignore`** (repo-level)  
   - Local `.env` exists and is untracked; risk of accidental staging/commit by future operations. Must never commit secrets.

### 4.4 “Broken/uncertain” items requiring runtime verification
- End-to-end admin login/session/role enforcement against configured backend (local and/or deployed).
- Enquiry submission -> storage -> admin visibility/notification flow in current environment.
- Supabase/Postgres connectivity and migration status from this machine (previous attempt in conversation context failed due DNS/network; not re-run in this audit).
- File upload/download behavior in serverless deployment (expected to be unreliable without object storage).
- All 15 pages responsiveness and calculator correctness after recent uncommitted UI consolidation changes.

---

## 5. Missing Tests & Verification Gaps
- **No test directories/files or scripts** for: API routes, auth/RBAC/CSRF, validation, store adapters (JSON/Postgres), migrations, enquiry/admin CRUD, uploads, calculators, or UI flows.
- **No Playwright/Vitest/Node test runner setup.**
- **No automated accessibility/security scans** configured.
- **No migration verification/backup-restore procedure** documented as executable/validated steps (migration script exists, but verification workflow incomplete).
- **Manual verification required (later phases):** responsive matrix (320/375/425/768/1024/1440/1920) for all 15 pages incl. admin, keyboard navigation, Lighthouse/Core Web Vitals, production env checks, and rollback plan.

---

## 6. Duplicated / Risky Code Patterns (to refactor carefully)
- Overlapping content/admin sync logic between `admin.js` and `admin-sync.js` plus localStorage/server reconciliation.
- Monolithic route/controller logic in `server/index.js` (validation, authz, persistence, response shaping intermixed).
- Parallel JSON/PG store implementations must remain behavior-compatible; risk of drift.
- Repeated UI patterns/styles across multiple CSS files; potential inconsistent components/states.
- Calculator/form logic duplicated historically across pages/scripts (partially consolidated now; verify parity).

---

## 7. Git & Workspace State (Checkpoint Context)

- **Branch:** `main` (up to date with `origin/main` per audit context)  
- **HEAD:** `bb64082 Revert "Upgrade full frontend..."`  
- **Working tree:** **dirty** (many modified tracked files; 6 calculator HTML files deleted in working tree; untracked files including `assets/css/lenders.css`, `assets/img/lenders/`, `assets/js/calculators.js`, `assets/js/lenders-ui.js`, `assets/js/lenders.js`, `server/default-lenders.json`, `sitemap.xml.bak`, `.env`)
- **Sensitive/local:** `.env` exists locally and is **not listed in `.gitignore`**; `data/` is gitignored (contains local `db.json`, `db.backup.json`).
- **Checkpoint requirement:** establish a Git checkpoint before making upgrade code changes. **Action in this phase:** create a safe checkpoint commit containing this audit plan (no secrets added). Existing uncommitted work remains in the working tree and must be preserved/reconciled carefully in subsequent phases.

---

## 8. Phase-by-Phase Tasks (Implementation Roadmap)

### Phase 0 — Repository Audit (**COMPLETED: audit + plan; checkpoint to be recorded**)
**Goal:** understand system, risks, and safe change plan without altering app behavior.
- [x] Inspect repository structure, pages/assets/server/db/deployment/config/deps.
- [x] Map frontend-backend integrations and API surface.
- [x] Identify broken/uncertain features, security risks, duplication, and missing tests.
- [x] Create `IMPLEMENTATION_PLAN.md` with findings, affected files, risks, and phased tasks.
- [x] Establish Git checkpoint before code changes (safe commit of audit artifact; preserve existing working tree).
- **DoD:** audit documented; no application code modified.

### Phase 1 — Premium Frontend (design system + UI upgrades, no feature removal)
**Primary areas/files (expected):** `assets/css/styles.css`, `assets/css/pro-light.css`, `assets/css/lenders.css`, `assets/css/admin.css` (shared tokens/components where safe), `index.html`, `about.html`, `loans.html`, `contact.html`, `guides.html`, calculator pages/experience, `assets/js/main.js`, `assets/js/calculators.js`, `assets/js/lenders-ui.js`, shared header/footer/nav components in HTML.
- Audit current brand/components and define/align premium navy-gold-ivory design tokens (typography, spacing, grids, buttons, cards, forms, nav/footer/breadcrumbs/modals/loading/error states).
- Upgrade homepage (hero, services, trust, EMI/calculator entry, partner presentation, FAQs, footer) and all existing loan pages + **six calculators** with polished, accessible, performant interactions.
- Preserve all existing content/functionality/URLs where required; resolve calculator-page deletion/consolidation safely (restore pages or provide equivalent preserved routes/redirects/content without breaking links/SEO).
- Add subtle transitions/animations respecting reduced motion and performance budgets.
- **Tests/checks:** visual/manual responsive pass (initial), syntax checks, console/accessibility smoke checks.
- **DoD:** cohesive premium UI, no regressions, preserved functionality/content, plan updated.

### Phase 2 — Responsive Design & Accessibility Verification (all 15 pages incl. admin)
**Primary areas/files:** all HTML pages, global/component CSS, admin CSS/JS layout behaviors.
- Test/fix at **320, 375, 425, 768, 1024, 1440, 1920**: overflow, overlap, nav, forms, calculators, tables, modals, typography, touch targets.
- Verify keyboard navigation, focus management, semantics/labels, contrast basics, and accessible states.
- Capture evidence (notes/screenshots/logs as feasible in repo docs) and fix issues found.
- **DoD:** verified responsive/a11y behavior across required breakpoints/pages (no untested claims).

### Phase 3 — Backend & Security Hardening
**Primary areas/files:** `server/index.js`, `server/auth.js`, `server/validate.js`, `server/store-pg.js`, `server/store.js`, `server/mailer.js`, `api/index.js`, `vercel.json`/headers config as needed, `.env.example` (documentation only, no secrets).
- Harden Express APIs: strict validation, safe errors (no stack traces/credentials), request size limits, logging hygiene, parameterized SQL everywhere.
- **Remove global TLS cert verification bypass** in `server/store-pg.js`; implement correct PostgreSQL SSL verification/CA configuration by environment (document required env vars).
- Review/retain secure scrypt hashing (params/cost review) and password/session/reset flows; enforce secure HttpOnly/SameSite/Secure cookies in production.
- Enforce server-side RBAC/permissions on every protected endpoint; harden CSRF/session expiration/rotation/revocation.
- Replace in-memory-only rate limiting with shared/persistent deployment-suitable approach (documented/configurable); add security headers and suitable CSP.
- Secure uploads metadata/handling baseline (validation hooks) pending Phase 7 storage migration.
- **DoD:** security-critical fixes implemented and tested, documented config requirements.

### Phase 4 — PostgreSQL Schema, Migrations, Data Safety
**Primary areas/files:** `server/migrations/*.sql` (new reversible migrations), `server/store-pg.js`, `server/store-json.js`, `server/migrate-json-to-pg.js`, backup/restore docs/scripts.
- Review existing schema/data usage; design non-destructive, reversible improvements.
- Add/adjust relational structures, FKs, constraints, indexes, timestamps, transactions for customers/leads/applications/documents/tasks/users/sessions/notifications/audit logs where appropriate; retain JSONB where genuinely useful.
- Implement pagination/safe query patterns and data-preserving migration/verification; create backup and restoration procedures.
- Keep JSON backend compatibility where feasible during transition or clearly define supported modes.
- **DoD:** migrations verified, data preserved, rollback/restore path documented.

### Phase 5 — Admin CRM Upgrade (real, permissioned, DB-backed)
**Primary areas/files:** `admin.html`, `assets/js/admin.js`, `assets/js/admin-sync.js`, `assets/css/admin.css`, `server/index.js`, store adapters, migrations/models as needed.
- Deliver DB-backed analytics and CRM workflows: lead management/assignment, customer profiles, application tracking, status history, staff management/permissions, follow-up tasks, notifications, search/filters, CSV exports, useful charts/reporting.
- Distinguish internal application status from actual lender approval; no hardcoded stats/fake data.
- Enforce permissions on every API endpoint and align UI capabilities accordingly.
- **DoD:** functional CRM features backed by real data with RBAC and tests.

### Phase 6 — Customer Portal (separate, secure)
**Primary areas/files:** new/updated customer-facing HTML/CSS/JS pages, backend auth/routes/controllers, stores/migrations, integration points with existing enquiry forms.
- Secure registration/login/profile, enquiry submission, application tracking, document upload/download, notifications.
- Strict data isolation (customers access only own records), separate customer/staff authorization, private document access auditing.
- Integrate without breaking current public enquiry flows.
- **DoD:** secure portal flows working end-to-end with authorization and audit coverage.

### Phase 7 — Persistent Private File/Object Storage
**Primary areas/files:** storage abstraction/module, `server/index.js` upload/download endpoints, `server/validate.js`/file checks, DB metadata tables/migrations, config/docs.
- Replace production dependence on ephemeral local uploads with private Supabase Storage or suitable object storage.
- Store metadata in PostgreSQL; enforce MIME + file-signature validation, size limits, secure filenames, private buckets, short-lived signed URLs, access control, audit logging.
- Add malware scanning where feasible; keep local development support/fallback.
- **DoD:** durable, private, audited file handling in production-ready configuration.

### Phase 8 — SEO & Performance
**Primary areas/files:** all public/admin-relevant HTML meta, `sitemap.xml`, `robots.txt`, structured data blocks, image/assets pipeline refs, CSS/JS loading, caching headers/config.
- Improve unique titles/descriptions/canonicals/OG/Twitter/meta, structured data, internal links, alt text, useful location/service pages (accurate only).
- Optimize images/lazy loading/CSS/JS/caching; run Lighthouse/Core Web Vitals checks and fix high-impact issues.
- Ensure business details/claims are accurate and compliant (no implied regulated lending authorization without evidence).
- **DoD:** measurable SEO/perf/accessibility improvements with verified results.

### Phase 9 — Testing, Security Checks & Deployment Verification
**Primary areas/files:** `package.json` scripts, test configs/directories (e.g. `tests/`, `e2e/`), CI config (if added), deployment/env docs.
- Add automated tests (Node test runner or Vitest; Playwright for E2E): public pages, calculators, APIs, auth/authz/CRUD, migrations, uploads, admin ops, mobile layouts.
- Run relevant security checks/tools; verify env vars, DB connectivity, migrations, domain, email, monitoring, backups, rollback; preserve Vercel compatibility unless proven limitation.
- **DoD:** repeatable test suite and documented, verified deployment readiness.

---

## 9. Affected Files / Areas by Theme (Quick Reference)

- **Frontend pages:** `index.html`, `about.html`, `loans.html`, `contact.html`, `guides.html`, `privacy-policy.html`, `terms-of-use.html`, `404.html`, `admin.html`, and 6 calculator pages (HEAD/deleted-in-worktree reconciliation).
- **Frontend assets:** `assets/css/*.css`, `assets/js/main.js`, `assets/js/backend.js`, `assets/js/admin.js`, `assets/js/admin-sync.js`, `assets/js/calculators.js`, `assets/js/lenders*.js`, `assets/js/icons.js`, `assets/img/**`.
- **Backend:** `api/index.js`, `server/index.js`, `server/auth.js`, `server/validate.js`, `server/mailer.js`, `server/store.js`, `server/store-json.js`, `server/store-pg.js`, `server/migrate-json-to-pg.js`, `server/default-lenders.json`.
- **Database:** `server/migrations/001_init.sql` (+ future migrations), `data/db.json` (local/dev only), migration/backup procedures.
- **Config/deploy/docs:** `package.json`, `vercel.json`, `.vercelignore`, `.env.example`, `README.md`, `robots.txt`, `sitemap.xml`, `.gitignore` (safety improvements later if appropriate).

---

## 10. Phase 0 Completion Notes

- **What was done:** full repository audit, architecture/API mapping, risk/test-gap analysis, and creation of this implementation plan.
- **Code modified:** none (documentation-only addition: `IMPLEMENTATION_PLAN.md`).
- **Checkpoint:** to be established via a Git commit containing this plan before any application code changes (without staging secrets such as `.env`).
- **Immediate next step (Phase 1 continuation):** proceed with incremental premium frontend upgrades (design system tokens/components, homepage/loan pages/guides polish, calculator UX/accessibility improvements, header/footer/nav consistency across all pages including restored calculator pages) while preserving all content/functionality/URLs. Verify each increment with relevant checks before expanding scope.

**Important constraints reaffirmed:** preserve architecture unless technically required; no rebuild from scratch; no removal of existing pages/features/endpoints/admin/DB records; no fake data/simulated success; no destructive migrations; no secrets committed; verify before claiming completion.

---

## 11. Progress Log

### Phase 1 — Increment 1 (started 2026-11-21): Restore & preserve calculator pages (parity/safety)
**Existing implementation/problem (frontend):** The working tree had **6 existing calculator HTML pages deleted** (`emi-calculator.html`, `balance-transfer-calculator.html`, `tenure-calculator.html`, `prepayment-calculator.html`, `buy-vs-rent-calculator.html`, `home-loan-tax-saving-calculator.html`) while calculators were being consolidated into `guides.html`/`assets/js/calculators.js`. This risked breaking direct URLs, navigation/history, and the “do not remove existing pages/features/calculators” requirement. Restored pages also referenced older asset versions.

**Exact files changed (this increment):**
- `emi-calculator.html` (restored from HEAD; preserved and asset-version aligned)
- `balance-transfer-calculator.html` (restored from HEAD; UI shell normalized, asset-version aligned)
- `tenure-calculator.html` (restored from HEAD; UI shell normalized, asset-version aligned)
- `prepayment-calculator.html` (restored from HEAD; UI shell normalized, asset-version aligned)
- `buy-vs-rent-calculator.html` (restored from HEAD; UI shell normalized, asset-version aligned)
- `home-loan-tax-saving-calculator.html` (restored from HEAD; UI shell normalized, asset-version aligned)
- `sitemap.xml` (added preserved calculator page URLs)
- `IMPLEMENTATION_PLAN.md` (progress update)

**Implementation completed:**
- Restored all 6 calculator pages from `HEAD` to preserve existing pages/URLs and calculator functionality (including existing page-specific calculator scripts/markup).
- Updated CSS/JS asset references on restored pages to current site versions (`styles.css`, `pro-light.css`, `icons.js`, `backend.js`, `main.js` -> `?v=20261120z40`).
- Normalized topbar/header/mobile-nav/footer shell for 5 calculator pages (`balance-transfer`, `tenure`, `prepayment`, `buy-vs-rent`, `home-loan-tax-saving`) for better consistency with the current site while keeping each page’s main calculator content and inline scripts intact.
- Added the 6 calculator URLs to `sitemap.xml`.
- **Correction:** an intermediate automated shell rewrite corrupted `emi-calculator.html`; it was recovered by restoring from `HEAD` and reapplying safe asset-version updates (page preserved, no calculator logic removed).

**Checks/tests run:** sanity-verified asset version strings and presence of key calculator/result/script elements in restored/updated pages; checked for closing `script/body/html` tags in modified calculator pages; reviewed `git status`. **Not yet run:** in-browser/manual functional verification for all 6 calculators, responsive checks (320–1920), keyboard/a11y checks, console/network validation, Lighthouse, or automated tests.

**Status/remaining risks:** calculator pages/URLs are preserved and structurally improved, but full premium UI parity, deeper calculator UX/accessibility refinements, cross-page consistency with the latest working-tree designs (`index/loans/guides/contact/admin`), and behavioral verification across all six calculators remain. Existing unrelated working-tree changes (admin/server/frontend/lender assets, other page edits) remain and must be handled carefully. No backend/security/database logic changed in this increment.

### Phase 1 — Increment 2 (2026-11-21): Calculator parity/navigation & accessibility polish
**Existing implementation/problem:** `emi-calculator.html` remained on an older shell after recovery; `guides.html#calculators` exposed only 4 tabbed tools and did not clearly surface all 6 standalone calculators; some calculator result regions lacked explicit live-region announcements.

**Exact files changed (this increment):**
- `emi-calculator.html` (aligned topbar/header/mobile-nav shell with other calculator pages; preserved main calculator content, popup, and scripts)
- `guides.html` (added “All calculator tools” links/grid to all 6 standalone calculators in the calculators section)
- `tenure-calculator.html` (added `aria-live="polite"` to result box)
- `prepayment-calculator.html` (added `aria-live="polite"` to result box)
- `buy-vs-rent-calculator.html` (added `aria-live="polite"` to result box)
- `home-loan-tax-saving-calculator.html` (added `aria-live="polite"` to result box)
- `IMPLEMENTATION_PLAN.md` (progress update)

**Implementation completed:**
- Normalized `emi-calculator.html` pre-main chrome to match the current calculator shell while preserving its calculator UI, presets, popup form, and inline scripts.
- Added direct links on `guides.html#calculators` to all six standalone calculators (EMI, Balance Transfer, Tenure, Prepayment, Buy vs Rent, Home Loan Tax Saving) for parity and discoverability.
- Added `aria-live="polite"` to result containers on calculator pages where missing to improve assistive feedback when values update.

**Checks/tests run:** verified key elements remain present (`emi-calculator`: calculator layout/presets/popup/scripts; `guides`: all 6 calculator links present). **Not yet run:** in-browser interaction testing for all calculators, responsive breakpoints (320–1920), keyboard-only navigation, screen reader verification, console/network checks, Lighthouse, or automated tests.

**Status/remaining risks:** navigation/parity improved, but full calculator behavior/accuracy UX review (including edge cases and consistency of disclaimers/labels across all 6 + guides hub), premium visual refinement of calculator pages, and verified responsiveness/accessibility remain pending. No backend/security/database logic changed. No commit created for this increment yet.

### Phase 1 — Increment 3 (2026-11-21): Calculator UX/edge-case consistency pass
**Existing implementation/problem:** Standalone calculator pages had minor UX/a11y inconsistencies (missing live-region announcements on some result boxes) and the prepayment calculator did not clearly handle edge cases such as full repayment via part-payment or EMI insufficient to reduce principal after prepayment.

**Exact files changed (this increment):**
- `prepayment-calculator.html` (improved inline calculator logic for edge cases: full repayment, infeasible EMI after prepayment, guarded months/rates; result messaging)
- `tenure-calculator.html` (result box `aria-live="polite"` already applied in increment 2; verified)
- `buy-vs-rent-calculator.html` (result box `aria-live="polite"` already applied in increment 2; verified)
- `home-loan-tax-saving-calculator.html` (result box `aria-live="polite"` already applied in increment 2; verified)
- `guides.html` (all 6 standalone calculator links present in hub; verified)
- `index.html` (homepage calculator entry points reviewed; no code change required in this increment)
- `IMPLEMENTATION_PLAN.md` (progress update)

**Implementation completed:**
- Hardened `prepayment-calculator.html` calculation logic: clamps/rounds inputs, handles zero remaining balance as “Fully repaid”, detects infeasible scenarios where EMI cannot cover interest on the post-prepayment balance, and avoids misleading tenure/savings outputs in those cases.
- Confirmed calculator discoverability/parity touchpoints: `guides.html#calculators` links to all 6 standalone calculators; standalone pages include “More tools” navigation and indicative disclaimers/notes.
- Performed code-level sanity check on updated prepayment inline script (`node` syntax parse passed).

**Checks/tests run:** inline JS syntax check for updated prepayment script (`prepayment script syntax ok`); static/code inspections of calculator pages and hub links. **Not run:** browser/manual interaction testing across all 6 calculators and `guides.html` tabs, responsive breakpoint verification (320–1920), keyboard/screen-reader testing, console/network checks, Lighthouse, or automated tests.

**Status/remaining risks:** calculator logic/UX is improved for identified edge cases, but full visual premium polish, cross-page consistency with the latest working-tree UI, and verified behavior on real devices/browsers remain pending. No backend/security/database logic changed. No commit created for this increment yet.

### Phase 1 — Increment 4 (2026-11-21): Calculator consistency, navigation, and encoding fixes
**Existing implementation/problem:** `emi-calculator.html` contained mojibake characters (`Γé╣/ΓÇö/ΓÇô`) in user-visible content/labels; calculator pages had inconsistent/incomplete “More tools” navigation; EMI page lacked direct links to other standalone calculators.

**Exact files changed (this increment):**
- `emi-calculator.html` (fixed mojibake `₹/—/–` characters; added “More tools” section linking to other 5 calculators before CTA)
- `balance-transfer-calculator.html` (standardized “More tools” section to include all 5 other calculators)
- `tenure-calculator.html` (standardized “More tools” section)
- `prepayment-calculator.html` (standardized “More tools” section)
- `buy-vs-rent-calculator.html` (standardized “More tools” section)
- `home-loan-tax-saving-calculator.html` (standardized “More tools” section)
- `IMPLEMENTATION_PLAN.md` (progress update)

**Implementation completed:**
- Repaired encoding/mojibake in `emi-calculator.html` so currency and dash characters render correctly.
- Standardized calculator cross-navigation: each of the 6 standalone calculator pages now provides links to the other 5 calculators (and “View all calculators” where applicable), improving parity and discoverability.
- Preserved calculator logic, form fields, URLs, and unrelated page content; no backend/security/database changes.

**Checks/tests run:**
- Node-based file verification for `emi-calculator.html` mojibake removal (gamma-char count reduced to 0).
- HTTP smoke checks against running local server (`http://localhost:3000`, PID `16588`): `GET /`, all 6 calculator pages, and `/guides.html` returned `200`; `emi-calculator.html` response contained “More tools” and no mojibake marker string.
- Prior checks still valid for this session: `node --check` passed for key JS files; prepayment inline script syntax check passed in increment 3.
- **Not run:** in-browser/manual interaction testing for all calculator flows, responsive breakpoint verification (320–1920, all 15 pages incl. admin), keyboard/screen-reader testing, console/network checks, Lighthouse/Core Web Vitals, or automated tests.

**Status/remaining risks:** calculator discoverability/consistency improved, but full premium visual refinement across calculators and other public pages (`index`, `loans`, `guides`, `contact`, `about`, etc.), comprehensive calculator behavior QA, and responsive/a11y verification remain pending. `emi-calculator.html` still uses a different layout/footer pattern than the simpler calculator pages (intentional but visually divergent). Working tree remains dirty with many pre-existing uncommitted changes plus Phase 1 edits; `.env` untracked and must not be committed. No commit created for this increment yet. Dev server still running (PID `16588`) on `http://localhost:3000`.

### Phase 1 — Increment 5 (2026-11-21): Browser functional verification (calculator flows)
**Existing implementation/problem:** Phase 1 calculator changes (navigation, mojibake fixes, prepayment edge-case handling) had only HTTP/syntax/static checks; interactive calculator behavior and console health needed in-browser verification.

**Exact files changed (this increment):**
- `IMPLEMENTATION_PLAN.md` (progress update only)

**Verification performed (local, `http://localhost:3000`, existing server PID `16588`):**
- **EMI (`/emi-calculator.html`):** inputs updated via sliders/events produced expected outputs (e.g. ₹43,391 EMI for ₹50,00,000/8.5%/20y in tested case), “More tools” section present, no mojibake marker detected, no console errors.
- **Balance Transfer (`/balance-transfer-calculator.html`):** outputs recalculated correctly for tested inputs; “More tools” links to all 5 other calculators present; no console errors.
- **Prepayment (`/prepayment-calculator.html`):** normal case, full-repayment case (“Fully repaid”, balance ₹0, reduced tenure shown), and additional high-rate/large-prepay case computed expected values; “More tools” links complete; no console errors.
- **Tenure (`/tenure-calculator.html`):** normal and not-feasible cases behaved correctly (“Not feasible” with dashes for totals/interest); “More tools” links complete; no console errors.
- **Buy vs Rent (`/buy-vs-rent-calculator.html`):** EMI/buy/rent/difference outputs computed; “More tools” links complete; no console errors.
- **Home Loan Tax Saving (`/home-loan-tax-saving-calculator.html`):** component and total savings outputs computed; “More tools” links complete; no console errors.
- **Guides (`/guides.html`):** calculator tabs present and “Open a dedicated calculator” / dedicated links to all 6 standalone calculators present; no console errors observed in tested load.

**Checks/tests run:** in-app browser open/wait/evaluate/console checks for pages above. **Not run:** responsive breakpoint verification across 320–1920 (no viewport-resize control in this verification pass), keyboard-only/screen-reader testing, full interaction across all homepage/guides tab states and forms, network/API submission flows, Lighthouse/Core Web Vitals, or automated tests.

**Status/remaining risks:** calculator flows are functionally healthier and verified for key scenarios, but visual polish on non-calculator public pages, full responsive/a11y QA (all 15 pages incl. admin), and Phases 2–9 remain pending. No app code changes in this increment. No commit created. Dev server still running (PID `16588`).

### Phase 3 — Increment 1 (2026-11-21): Critical backend security hardening (partial)
**Existing implementation/problem:** `server/store-pg.js` disabled TLS certificate verification globally (`NODE_TLS_REJECT_UNAUTHORIZED='0'`) for Supabase/managed Postgres compatibility; API security headers were minimal; no global API rate limit; no automated smoke tests.

**Exact files changed (this increment):**
- `server/store-pg.js` (removed global `NODE_TLS_REJECT_UNAUTHORIZED` override; scoped TLS relaxation to pg pool `ssl` config; added strict-verify support via `AS_PG_SSL_VERIFY=1`/`PGSSLMODE=verify-full` and optional CA via `PGSSLROOTCERT`/`AS_PG_SSL_CA`; warning logged when relaxed verification is used)
- `server/index.js` (added `Strict-Transport-Security` on secure/prod requests, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, transitional `Content-Security-Policy`; added simple in-memory global API rate limit per IP, configurable via `AS_API_RATE_LIMIT`, default 300 req/5 min)
- `package.json` (added `test` script: `node --test tests/smoke.test.js`)
- `tests/smoke.test.js` (new smoke tests: critical files exist, sitemap includes 6 calculators, validate/auth API smoke, store-pg TLS-bypass regression check)
- `IMPLEMENTATION_PLAN.md` (progress update)

**Checks/tests run:**
- `node --check server/index.js server/store-pg.js server/auth.js server/validate.js tests/smoke.test.js` — passed.
- `node --test tests/smoke.test.js` — **5/5 passed**.
- Prior Phase 1 browser functional calculator checks and HTTP smoke checks remain valid for UI pages already verified; server process PID `16588` is still running old in-memory code and must be restarted to pick up backend security changes.

**Status/remaining risks:**
- Critical global TLS bypass removed from code; managed Postgres deployments should be verified with real credentials. For strict verification set `AS_PG_SSL_VERIFY=1` and provide CA cert (`PGSSLROOTCERT`/`AS_PG_SSL_CA`).
- CSP is transitional (`'unsafe-inline'` for scripts/styles) because the site currently uses inline scripts/styles; tighten by migrating to nonces/hashes/external files.
- API rate limit is in-memory per process; for Vercel/serverless multi-instance production, move to shared persistent rate limiting (Redis/KV/Upstash or platform edge rules) before treating as strong abuse protection.
- Still pending in Phase 3+: auth/session hardening review, CSRF coverage audit across all mutating endpoints, upload hardening/AV/object storage, audit logging completeness, dependency audit, and end-to-end security regression tests.

## Phase 1 Security (new plan) — Status Report (2026-11-21)

### Baseline / audit
- Git checkpoint exists: `3bff403` (`docs: add Phase 0 repository audit and implementation plan`). Working tree is dirty with prior and current incremental changes; `.env` is untracked and now ignored by `.gitignore`.
- Rechecked reported findings: TLS global bypass previously present in code (fixed in earlier increment); `rejectUnauthorized:false` fallback still existed (now production-blocked); plaintext reset tokens in DB/store flow (now hashed); mailer Host-header reset URL fallback (removed); in-memory rate-limit maps (partially mitigated by DB-backed security state persistence, debounced); no test script (added smoke tests); sitemap uses `https://as-financial-services-psi.vercel.app/` (verify/replace with actual production domain); canonical/og:image present on many public pages but missing on standalone calculator pages (and admin should remain noindex).

### Implemented (this Phase 1 security pass)
- **Postgres TLS (prod-enforced):** `server/store-pg.js` no longer sets `NODE_TLS_REJECT_UNAUTHORIZED`. In `NODE_ENV=production`, startup fails with clear config error unless strict TLS verification is configured (`AS_PG_SSL_VERIFY=1` / `PGSSLMODE=verify-full` and optional `PGSSLROOTCERT`/`AS_PG_SSL_CA`). Dev-only relaxed fallback allowed only outside production with warning.
- **Password reset tokens hashed:** `server/auth.js` adds `hashResetToken` (SHA-256) and returns `tokenHash`; raw token is sent only once in reset link. `server/store-pg.js` and `server/store-json.js` lookup by hashed token. `server/index.js` stores only hash, does not expose raw reset token/URL in production responses, and no longer logs reset URL/token.
- **Reset URL trust:** `server/mailer.js` `absoluteResetUrl` now requires configured `APP_URL` (trusted origin) and never uses request Host headers. If APP_URL missing, URL generation returns empty.
- **Security headers:** `server/index.js` adds HSTS (secure/prod), COOP, CORP, transitional CSP, existing nosniff/referrer/frame/permissions headers.
- **Rate limiting/shared state:** added global API rate limit (in-memory + debounced persistence to `store.security_state`); enquiry/pw/api buckets serialized/pruned with format-safe helpers. Sessions persist via DB-backed session store when configured.
- **Dependencies:** upgraded `nodemailer` to `10.6.1` to address npm audit findings; `npm audit --omit=dev` reports 0 vulnerabilities after upgrade.
- **Smoke tests:** `tests/smoke.test.js` (5 tests) covers critical files, sitemap calculator coverage, validate/auth API smoke, and store-pg TLS bypass regression.

### Files changed (Phase 1 security-focused)
- `server/store-pg.js`, `server/auth.js`, `server/store-json.js`, `server/mailer.js`, `server/index.js`, `package.json`, `package-lock.json`, `tests/smoke.test.js`, `.gitignore`, `IMPLEMENTATION_PLAN.md`

### Checks/tests run
- `node --check` pass: `server/index.js`, `server/auth.js`, `server/store-pg.js`, `server/store-json.js`, `server/mailer.js`, `server/validate.js`, `tests/smoke.test.js`
- `node --test tests/smoke.test.js` — **5/5 pass**
- `npm audit --omit=dev` — **0 vulnerabilities** (after nodemailer upgrade)
- Local server restart on updated code: `http://localhost:3000/api/health` → **200** (PID `4016`, started with local `NODE_ENV=development` override because `.env` contains `NODE_ENV=production`; production boot now correctly requires strict PG TLS config)

### Remaining Phase 1 security items / risks
- **External config required:** configure production PG TLS verification (`AS_PG_SSL_VERIFY=1` + `PGSSLROOTCERT`/`AS_PG_SSL_CA` as needed) and `APP_URL` (trusted HTTPS origin) before production reset-email flows. `.env` currently sets `NODE_ENV=production`; with new strict rule, production-like boot requires TLS verify config.
- **CSP is transitional** (`'unsafe-inline'` scripts/styles) due inline scripts/styles; requires nonce/hash/refactor to tighten.
- **Serverless rate limiting** is DB-persisted with debounce (eventual consistency), not atomic distributed limiter; consider Redis/Upstash/KV/edge rate limiting for stronger protection.
- **Reset-token schema migration:** plaintext reset tokens in existing DB become unusable (safe; tokens expire). Consider adding explicit `reset_token_hash`/migration cleanup in a controlled migration.
- **Upload/storage security:** validation exists, but local disk storage is ephemeral on Vercel; private persistent object storage still required (Phase 7, needs provider decision).
- **Full CSRF/authz audit** still needed across every route and admin/customer role boundary (Phase 5/6).
- **No destructive DB migration performed.** Large CRM normalization/migration (Phase 2 in new plan) requires explicit approval, dry-run, backup, integrity verification, rollback plan, and no deletion of original data until verified.

### Phase 7 SEO — Increment 1 (2026-11-21): calculator metadata
- **Issue:** 6 standalone calculator pages lacked `canonical`, `og:url`, `og:image`, and `twitter:image`.
- **Files changed:** `emi-calculator.html`, `balance-transfer-calculator.html`, `tenure-calculator.html`, `prepayment-calculator.html`, `buy-vs-rent-calculator.html`, `home-loan-tax-saving-calculator.html`.
- **Fix:** added canonical/og:url/og:image/twitter:image/og:site_name/og:locale using existing site domain pattern (`https://as-financial-services-psi.vercel.app/...`) and existing hero image. **Verify/replace domain with the actual production domain before deploy/SEO signoff.**
- **Not done:** full Phase 7 SEO pass (all public pages metadata audit, schema, sitemap domain confirmation, robots/Search Console, social preview validation).

### Phase 1 Security — Increment 2 (2026-11-21): regression tests / audit
- **Audit:** rechecked mutating API routes; protected admin/session/content/user mutating routes have `requireSession` + `requireCsrf` (and role checks where appropriate). Public mutating routes (`/api/login`, `/api/forgot-password`, `/api/reset-password`, `/api/enquiries`) remain intentionally unauthenticated but are validated/rate-limited.
- **Tests added:** `tests/smoke.test.js` now includes mailer Host-header/reset-URL safety and auth reset-token hashing regression checks.
- **Checks run:** `node --test tests/smoke.test.js` — **7/7 pass**.
- **Still pending:** full authz/role-boundary audit for future customer portal, upload storage hardening (Phase 7), CSP nonce/hash tightening, distributed rate limiting for production serverless.

### Phase 1 Security — Increment 3 (2026-11-21): error handler message hardening
- **Issue:** global error handler returned `error.message` for non-`HttpError` 4xx responses, potentially leaking internal details.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** only return controlled `HttpError` messages to clients for 4xx; non-HttpError 4xx/5xx return generic safe messages; 5xx still logged server-side.
- **Checks run:** `node --check server/index.js` pass; `node --test tests/smoke.test.js` **7/7 pass**; server restarted (PID 2040), `/api/health` 200.

### Phase 1 Security — Increment 4 (2026-11-21): mailer fallback log redaction
- **Issue:** mailer fallback logged password reset URL (contained sensitive token).
- **Files changed:** `server/mailer.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** removed reset URL from fallback log; logs delivery-not-configured/available message only.
- **Checks run:** `node --check server/mailer.js` pass; `node --test tests/smoke.test.js` **7/7 pass**; dev server restarted (PID 17508), `/api/health` 200.

### Phase 1 Security — Increment 5 (2026-11-21): CSP connect-src tightening
- **Issue:** CSP `connect-src` allowed `https:` broadly.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** tightened to `connect-src 'self'` (frontend uses same-origin API calls; no external fetch required).
- **Checks run:** `node --check server/index.js` pass; `node --test tests/smoke.test.js` **7/7 pass**; dev server restarted, `/api/health` 200.

### Phase 1 Security — Increment 6 (2026-11-21): admin X-Robots-Tag defense-in-depth
- **Issue:** admin pages/routes relied on meta robots and robots.txt only; no response header.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `X-Robots-Tag: noindex, nofollow` for `/admin*` and `/api/admin*` responses.
- **Checks run:** `node --check server/index.js` pass; `node --test tests/smoke.test.js` **7/7 pass**; dev server restarted (PID 20192); `GET /admin.html` returned 200 with `X-Robots-Tag: noindex, nofollow`.

### Phase 4 A11y — Increment 5 (2026-11-21): admin dashboard heading hierarchy fix
- **Issue:** `admin.html` had two `<h1>` elements (login brand + dashboard topbar); topbar CSS targeted `.topbar-title h1` while JS updated `#topbar-title` by ID.
- **Files changed:** `admin.html`, `assets/css/admin.css`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** changed dashboard topbar heading to `<h2 id="topbar-title">` and updated `.topbar-title h1` selectors to `.topbar-title h2` in admin CSS; JS ID selector unaffected.
- **Checks run:** static HTML/CSS/JS inspection; admin page served 200 with updated markup; h1-count scan shows 1 h1 per HTML file. **Not run:** full admin visual/keyboard QA.

### Phase 7 SEO/A11y — Increment 2 (2026-11-21): social image alt metadata
- **Issue:** 14 public HTML pages with `og:image`/`twitter:image` were missing `og:image:alt`/`twitter:image:alt`.
- **Files changed:** `404.html`, `about.html`, `balance-transfer-calculator.html`, `buy-vs-rent-calculator.html`, `contact.html`, `emi-calculator.html`, `guides.html`, `home-loan-tax-saving-calculator.html`, `index.html`, `loans.html`, `prepayment-calculator.html`, `privacy-policy.html`, `tenure-calculator.html`, `terms-of-use.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added neutral `og:image:alt` and `twitter:image:alt` ("AS Financial Services and Solutions") after image meta tags.
- **Checks run:** static scan confirms no remaining pages with `og:image` missing `og:image:alt`. **Not run:** social preview validator.

### Phase 4 A11y — Increment 6 (2026-11-21): duplicate main landmark fix
- **Issue:** `admin.html` had two `role="main"` landmarks (login box and dashboard), violating single-main landmark guidance.
- **Files changed:** `admin.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** changed login container from `role="main"` to `role="region"` (aria-label preserved); dashboard remains the main landmark.
- **Checks run:** static scan confirms 1 main landmark per HTML file. **Not run:** screen-reader/admin flow QA.

### Phase 1 Security — Increment 7 (2026-11-21): upload download hardening
- **Issue:** admin upload download endpoint served files via `sendFile` without explicit disposition/dotfiles policy.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `dotfiles: 'deny'` and explicit `Content-Disposition` (`inline` for pdf/jpg/png/webp/txt/csv, `attachment` otherwise) with safe basename; kept existing auth/role/path validation.
- **Checks run:** `node --check server/index.js` pass; `node --test tests/smoke.test.js` **7/7 pass**; dev server restarted (PID 8916), `/api/health` 200. **Not run:** upload/download browser QA in admin UI.
- **Still pending:** persistent private object storage for production (Vercel ephemeral), malware/content scanning policy, signed URL/access logging as needed.

### Phase 1 Security — Increment 8 (2026-11-21): static sensitive-file exposure guard
- **Issue:** `express.static(ROOT)` could serve internal project files from repo root; `IMPLEMENTATION_PLAN.md` was publicly reachable (200).
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added guard middleware before static serving to 404 sensitive paths/names/extensions (server/data/tests/node_modules/.git/etc., `.env*`, package/vercel/config files, `*.md/*.bak/*.lock/*.sql/*.map`, README/plan). Existing public HTML/assets/routes unaffected.
- **Checks run:** `node --check server/index.js` pass; local HTTP checks: `/IMPLEMENTATION_PLAN.md`, `/README.md`, `/package.json`, `/.env`, `/server/index.js`, `/data/db.json` -> 404; `/index.html`, `/assets/css/styles.css` -> 200; `node --test tests/smoke.test.js` **7/7 pass**; dev server restarted (PID 19648), `/api/health` 200.
- **Still pending:** consider moving public assets to a dedicated `public/` directory for stronger isolation; verify Vercel static routing behavior in deployment config.

### Phase 1 Security — Increment 9 (2026-11-21): Vercel ignore defense-in-depth
- **Issue:** `.vercelignore` did not exclude internal docs/tests/backup files from deployment package.
- **Files changed:** `.vercelignore`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `tests`, `*.bak`, `IMPLEMENTATION_PLAN.md`, `README.md` to `.vercelignore` (defense-in-depth; Express guard still primary on Node path). `vercel.json` rewrites all routes to `/api`, so Express handles requests on Vercel.
- **Checks run:** static config review of `vercel.json`/`.vercelignore`. **Not run:** Vercel deployment verification.

### Phase 8 Perf/A11y — Increment 1 (2026-11-21): image dimension attributes
- **Issue:** several `<img>` tags lacked `width`/`height`, increasing CLS risk.
- **Files changed:** `admin.html`, `index.html`, `loans.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added intrinsic `width`/`height` attributes to images missing them (including admin logo mark and index/loans poster images).
- **Checks run:** static scan confirms all `<img>` tags in HTML files now include width/height. **Not run:** visual regression/Lighthouse CLS measurement.

### Phase 1 Security — Increment 10 (2026-11-21): CSP inline-script hash tightening
- **Issue:** CSP `script-src` allowed `'unsafe-inline'` without hashes; inline JS execution was broadly permitted.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** collect SHA-256 hashes of inline JS scripts (excluding JSON-LD data blocks) from root HTML files at startup and include them in `script-src`; kept `'unsafe-inline'` as legacy fallback (modern browsers ignore it when hashes are present).
- **Checks run:** `node --check server/index.js` pass; server restarted (PID 18644), CSP header on `/index.html` includes 7 script hashes; `node --test tests/smoke.test.js` **7/7 pass**.
- **Caveats:** hashes are collected at startup - HTML inline script changes require server restart/redeploy; `style-src` still uses `'unsafe-inline'`; full nonce-based CSP migration still pending.

### Phase 4 A11y — Increment 8 (2026-11-21): form hint associations
- **Issue:** `small.field-hint` help text was not programmatically associated with inputs.
- **Files changed:** `contact.html`, `index.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added unique `id`s to field hints and matching `aria-describedby` on related inputs (phone/email hints in contact form, contact popup, and index apply popup).
- **Checks run:** static scan confirms all `.field-hint` elements have ids. **Not run:** screen-reader announcement QA.

### Phase 4 A11y — Increment 9 (2026-11-21): current page nav indicator
- **Issue:** `index.html` Home nav/mobile links lacked `aria-current="page"`.
- **Files changed:** `index.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `aria-current="page"` to Home nav and mobile nav links on the home page.
- **Checks run:** static HTML inspection. **Not run:** screen-reader/nav QA across all pages.

### Phase 4 A11y — Increment 10 (2026-11-21): FAQ accordion semantics
- **Issue:** FAQ accordions had `aria-expanded` but lacked `aria-controls`/`id` linkage and panel `role="region"`/`aria-labelledby`.
- **Files changed:** `contact.html`, `index.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added unique button/panel IDs, `aria-controls`, `role="region"`, and `aria-labelledby` for all FAQ items; preserved existing classes/styles for JS behavior.
- **Checks run:** static HTML inspection; JS class-based selectors unchanged. **Not run:** keyboard/screen-reader accordion QA.

### Phase 4 A11y — Increment 11 (2026-11-21): unlabeled search/honeypot inputs
- **Issue:** lender search input lacked an accessible name; honeypot inputs lacked labels (aria-hidden but flagged by naive audits).
- **Files changed:** `index.html` (search + honeypot), `about.html`, `balance-transfer-calculator.html`, `buy-vs-rent-calculator.html`, `contact.html`, `emi-calculator.html`, `guides.html`, `home-loan-tax-saving-calculator.html`, `loans.html`, `prepayment-calculator.html`, `tenure-calculator.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `aria-label="Search lenders by bank, NBFC or loan type"` to lender search; added `aria-label="Website"` to honeypot `name="website"` inputs. Wrapped consent checkboxes were already label-associated.
- **Checks run:** static scan confirms honeypots and search input now have aria-labels. **Not run:** screen-reader QA.

### Phase 4 A11y — Increment 12 (2026-11-21): tel inputmode/autocomplete
- **Issue:** two `type="tel"` inputs were missing `inputmode="tel"` and `autocomplete="tel"`.
- **Files changed:** `about.html`, `loans.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `inputmode="tel" autocomplete="tel"` to `#ab-phone` and `#lp-phone`.
- **Checks run:** static scan confirms all `type="tel"` inputs now include `inputmode`. **Not run:** mobile device keyboard QA.

### Phase 8 Perf — Increment 2 (2026-11-21): static cache headers
- **Issue:** static files were served without explicit cache policy; HTML/assets could be cached inconsistently.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** split `/assets` static serving with `maxAge` 7d in production (0 in dev); set `Cache-Control: no-cache` for HTML responses (including clean-URL and 404 sendFile); kept etag/dotfiles ignore.
- **Checks run:** `node --check server/index.js` pass; dev server restarted (PID 2068); HTML response `Cache-Control: no-cache`, assets `public, max-age=0` in dev; `node --test tests/smoke.test.js` **7/7 pass**. **Not run:** production CDN/cache behavior verification.

### Phase 7 SEO — Increment 3 (2026-11-21): 404 noindex
- **Issue:** `404.html` lacked a robots meta directive.
- **Files changed:** `404.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `<meta name="robots" content="noindex, follow">`.
- **Checks run:** static HTML inspection. **Not run:** search console/crawl verification.

### Phase 1/5 Security — Increment 11 (2026-11-21): Turnstile server verification hook
- **Issue:** no server-side bot/challenge verification on public enquiry submission.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added optional Cloudflare Turnstile server-side verification (`AS_TURNSTILE_SECRET_KEY`/`TURNSTILE_SECRET_KEY`). When configured, `/api/enquiries` requires a valid `turnstileToken`/`cf-turnstile-response`; when not configured, existing behavior is preserved.
- **Checks run:** `node --check server/index.js` pass; server restarted (PID 16056), `/api/health` 200; `node --test tests/smoke.test.js` **7/7 pass**.
- **External config still required:** Turnstile site/secret keys, frontend widget integration, and production enablement/testing.

### Phase 1 Security — Increment 12 (2026-11-21): static guard extension hardening
- **Issue:** static sensitive-file guard did not block common certificate/key file extensions.
- **Files changed:** `server/index.js`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `.pem,.key,.pfx,.p12,.crt` to blocked static extensions.
- **Checks run:** `node --check server/index.js` pass; dev server restarted, `/api/health` 200; `node --test tests/smoke.test.js` **7/7 pass**.

### Phase 4/7 Quick Polish — Increment 13 (2026-11-21): color-scheme meta
- **Issue:** pages lacked `color-scheme` meta hint.
- **Files changed:** all 15 HTML pages, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `<meta name="color-scheme" content="light">`.
- **Checks run:** static scan across all HTML files. **Not run:** browser rendering QA.

### Phase 4 A11y — Increment 14 (2026-11-21): admin logo alt encoding fix
- **Issue:** `admin.html` logo image alt text had mojibake/encoding corruption.
- **Files changed:** `admin.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** replaced corrupted alt with `AS Financial Services and Solutions`.
- **Checks run:** static HTML inspection. **Not run:** screen-reader QA.

### Phase 8 Perf — Increment 3 (2026-11-21): hero image preload
- **Issue:** home page LCP hero image was not preloaded.
- **Files changed:** `index.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `<link rel="preload" as="image" href="assets/img/hero-family-home.jpg">`.
- **Checks run:** static HTML inspection. **Not run:** Lighthouse/LCP measurement.

### Phase 4 Quality — Increment 7 (2026-11-21): explicit button types
- **Issue:** many non-submit `<button>` elements lacked explicit `type`, relying on browser default `submit`.
- **Files changed:** all 15 HTML pages, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `type="button"` to buttons missing `type`; verified no form-contained submit buttons were missing `type` before patch.
- **Checks run:** static scan confirms no double `type` attributes and no missing-type buttons inside forms. **Not run:** full browser click-through regression.

### Phase 4 A11y/Responsive — Increment 1 (2026-11-21): admin skip link
- **Issue:** `admin.html` lacked a skip link and skip-link styling (admin.css does not include styles.css).
- **Files changed:** `admin.html`, `assets/css/admin.css`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added skip link to `#login-screen` in admin; added `.skip-link` styles in `admin.css`.
- **Checks run:** static HTML/CSS inspection. **Not run:** full keyboard/screen-reader/admin responsive breakpoint QA.
- **Still pending:** full Phase 4 audit/fixes across all 15 pages at 320/375/425/768/1024/1440/1920, focus order/contrast, form errors, reduced-motion checks.

### Phase 4/7 — Increment 2 (2026-11-21): 404 metadata + encoding fix
- **Issue:** `404.html` missing `og:image`/`twitter:card`/`twitter:image`; mobile nav logo alt had mojibake.
- **Files changed:** `404.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added missing social meta tags; fixed broken alt text to clean `&mdash;` version.
- **Checks run:** static inspection. **Not run:** browser visual QA.

### Phase 4 A11y — Increment 3 (2026-11-21): form autocomplete improvements
- **Issue:** some popup/lead forms missing `autocomplete` (and `inputmode` where appropriate) for name/phone/email/city.
- **Files changed:** `contact.html` (contact popup), `emi-calculator.html` (apply popup), `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `autocomplete="name|tel|email|address-level2"` and `inputmode="tel"` on key fields.
- **Checks run:** static inspection. **Not run:** browser/mobile autofill QA across all forms/pages.

### Phase 4 A11y — Increment 4 (2026-11-21): status/alert live regions
- **Issue:** form success messages and admin login error lacked live-region semantics for assistive tech.
- **Files changed:** `about.html`, `admin.html`, `balance-transfer-calculator.html`, `buy-vs-rent-calculator.html`, `contact.html`, `emi-calculator.html`, `guides.html`, `home-loan-tax-saving-calculator.html`, `index.html`, `loans.html`, `prepayment-calculator.html`, `tenure-calculator.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** added `role="status" aria-live="polite"` to `.form-success` blocks; added `role="alert" aria-live="assertive"` to admin `#login-error`.
- **Checks run:** grep/static verification of updated attributes. **Not run:** screen-reader announcement QA.

### Phase 1 UI/Consistency — Increment 6 (2026-11-21): calculator hub link normalization
- **Issue:** legacy `index.html#calculator` links remained on multiple public pages after calculator hub (`guides.html#calculators`) was established.
- **Files changed:** `404.html`, `about.html`, `contact.html`, `guides.html`, `loans.html`, `privacy-policy.html`, `terms-of-use.html`, `IMPLEMENTATION_PLAN.md`.
- **Fix:** replaced `index.html#calculator` with `guides.html#calculators` on non-index pages (index retains on-page `#calculator` section anchors).
- **Checks run:** grep verification for remaining `index.html#calculator` in non-index pages (none). **Not run:** browser click-through QA on all affected pages.
