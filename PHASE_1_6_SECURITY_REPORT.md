# Phase 1.6 — Close Remaining Production Security Blockers

**Project:** AS Financial Services & Solutions  
**Date:** 2026-11-21  
**Scope:** Verification/hardening pass following Phase 1 and Phase 1.5. No rebuild, no destructive DB migration, no production data modification, no Phase 2.

## Executive Summary

**Production decision: NO-GO (critical blockers remain unverified/externally dependent).**

This pass added isolated integration tests and verified several controls in a safe JSON-backend test environment (separate temp data dir, no production DB). It did **not** verify production Vercel deployment, real distributed multi-instance rate limiting, real backup/restore in a separate database, or durable private object storage. No destructive operations were performed.

## Test Evidence (this pass)

| Check | Result | Evidence |
|---|---|---|
| Existing smoke tests | **PASS 7/7** | `node --test tests/smoke.test.js` |
| Phase 1.5 security tests | **PASS 5/5** | `node --test tests/security.test.js` (against running local server) |
| Phase 1.6 isolated integration tests | **PASS 9/9** | `node --test tests/phase16.integration.test.js` (spawned isolated JSON-backend server, temp `AS_DATA_DIR`) |
| Prod dependency audit | **PASS 0 vulnerabilities** | `npm audit --omit=dev` |

## Task 1: Customer Data Isolation

### What was inspected
- Route protection in `server/index.js` (`requireSession`, `requireRole`, `requireCsrf`).
- Session revocation scoping in `server/index.js` / `server/auth.js` / store backends.
- User management routes (`/api/users*`, `/api/admin/*`, `/api/sessions*`).

### What was changed
- No production code changes. Added isolated integration coverage in `tests/phase16.integration.test.js`.

### Files affected
- `tests/phase16.integration.test.js` (new)
- `PHASE_1_6_SECURITY_REPORT.md` (new)

### Tests performed
- Created two independent test users (advisor role) in isolated temp JSON DB.
- Logged in as each user.
- Verified advisor users received **403** for admin operations: `GET /api/users`, `GET /api/audit`, `GET /api/admin/store`, `POST /api/admin/leads`, `POST /api/users`.
- Attempted cross-user session revocation: user2 attempted `DELETE /api/sessions/:id` for user1 session.

### Exact test results
- Admin bootstrap login: **200**, role `super_admin`.
- Advisor on admin endpoints: **403** (all tested).
- User2 revoking user1 session: **not 200** (denied/failure path). Isolation behavior verified in isolated env.

### What remains unverified
- Object-level ownership for all customer-owned records in a real multi-user/customer portal model (current app is primarily admin/staff CRM; no end-customer account data model exposed).
- Cross-user read/update/delete by manipulating IDs on all domain objects in production Postgres.
- Row-level DB permissions / tenant isolation at DB layer (app-layer only).

### External configuration required
- Isolated staging Postgres with seeded test users for production-like authz testing.
- Formal authorization matrix and automated API tests per role/resource.

## Task 2: CSRF and Password Reset

### What was inspected
- `requireCsrf` middleware in `server/index.js`.
- Reset flow in `server/index.js`, `server/auth.js`, `server/store-pg.js`, `server/store-json.js`, `server/mailer.js`.

### What was changed
- No production code changes. Added integration tests.

### Files affected
- `tests/phase16.integration.test.js`

### Tests performed
- Authenticated mutating request without CSRF token.
- Authenticated mutating request with bad CSRF token.
- Password reset: invalid token, successful reset, reused token, old password rejected, new password accepted.
- Code inspection: reset tokens hashed in store; production forgot-password response does not include dev token/URL; mailer fallback does not log reset URL.

### Exact test results
- POST `/api/admin/leads` with valid session, no CSRF: **403**.
- POST `/api/admin/leads` with valid session, bad CSRF: **403**.
- Reset invalid token: **400**.
- Reset valid token: **200**.
- Reused token: **400**.
- Old password login after reset: **failed (not 200)**.
- New password login after reset: **200**.

### What remains unverified
- CSRF coverage for every browser form flow/end-to-end UI interaction.
- Expired-token case executed with time control in integration (code enforces expiry; not time-travel tested in this run).
- Session invalidation semantics across all existing sessions on password change in Postgres production backend (code calls `revokeAllForEmail`; verified indirectly by code, not prod DB test).
- Email delivery in production SMTP.

### External configuration required
- Trusted `APP_URL`, SMTP config, monitored delivery.
- Staging E2E tests for reset email link flow and expiry.

## Task 3: Rate Limiting and Turnstile

### What was inspected
- `apiHitsByIp`, `enquiriesByIp`, `pwAttemptsByIp`, `auth.tooManyAttempts/noteFailedAttempt`.
- Turnstile hook in `server/index.js`.
- Store backends for shared-state capability.

### What was changed
- Added **Postgres atomic rate-limit table/method**: `server/migrations/002_rate_limits.sql` (`rate_limits` table) and `store.takeRateLimit()` in `server/store-pg.js` (atomic upsert counter) and `server/store-json.js` (in-memory fallback for JSON/dev).
- Refactored `server/index.js` API/enquiry/password/reset rate limit checks to use `store.takeRateLimit()` when available, with safe in-memory fallback.
- Added Turnstile missing/invalid integration tests with `TURNSTILE_SECRET_KEY` configured in isolated server.

### Files affected
- `server/migrations/002_rate_limits.sql` (new)
- `server/store-pg.js`
- `server/store-json.js`
- `server/index.js`
- `tests/phase16.integration.test.js`

### Tests performed
- With Turnstile secret configured, submitted enquiry without token.
- Submitted enquiry with invalid token.
- Re-ran Phase 1.6 isolated integration suite after rate-limit refactor.

### Exact test results
- Missing Turnstile token: **400**.
- Invalid Turnstile token: **400**.
- `node --test tests/phase16.integration.test.js`: **9/9 pass** (includes authz/CSRF/reset/upload checks after refactor).

### What remains unverified
- **Multi-instance distributed rate limiting in production deployment** still needs live verification (code now supports atomic Postgres counters, but not verified across real Vercel/serverless instances).
- Login-attempt limiter in `server/auth.js` still uses in-memory + persisted security state; not fully unified with DB atomic counters.
- Valid Turnstile token with real site/secret keys and frontend widget.
- Expired/reused Turnstile token behavior (real lifecycle).
- Concurrency/load bypass testing.

### External configuration required
- Apply migrations in staging/prod (non-destructive CREATE TABLE IF NOT EXISTS).
- Cloudflare Turnstile site key + secret, frontend widget on all public forms.
- Staging multi-instance/concurrency rate-limit tests.

## Task 4: Database Recovery

### What was inspected
- Repo/config/docs only; no cloud provider dashboard access.

### What was changed
- None. No DB operations performed.

### Files affected
- `PHASE_1_6_SECURITY_REPORT.md`

### Tests performed
- None (blocked).

### Exact test results
- **Blocked — not executed.** No separate backup/restore environment or provider credentials were available. No production data touched.

### What remains unverified
- Daily backups, retention, encryption, restricted access.
- Restore into separate test DB.
- Record counts/data integrity/application functionality after restore.
- RPO/RTO objectives.

### External configuration required
- Database provider backup policy (daily automated backups, PITR if available, encryption at rest/in transit, restricted IAM).
- Separate restore-test database/environment.
- Documented recovery runbook: backup source, restore command/process, validation checklist (row counts, key tables, app smoke), RPO/RTO targets, responsible owner.

## Task 5: Upload Storage

### What was inspected
- Upload/download handlers in `server/index.js`.
- Validation and storage behavior (`data/uploads`, MIME whitelist, 5MB limit, filename sanitization, auth/role/CSRF).

### What was changed
- No production code changes. Added integration tests for invalid type, oversize, and unauth download.

### Files affected
- `tests/phase16.integration.test.js`

### Tests performed
- Upload invalid MIME/type (`.exe`, `application/x-msdownload`).
- Upload oversize PDF (>5MB).
- Valid PDF upload.
- Unauthenticated download of uploaded file.

### Exact test results
- Invalid type: **400**.
- Oversize: **400**.
- Valid PDF upload: **201**.
- Unauthenticated download: **401**.

### What remains unverified
- Durable private object storage (S3/R2/GCS/Azure Blob) — **not implemented**.
- Malware scanning/content disarm policy.
- Signed/private URL expiry and ownership-bound access for non-admin models.
- Vercel serverless ephemeral filesystem behavior in production.

### External configuration required
- Private object storage bucket/container with encryption, restricted IAM, no public listing.
- Server-mediated or short-lived signed download URLs with authorization checks.
- File scanning/quarantine policy appropriate for accepted types.
- Retention/deletion lifecycle.

## Task 6: Production Verification

### What was inspected
- `vercel.json`, server security headers/middleware, cookie settings, CSP/HSTS logic, static guard, error handling.
- Local runtime header checks (prior pass) and code inspection.

### What was changed
- No production code changes.

### Files affected
- `PHASE_1_6_SECURITY_REPORT.md`

### Tests performed
- Code/config inspection only; local checks previously recorded in Phase 1.5.

### Exact test results
- `vercel.json` rewrites all requests to `/api` (single serverless entry). Local Express guard blocks sampled sensitive files.
- **Not verified in live Vercel production:** HTTPS redirect behavior, domain/TLS cert config, env vars, edge caching, real response headers, function logs, secret handling.

### What remains unverified
- Live Vercel deployment settings, env vars, domain/TLS, HTTPS redirect, WAF/rate-limit edge controls.
- Production logs for secret redaction.
- Real 500/error responses in production.

### External configuration required
- Vercel dashboard review: env vars (no secret printing), HTTPS enforcement, domain/cert, deployment protection, function regions, log drains/monitoring.
- Staging/production smoke test after deploy with header capture.

## Files Changed in Phase 1.6

| File | Change |
|---|---|
| `server/migrations/002_rate_limits.sql` | New non-destructive rate-limit table for atomic counters. |
| `server/store-pg.js` | Added `takeRateLimit()` atomic Postgres upsert counter. |
| `server/store-json.js` | Added `takeRateLimit()` in-memory fallback for JSON/dev. |
| `server/index.js` | Routed API/enquiry/password/reset rate limits through store-backed atomic limiter with fallback. |
| `tests/phase16.integration.test.js` | Isolated integration tests (authz, CSRF, reset lifecycle, upload validation/auth, Turnstile missing/invalid when configured). |
| `PHASE_1_6_SECURITY_REPORT.md` | This report. |

## Remaining Critical Blockers (NO-GO)

1. **Backup/restore not verified** in separate DB (Critical).
2. **Distributed rate limiting not production-verified across instances** (Critical/High). Atomic Postgres counter mechanism added in code; live multi-instance/concurrency verification still required; `auth.js` login-attempt limiter not fully unified.
3. **Turnstile not fully end-to-end in production** (High/Critical depending on threat model).
4. **Durable private upload storage not implemented** (High).
5. **Vercel production config/env/HTTPS/header/routing not verified** (High).
6. **Full object-level authorization matrix not verified in production-like staging DB** (High).

## Final Decision

**NO-GO.** Do not mark production-ready. Do not start Phase 2 without explicit approval.