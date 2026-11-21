# Authorization Test Report (Phase 1.6 / Task 4)

**Date:** 2026-11-21  
**Scope:** Object-level/role-based authorization verification for existing AS Financial Services API.  
**Environment:** Isolated test server spawned with JSON backend (`AS_DATA_DIR` temp directory, no `DATABASE_URL`/`POSTGRES_URL`), local only. **No production customer data used. No production records modified. No unrelated DB migrations performed.**

## Executive Summary

**Production readiness: NO-GO.**  
Automated authorization regression tests passed in an isolated JSON-backend environment for the tested matrix. This does **not** constitute full production authorization signoff because tests were not executed against an isolated staging PostgreSQL database with production-like data model/roles, and the app’s current model is primarily role-based admin CRM (not per-customer object ownership).

## What Was Inspected

- `server/index.js` route guards (`requireSession`, `requireRole`, `requireCsrf`) and session revocation ownership/role-hierarchy checks.
- `server/auth.js` session lifecycle, CSRF token handling, revocation helpers.
- Store interfaces for users/sessions/uploads/admin collections (`server/store-pg.js`, `server/store-json.js`).

## What Was Changed

- Added automated authz regression suite: `tests/phase16.authz.test.js`.
- No production code changes required by these tests.

## Files Affected

| File | Change |
|---|---|
| `tests/phase16.authz.test.js` | New isolated authz matrix regression tests. |
| `AUTHORIZATION_TEST_REPORT.md` | This report. |

## Test Setup

- Spawned isolated server on `127.0.0.1:3197` with temp `AS_DATA_DIR`, `DATABASE_URL=''`, `POSTGRES_URL=''`.
- Created accounts: 1 super_admin (bootstrap), 1 admin, 2 advisors (independent users).
- Used real login sessions/cookies/CSRF tokens.

## Automated Tests Performed and Exact Results

Command: `node --test tests/phase16.authz.test.js`  
**Result: 11/11 pass (10 subtests + 1 top-level), 0 fail**

| # | Test | Expected | Exact result |
|---|---|---|---|
| 1 | Setup: create admin and two advisors | Super admin login 200; user creation 201; advisor/admin logins 200 | **PASS** |
| 2 | Unauthenticated requests rejected | Protected endpoints return 401 | **PASS** (all sampled endpoints returned 401) |
| 3 | Invalid session token rejected | `/api/admin/store` with invalid token returns 401 | **PASS** (401) |
| 4 | Advisor cannot access admin/super_admin endpoints | 401/403 for admin/export/users/audit/sessions/store/leads/uploads operations | **PASS** (all returned 401/403) |
| 5 | Admin cannot perform super_admin-only operations | 403 for export, create user, patch user, reset-token | **PASS** (all 403) |
| 6 | CSRF required on mutating authenticated routes | POST `/api/sessions/revoke-others` without CSRF returns 403 | **PASS** (403) |
| 7 | Session ownership: user cannot revoke another user session | Advisor1 deleting Advisor2 session returns 403 | **PASS** (403) |
| 8 | Admin cannot revoke super_admin session (role hierarchy) | 403 or no applicable target | **PASS** (403 when non-current super_admin session present; otherwise safely skipped by condition) |
| 9 | ID tampering: advisor cannot access user records by changing ID | PATCH `/api/users/:id` by advisor returns 401/403/404 | **PASS** (401/403/404) |
| 10 | Upload/download restrictions | Super admin upload 201; advisor download 401/403; unauth download 401 | **PASS** (201, 401/403, 401) |

## Vulnerabilities Discovered

- **No new authorization vulnerabilities discovered** by this automated matrix in the isolated JSON-backend run.
- Previously known gaps remain (see Remaining Gaps).

## Fixes Applied

- **No production code fixes required** by this test run.
- Added regression coverage: `tests/phase16.authz.test.js`.

## Remaining Gaps / Unverified

1. **Not run against isolated staging PostgreSQL.** User requested staging PG; no isolated staging `TEST_DATABASE_URL`/environment was provided. Running against production-connected DB was unsafe and not performed.
2. **Model limitation:** current system is role-based admin/staff CRM; it lacks per-customer end-user ownership model. “Each user’s records” maps to role-permitted admin resources, not customer-owned records.
3. **Incomplete matrix coverage:** not every collection/resource/verb combination was tested; no create/read/update/delete per-object ownership test for every CRM entity by every role.
4. **Expired-session test not time-controlled.** Invalid token tested; expiry lifecycle needs time-controlled integration test.
5. **Query-param/body ID tampering** not exhaustively fuzzed across all endpoints.
6. **Postgres-specific behavior** (RLS/constraints/transactions) unverified.
7. **Uploads:** ownership is admin-role based, not per-user private ownership; durable private object storage not implemented.

## External Configuration Required

- Provision isolated staging PostgreSQL database (separate from production), seed test accounts/data, provide `TEST_DATABASE_URL` for CI/staging-only runs.
- Expand tests to full endpoint/resource/role matrix, including time-controlled expired sessions and object-level CRUD for all collections.
- Add DB-level least-privilege/RLS if multi-tenant/customer-owned data model is introduced.

## Production Readiness Decision

**NO-GO until full authorization matrix passes in isolated staging PostgreSQL and remaining gaps are closed.** Do not start Phase 2 without explicit approval.