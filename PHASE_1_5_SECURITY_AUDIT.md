# Phase 1.5 — Independent Security Verification Audit

**Project:** AS Financial Services & Solutions  
**Date:** 2026-11-21  
**Auditor:** AI-assisted verification pass (code inspection + local black-box checks)  
**Scope:** Existing Express + static HTML/CSS/JS + PostgreSQL/JSON-fallback application. No redesign, no destructive DB operations, no production data modification, no Phase 2 migration.

## Executive Summary

**Overall readiness: NOT PRODUCTION-READY (verification incomplete; external dependencies remain).**

The codebase shows meaningful security hardening since earlier audits (parameterized PG queries, hashed reset tokens, trusted `APP_URL` reset links, auth/role/CSRF middleware on mutating admin routes, security headers, static-file exposure guard, upload auth/path checks, safe error handler). However, this pass could **not** fully verify several required controls end-to-end because production credentials, production Vercel environment, separate test DB/backup restore infrastructure, distributed instances, and Turnstile keys were not available in this environment.

**No destructive operations were performed. No production data was modified. Phase 2 migration was not started.**

## Verification Legend

- **Verified:** Tested by code inspection and/or local runtime check with evidence.
- **Partially verified:** Some evidence exists, but coverage/environment is incomplete.
- **Unverified / Blocked:** Could not be tested safely or required external access/config.
- **Failed:** Confirmed issue.

## Baseline Checks Performed

| Check | Result | Evidence |
|---|---|---|
| Existing smoke tests | **PASS 7/7** | `node --test tests/smoke.test.js` |
| Smoke + focused security tests | **PASS 12/12** | `node --test tests/smoke.test.js tests/security.test.js` |
| Dependency audit (prod) | **PASS, 0 vulnerabilities** | `npm audit --omit=dev` |
| Unauthenticated access to protected endpoints | **PASS (401, sampled)** | `tests/security.test.js` + manual checks |
| Sensitive static files blocked | **PASS locally (sampled)** | `/IMPLEMENTATION_PLAN.md`, `/README.md`, `/package.json`, `/.env`, `/server/index.js`, `/data/db.json` -> 404 |
| Admin noindex header | **PASS locally** | `GET /admin.html` returned `X-Robots-Tag: noindex, nofollow` |
| Health endpoint info leakage | **PASS (minimal)** | `/api/health` returned `{"ok":true,"service":"as-financial","backend":"postgres","time":"..."}` |
| Bad JSON error body | **PASS (no stack trace)** | Malformed JSON to `POST /api/enquiries` returned `400`; no stack trace pattern |
| Unknown API route | **PASS** | `/api/unknown-route` returned 404 JSON error |

## Findings (by severity)

### Critical
| ID | Finding | Status | Evidence | Affected files | Recommended fix |
|---|---|---|---|---|---|
| C1 | **Distributed rate limiting / login-attempt limiting not proven across serverless instances.** In-memory Maps are used for API/enquiry/password attempt limits; security state is persisted with debounce, but not atomic/distributed. | **Partially verified / Blocked** | `server/index.js` uses `apiHitsByIp`, `enquiriesByIp`, `pwAttemptsByIp`; `server/auth.js` stores attempts in memory + persisted security state. No multi-instance test performed. | `server/index.js`, `server/auth.js`, store security-state persistence | Use atomic distributed store (Redis/Upstash/Vercel KV/Postgres advisory/rate-limit table with atomic increments) for login, reset, enquiry, and API throttles. Verify across multiple instances. |
| C2 | **Backup/restore capability not verified in a separate database.** | **Blocked** | No separate test DB/backup credentials provided; production data must not be touched. | Ops/DB process (no code proof) | Establish automated encrypted backups, retention policy, and periodic restore drills to a separate non-production DB. Document RPO/RTO and last successful restore test. |

### High
| ID | Finding | Status | Evidence | Affected files | Recommended fix |
|---|---|---|---|---|---|
| H1 | **Turnstile is server-hook only; frontend widget/integration and production key config not verified.** | **Partially verified** | `server/index.js` verifies token only when `AS_TURNSTILE_SECRET_KEY`/`TURNSTILE_SECRET_KEY` is set; skips when unset. No frontend widget found. | `server/index.js`, public form HTML/JS | Add Cloudflare Turnstile widget to all public forms, send token, enforce in prod when configured, add tests for missing/invalid/expired tokens. |
| H2 | **User data isolation with two independent test accounts not verified.** | **Blocked** | No test credentials/accounts available; cannot safely create users in shared/prod-connected DB. Code shows role checks, but end-to-end isolation untested. | `server/index.js`, auth/store | Create two test users in isolated test DB; verify normal user cannot access admin routes, cannot read/modify other users' records/sessions, and admin scoping behaves correctly. |
| H3 | **Production Vercel routing/env/security behavior not verified.** | **Blocked** | `vercel.json` rewrites all to `/api`; local Express guard tested, but no Vercel deployment verification. | `vercel.json`, deployment config | Verify deployed behavior: sensitive file blocking, headers, HTTPS redirect, env vars, function routing, static/cache behavior, 404/500 responses. |
| H4 | **Upload storage is local/ephemeral on Vercel; private durable storage and malware/content policy not implemented.** | **Partially verified** | Uploads written to `data/uploads`; Vercel ephemeral. Download route requires admin auth and path checks. | `server/index.js`, deployment/storage | Move uploads to private object storage (S3/R2/GCS/etc.) with signed/admin-authorized access, AV scanning/policy, retention, and audit logging. |

### Medium
| ID | Finding | Status | Evidence | Affected files | Recommended fix |
|---|---|---|---|---|---|
| M1 | **CSP remains transitional.** `style-src` uses `'unsafe-inline'`; `script-src` includes hashes but retains `'unsafe-inline'` fallback. | **Verified** | CSP header inspected in code and runtime. | `server/index.js`, HTML templates | Migrate inline styles/scripts to nonce/hash-based strategy; remove `'unsafe-inline'` where feasible; add CSP reporting. |
| M2 | **Rate-limit persistence is debounced, not atomic.** Could under-count during crashes/concurrency. | **Partially verified** | `scheduleSecurityPersist` debounces writes; in-memory counters primary. | `server/index.js`, `server/auth.js` | Use atomic datastore counters or external rate limiter; add concurrency tests. |
| M3 | **Session revocation endpoints require CSRF but no explicit role beyond authenticated session; behavior should be verified for least privilege.** | **Partially verified** | `/api/sessions/revoke-others`, `DELETE /api/sessions/:id` have `requireSession, requireCsrf` only. Code appears to scope by session/email; not end-to-end tested. | `server/index.js`, `server/auth.js` | Add focused tests confirming users can only revoke own sessions unless explicitly admin-authorized. |
| M4 | **Password reset email delivery/logging depends on env; production misconfig could block resets.** | **Partially verified** | Handler warns in prod if not delivered; does not expose token in prod. | `server/index.js`, `server/mailer.js` | Configure SMTP/App URL in prod, monitor delivery failures, add admin recovery runbook. |
| M5 | **No automated integration tests for authz/CSRF/rate limit/upload/file access.** | **Verified gap** | `tests/smoke.test.js` is mostly static/unit. | `tests/` | Add API integration tests using isolated test DB/test server. |

### Low
| ID | Finding | Status | Evidence | Affected files | Recommended fix |
|---|---|---|---|---|---|
| L1 | **Health endpoint reveals backend type (`postgres`).** Minimal info, but unnecessary. | **Verified** | `/api/health` response includes `"backend":"postgres"`. | `server/index.js` | Consider removing backend type in production or restricting details. |
| L2 | **Malformed JSON returns 400 with empty body.** Not a leak; minor DX/consistency issue. | **Verified** | `POST /api/enquiries` with bad JSON -> `400` empty body. | `server/index.js` error/body parsing | Return consistent JSON error `{error:...}` for parse failures. |
| L3 | **Dev reset token response exists in non-production mode.** Intended for dev, but ensure never enabled in prod. | **Partially verified** | `forgot-password` returns dev token/url only when `!IS_PRODUCTION`. | `server/index.js` | Keep prod guard; add startup assert/test. |

## Audit Checklist Status

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Auth, hashing, reset, session expiry/logout | **Partially verified** | scrypt + timingSafeEqual used; reset tokens hashed; session TTL/refresh/clear cookie present; logout route requires session+CSRF. End-to-end login/reset/logout/token reuse not fully tested with live accounts. |
| 2 | Authorization on every API route | **Partially verified** | Route map shows `requireSession/requireRole/requireCsrf` on admin/mutating routes. Unauth 401 checks passed for sampled protected endpoints. Role boundary and object-level checks not fully tested. |
| 3 | User data isolation (two test accounts) | **Blocked** | No isolated test accounts/DB available. |
| 4 | CSRF protection on relevant state-changing requests | **Partially verified** | `requireCsrf` middleware present; mutating protected routes include it. No live authenticated CSRF pass/fail test executed. |
| 5 | SQLi, XSS, input validation, unsafe output rendering | **Partially verified** | store-pg uses parameterized queries; dynamic WHERE clauses use placeholders. `validate.js` shapes inputs. XSS/output encoding needs browser/context review; no payload fuzz suite run. |
| 6 | Brute force, API rate limits, distributed-instance behavior | **Partially verified / Blocked** | Rate limit code exists; not load/distributed tested. |
| 7 | Turnstile frontend + server-side verification | **Partially verified** | Server hook exists; no frontend widget/keys/prod verification. |
| 8 | File upload validation/download auth/path traversal/private storage | **Partially verified** | MIME whitelist, size limit, filename sanitization, admin auth+CSRF on upload, admin auth on download, path traversal checks, dotfiles deny, disposition set. No malicious file fuzz/oversized integration test; storage ephemeral. |
| 9 | Static file exposure, encoded paths, backup/sensitive extensions | **Partially verified** | Guard blocks common sensitive paths/extensions; local checks for `.env`, `server/index.js`, `IMPLEMENTATION_PLAN.md` returned 404. Encoded-path traversal and Vercel behavior not fully verified. |
| 10 | CSP, HSTS, HTTPS redirects, cookie flags, security headers | **Partially verified** | Headers present in code/runtime; cookies HttpOnly/SameSite=Lax/Secure logic present. HTTPS redirect at edge/Vercel not verified; CSP transitional. |
| 11 | Production error handling, logs, secret exposure | **Partially verified** | Safe error handler and no stack trace in bad JSON sample. Needs prod log review and broader fault injection. |
| 12 | PostgreSQL permissions, TLS, connection security | **Partially verified** | Prod requires verified TLS; parameterized queries. DB user privileges/least privilege/pg_hba/network rules not verified. |
| 13 | Backup schedule, retention, encryption, restore testing in separate DB | **Blocked** | No operational evidence; restore not tested. |
| 14 | Dependency vulnerabilities and outdated packages | **Partially verified** | `npm audit --omit=dev` 0 vulns. Outdated-package review not exhaustive. |
| 15 | Vercel routing, deployment config, production env vars | **Blocked / Partially verified** | `vercel.json` inspected; no live deployment/env verification. |

## Required Tests — Status

| Required test | Status | Result/Evidence |
|---|---|---|
| Unauthenticated access to protected endpoints | **Pass (sampled)** | `GET /api/admin/store, /api/enquiries, /api/users, /api/audit, /api/sessions, /api/admin/export, /api/admin/uploads/test.txt` -> 401; mutating protected endpoints without session -> 401. |
| Normal user attempting admin operations | **Blocked** | No test user credentials/isolated DB. |
| One user attempting to access another user's records | **Blocked** | No two test accounts/isolated DB. |
| Invalid, expired, reused reset tokens | **Blocked / Partially verified** | Code enforces hash lookup, expiry, clears token, revokes sessions. No live token lifecycle test executed. |
| CSRF failures | **Blocked** | Requires authenticated session; no credentials available. Code review shows `requireCsrf` on mutating routes. |
| Invalid/missing CAPTCHA tokens when enabled | **Blocked** | Turnstile secret/keys not configured in test env. |
| Rate limits across multiple server instances | **Blocked** | Single local instance only. |
| Malicious form payloads and oversized uploads | **Partially verified** | Validation/sanitization code present; no fuzz/oversized upload integration test executed. |
| Direct access to sensitive files | **Pass (local sample)** | `/IMPLEMENTATION_PLAN.md`, `/.env`, `/server/index.js` -> 404. |
| Production error responses for stack traces/internal details | **Pass (sample)** | Bad JSON -> 400 empty body; no stack trace observed. |
| Verify DB backup can be restored without touching production | **Blocked** | No separate backup/restore environment provided. |

## Fixed Issues / Files Changed During This Audit

- **No production code fixes applied during this audit pass.** (Audit-only; prior hardening already present in working tree.)
- Created audit report: `PHASE_1_5_SECURITY_AUDIT.md`.
- Added focused automated security checks: `tests/security.test.js` (unauth 401 checks, sensitive static path blocking, security headers, unknown API route, malformed JSON no stack trace).

## Remaining Risks

- Distributed brute-force/rate-limit bypass in multi-instance serverless deployment.
- Unverified object-level authorization and user isolation.
- Turnstile not fully deployed/enforced end-to-end.
- Uploads on ephemeral local storage; no durable private storage/AV scanning.
- CSP still allows inline styles and script fallback.
- No verified backup/restore drill.
- Vercel production config/env/HTTPS/header behavior unverified.
- Limited automated integration/security regression coverage.

## External Configuration Required

- Production Postgres verified TLS (`AS_PG_SSL_VERIFY=1`, CA bundle as needed).
- Trusted `APP_URL`, SMTP credentials, tested reset delivery.
- Cloudflare Turnstile site+secret keys and frontend widget integration.
- Real production domain and canonical/sitemap/robots alignment.
- Persistent private object storage for uploads + access policy.
- Centralized logging/monitoring/alerting with secret redaction.
- Backup schedule, retention, encryption, and separate restore-test environment.
- Vercel env vars, deployment protection, HTTPS/domain config verification.

## Production Deployment Blockers

1. **Backup/restore not verified** in separate DB (Critical).
2. **Distributed rate limiting/login throttling not verified** for serverless multi-instance (Critical).
3. **Turnstile not fully configured/enforced end-to-end** (High).
4. **User isolation/admin role-boundary end-to-end tests not executed** (High).
5. **Vercel production deployment/env/header/routing not verified** (High).
6. **Durable private upload storage not implemented** (High for production durability/security posture).

## Final Readiness Decision

**NO-GO for production signoff (Phase 1.5 incomplete).**

Rationale: core controls exist in code and basic local checks passed, but required verification is incomplete and several external/operational controls are unproven. Do **not** mark production-ready until blocked tests are executed in a safe isolated environment and deployment blockers are resolved.

## Recommended Next Safe Steps (No Phase 2)

1. Run integration security tests in an isolated staging DB with two test users (admin + normal).
2. Add automated API tests for authz, CSRF, reset-token lifecycle, upload/download, and rate limits.
3. Configure Turnstile keys + frontend widget in staging; verify invalid/missing/valid flows.
4. Verify Vercel deployment headers/routing/env and HTTPS behavior.
5. Perform backup/restore drill in separate DB and document evidence.
6. After evidence is complete, reissue Phase 1.5 decision. **Do not begin Phase 2 migration without explicit approval.**
