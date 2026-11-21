# AS Financial Services — Pre-Launch Audit Report

**Date:** 2026-11-21  
**Workspace:** `C:\Users\L THARUNI\Documents\Default Project`  
**Branch:** `main` (ahead of `origin/main` by 2 commits)  
**Auditor mode:** Read-only inspection followed by safe fixes in local workspace

> **Important:** This is a local workspace audit. It does **not** prove production readiness on the live domain. Production DNS/HTTPS/deployment, live email delivery, live DB/RLS policies, and real-user flows require environment access and business-owner confirmation.

## 1. Overall Website Assessment

The project is a Node/Express + static HTML/CSS/JS website with an admin dashboard, JSON/Postgres store abstraction, enquiry/auth APIs, and Vercel-style routing. It has a solid foundation but is **not fully verified as production-ready**.

**Overall status:** **Conditional / Not launch-ready without manual verification**

- **Brand/UI:** Improved in this pass to align with official palette (#10294B, #D6A329, #FFFFFF).
- **Security:** Several good controls exist (session auth, CSRF, rate limiting, validation, no tracked .env). A reset-token hashing regression was fixed; tests still show failures that need investigation.
- **Functionality:** Core pages and admin flows exist; not all flows were browser-tested in this audit.
- **SEO/Compliance:** Basic files exist; some items require business/legal confirmation (domain, legal claims, disclosures, analytics consent).

## 2. Existing Architecture Summary

- **Frontend:** Static HTML pages (`index.html`, `about.html`, `loans.html`, `contact.html`, `guides.html`, calculator pages, legal pages, `admin.html`, `404.html`) with shared CSS in `assets/css/` and JS in `assets/js/`.
- **Backend:** Express server in `server/index.js`, auth in `server/auth.js`, validation in `server/validate.js`, mailer in `server/mailer.js`, storage adapters `server/store-json.js` and `server/store-pg.js`.
- **API entry:** `api/index.js` (Vercel/serverless style) and `server/index.js` local/server start.
- **Data:** JSON fallback in `data/db.json`; optional Postgres via env.
- **Deployment config:** `vercel.json` rewrites all routes to `/api`; redirects calculators to guides.
- **Tests:** `tests/` contains smoke/security/phase tests; `package.json` had no default test script (added).

## 3. Pages Inspected

Inspected by code/read/check (not all manually browser-tested): `index.html`, `about.html`, `loans.html`, `contact.html`, `guides.html`, `admin.html`, `privacy-policy.html`, `terms-of-use.html`, `404.html`, calculator HTML pages, `robots.txt`, `sitemap.xml`, `vercel.json`, `package.json`, `.gitignore`, `.env.example`, core server/CSS/JS files.

## 4. Features Inspected

- Static page structure, navigation/footer patterns, responsive CSS presence.
- Admin dashboard auth/session/role checks in server routes.
- Enquiry submission API and validation.
- Password reset flow.
- Content/admin store APIs.
- Brand/theme CSS variables and major components.
- SEO basics: titles/meta/canonical presence patterns, robots/sitemap, 404.
- Security controls: CSRF middleware, rate limiting, cookie/session handling, headers, env handling.

## 5. Issues Discovered / Fixed

| Priority | Issue | Affected file/component | Fix implemented | Verification result |
|---|---|---|---|---|
| P0 | Password reset tokens were stored/handled as raw tokens in current flow; smoke test expected hashed reset token support. | `server/auth.js`, `server/index.js`, `server/store-json.js`, `server/store-pg.js` | Added `hashResetToken`, updated `makeResetToken` to return `tokenHash`, stored hash, kept raw token only for reset URL/response, lookup supports hash+legacy raw. | **Fixed and partially verified.** `smoke.test.js` reset-token subtest passes; other smoke/security failures remain. |
| P1 | Missing HSTS header on secure requests. | `server/index.js` | Added `Strict-Transport-Security: max-age=31536000; includeSubDomains` when request is secure. | **Fixed but not fully verified** in production HTTPS environment. |
| P1 | No `npm test` script; tests existed but not easy to run. | `package.json` | Added `"test": "node --test tests/smoke.test.js tests/security.test.js"` and `"test:all"`. | **Fixed and verified** (script runs). |
| P1 | Brand palette inconsistencies (old navy/gold/cream values). | `assets/css/styles.css`, `pro-light.css`, `admin.css`, `lenders.css`, HTML files | Updated theme variables and replaced old brand hex/rgba values to align with #10294B/#D6A329/#FFFFFF. | **Fixed but not fully verified** by visual browser QA across all pages/viewports. |
| P1 | Hero copy/CTA not aligned with requested premium brand direction. | `index.html` | Updated hero headline/supporting copy and CTAs. | **Fixed but not fully verified** visually. |
| P1 | Footer did not meet requested premium navy style. | `assets/css/styles.css` | Restyled footer to navy background, white text, gold highlights. | **Fixed but not fully verified** visually. |
| P2 | Existing smoke/security tests failing (7 failing / 5 passing at time of check). | `tests/smoke.test.js`, `tests/security.test.js`, possibly related server/auth/store behavior | Not fully fixed. | **Not fixed.** Requires investigation. |
| P2 | Sitemap/robots/canonicals point to `as-financial-services-psi.vercel.app`. | `sitemap.xml`, `robots.txt`, HTML meta/canonicals (various) | Not changed; domain may be intentional or staging. | **Requires business-owner confirmation.** |
| P2 | Dirty working tree with many uncommitted changes. | Repository | No destructive cleanup. | **Not fixed / operational risk.** |

## 6. Security Findings

| Priority | Finding | Status |
|---|---|---|
| P0 | `.env` is present locally but ignored by `.gitignore`; no tracked `.env` found by `git ls-files`. | **Verified good practice; local secret hygiene still requires care.** |
| P0 | Auth/session endpoints use session checks, role checks, and CSRF on many mutating routes (spot-checked). | **Observed; not exhaustively verified.** |
| P1 | Reset token flow was improved to hashed storage/lookup. | **Fixed and partially verified.** |
| P1 | HSTS added for secure requests. | **Fixed but production-unverified.** |
| P1 | No CSP observed in inspected server header middleware; adding strict CSP can break inline scripts/styles and requires careful rollout. | **Not fixed.** |
| P1 | Dependency vulnerabilities not fully audited (`npm audit`/production scan) in this pass. | **Not fixed / unverified.** |
| P2 | Admin UI uses `innerHTML` in many places; many paths use escaping helpers, but a full XSS review is needed. | **Requires manual/security review.** |
| P2 | Rate limiting appears in-memory in places; serverless/distributed deployments need shared store/rate limiter. | **Known architectural limitation.** |

## 7. Backend and Database Findings

- Express app has JSON body limit, basic security headers, no-store on `/api`, CSRF middleware, session/role guards, rate limiting for enquiries/password/reset flows.
- JSON and Postgres store adapters exist; Postgres path not exercised in this audit.
- Reset-token lookup was made hash-aware with legacy raw fallback.
- **Unverified:** production DB connectivity, migrations, RLS/policies (if Supabase used), email delivery, file upload storage durability on Vercel.

## 8. Responsiveness Findings

- Responsive CSS/media queries exist across `styles.css`, `pro-light.css`, `admin.css`.
- **Not verified** by actual browser viewport testing at required breakpoints in this pass.
- **Recommendation:** run Playwright/BrowserStack/manual checks at 320/360/375/390/430/768/1024/1280/1440/1920.

## 9. SEO Findings

- `robots.txt` exists and disallows admin; includes sitemap URL.
- `sitemap.xml` exists with public pages/calculators.
- Pages contain meta/canonical/OG tags (spot-checked in index and prior project structure).
- **P2:** Domain in sitemap/robots/canonicals appears to be Vercel preview domain; confirm production domain before launch.
- **Unverified:** Search Console setup, structured data validity, indexing behavior.

## 10. Performance Findings

- Images/assets are local static files; some image optimization/lazy loading patterns exist.
- **Not verified:** Lighthouse, Core Web Vitals, bundle size, compression/caching on production CDN.
- **Recommendation:** run Lighthouse on production preview and optimize large hero/poster images.

## 11. Accessibility Findings

- Some semantic/ARIA attributes exist (skip link, labels, aria attributes observed in code).
- Brand color changes improved consistency; contrast should be rechecked, especially gold-on-white and white-on-gold/navy combinations.
- **Not verified:** full WCAG 2.2 AA audit, keyboard-only flow, screen reader pass.

## 12. Legal and Privacy Findings

- `privacy-policy.html` and `terms-of-use.html` exist.
- **Requires business-owner/legal confirmation:** company legal entity details, RBI/NBFC/DSA status claims, financial disclaimers, data retention, consent wording, DPDP compliance, cookie/analytics disclosures, third-party processor disclosures.
- **No fabricated certifications/reviews/stats were added.**

## 13. Deployment Findings

- `vercel.json` present; rewrites to `/api`.
- `.env` ignored; `.env.example` present.
- **Unverified:** custom domain, DNS, HTTPS cert, production env vars, production DB, email provider, CORS/origin config, logs, rollback/backups.

## 14. Tests Executed and Actual Results

| Command | Result | Notes |
|---|---|---|
| `git status --short` | **Executed** | Dirty working tree with many modified/untracked files. |
| `node --check server/index.js server/auth.js server/store-json.js server/store-pg.js` | **Pass** | Syntax checks passed. |
| `node --check assets/js/admin.js` / prior checks on changed JS | **Pass** (for files checked during session) | Not a full lint/test suite. |
| `node --test tests/smoke.test.js tests/security.test.js` | **Fail** | 12 tests, 5 pass, 7 fail, 0 skipped. Reset-token subtest passed after fix. Remaining failures need investigation. |
| Browser/responsive/Lighthouse/accessibility/manual E2E | **Not executed** | Requires browser/device/production-preview environment. |

## 15. Remaining Issues

- **P0/P1:** Investigate and fix 7 failing smoke/security tests.
- **P1:** Add/validate CSP carefully without breaking inline scripts.
- **P1:** Run dependency audit and patch vulnerabilities as appropriate.
- **P1:** Verify all forms end-to-end (contact/enquiry/reset/admin) in browser.
- **P1:** Confirm production domain and update sitemap/robots/canonicals/OG URLs.
- **P2:** Full responsive and accessibility QA across required breakpoints.
- **P2:** Performance/Core Web Vitals audit and image optimization.
- **P2:** Review admin innerHTML rendering for XSS safety.
- **P2:** Distributed rate limiting/session/security-state considerations for serverless production.

## 16. Manual Verification Required

- Business owner to confirm company legal/compliance statements, disclaimers, and service claims.
- Verify production domain, HTTPS, DNS, env vars, DB, mail delivery, and backups.
- Run browser QA on real devices/breakpoints.
- Run Lighthouse, axe/WCAG review, and security scan in staging/production preview.
- Verify no real customer data is sent during testing.

## 17. Final Launch Recommendation

**Recommendation: Do not mark as fully production-ready yet.**  

The codebase has meaningful improvements and core controls, but there are unresolved test failures, unverified deployment/production settings, and required legal/domain/manual QA confirmations. Proceed with a **staging/preview verification cycle**, fix remaining test failures, complete manual QA/security/accessibility/performance checks, then obtain explicit approval before live deployment.