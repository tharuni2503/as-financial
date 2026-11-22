# Release Checklist (AS Financial Services)

This checklist tracks code-ready vs environment/manual verification items. Do not mark “production ready” without deployed evidence.

## Code-ready (verify on deploy)

- [x] Production requires `DATABASE_URL`/`POSTGRES_URL` (no JSON fallback in prod)
- [x] Migration history + advisory lock (`schema_migrations`)
- [x] Shared atomic rate limiting (`rate_limits`) for login/enquiry/track/password/reset
- [x] CSRF on mutating admin endpoints; RBAC server-side
- [x] Strong password validation; reset/change revokes sessions
- [x] Generic 500 API errors; baseline security headers/CSP
- [x] Upload MIME allowlist + magic-byte checks; fail closed in prod/serverless until durable storage configured
- [x] Public form success only after confirmed server storage; server-side enquiry dedupe
- [x] No PII in key server logs; hashed IP in analytics; analytics privacy notice
- [x] Sitemap/robots/canonicals/titles/descriptions present
- [x] Smoke tests pass: `node --test tests/smoke.test.js`
- [x] `npm audit --omit=dev` clean (nodemailer 10.6.1)

## Environment / ops (blocked without access)

- [ ] Vercel Production + Preview env vars set (`DATABASE_URL`/pooler, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, mail/Turnstile/Google/WhatsApp as needed)
- [ ] Supabase backups/PITR enabled; restore drill completed with evidence
- [ ] Durable upload storage configured (S3/Supabase Storage/Vercel Blob) before enabling production document uploads
- [ ] Domain redirects/canonical host verified on Vercel
- [ ] Previous Vercel deployment identified for rollback

## Deployed verification

- [ ] `GET /api/health` returns ok and expected backend
- [ ] All public forms submit to DB and appear in admin; duplicate submission blocked; failure preserves input
- [ ] Login/logout/reset/change-password/session expiry/revocation verified across instances
- [ ] Rate limiting verified in deployed environment
- [ ] Email/WhatsApp/Turnstile/Google review integrations verified with real credentials
- [ ] No PII in deployed logs/analytics exports

## Manual QA / P1-P3

- [ ] Responsive: 360/390/768/1024/desktop; no overflow/overlap
- [ ] A11y: labels, keyboard, focus-visible, SR announcements, WCAG AA contrast, reduced motion, 44px targets
- [ ] Performance: hero/LCP, image dimensions/lazy/WebP/AVIF, unused CSS/JS review, Lighthouse mobile+desktop
- [ ] SEO: unique meta/OG/schema per page, sitemap/robots/live canonicals, broken-link crawl
- [ ] Security: dependency review, CSP tightening, RBAC matrix test, upload storage hardening
- [ ] Rollback drill: redeploy previous Vercel build; confirm DB migration compatibility

## Rollback

1. In Vercel, promote the previous healthy deployment to Production.
2. If a migration was applied, confirm it is backward-compatible; otherwise restore DB from backup/PITR per ops procedure.
3. Verify `/api/health`, login, and a test enquiry after rollback.
