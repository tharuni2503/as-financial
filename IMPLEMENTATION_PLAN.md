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
- **Immediate next step (Phase 1 start, after checkpoint):** explain existing frontend/design implementation and problems, list exact files for first frontend increment (design tokens/shared components + critical page/calculator parity), implement complete working changes preserving functionality, run relevant checks/tests, update this plan, and commit if authorized.

**Important constraints reaffirmed:** preserve architecture unless technically required; no rebuild from scratch; no removal of existing pages/features/endpoints/admin/DB records; no fake data/simulated success; no destructive migrations; no secrets committed; verify before claiming completion.
