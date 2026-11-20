# AS Financial Services & Solutions - website

Static marketing site for **AS Financial Services and Solutions**, Medipalli, Hyderabad, with an optional Node.js backend for publishing admin-managed content site-wide and capturing website enquiries.

## Pages

- `index.html` - home (hero, offerings, EMI calculator, gallery, reviews, FAQs, visit info)
- `about.html`, `loans.html`, `contact.html`
- `guides.html` - loan guides plus the calculators hub (`#calculators`)
- Calculator pages: `emi-calculator.html`, `balance-transfer-calculator.html`, `tenure-calculator.html`, `prepayment-calculator.html`, `buy-vs-rent-calculator.html`, `home-loan-tax-saving-calculator.html`
- `privacy-policy.html`, `terms-of-use.html`, `404.html`
- `admin.html` - admin dashboard (demo data in `localStorage`; connects to the backend when running)

## Run with the backend (recommended)

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open:

- Site: <http://localhost:3000/>
- Admin: <http://localhost:3000/admin.html>
- Health check: <http://localhost:3000/api/health> (shows `backend: "json"` or `backend: "postgres"`)

### Environment variables

- Copy `.env.example` to `.env` and fill in values. The server and migration script auto-load `.env` on startup.
- `DATABASE_URL` (or `POSTGRES_URL`): PostgreSQL connection string (Supabase/Neon/etc.). When set, the app uses Postgres and auto-migrates schema on boot; when unset, it uses `data/db.json`.
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: admin bootstrap/sign-in credentials. **`ADMIN_PASSWORD` is required when `NODE_ENV=production`.**
- `APP_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM`: optional password-reset email delivery (see below).
- For serverless/Vercel, prefer a **pooled** Postgres URI (e.g. Supabase transaction pooler, port 6543). Direct/session pooler URIs are fine for local/long-running servers. Set env vars in Vercel Project Settings and redeploy.

### What the backend does

- **Site-wide publishing**: testimonials, gallery posters, guides/posts, and homepage offering images saved in admin are stored on the server (`data/db.json`) and served to every visitor via `GET /api/content`.
- **Enquiry capture**: website enquiry forms post to `POST /api/enquiries` (stored server-side, rate-limited, with a honeypot). New enquiries also create an in-app notification record (admin store `notifications`) for staff follow-up. When signed in, admin/staff can view, update, and remove enquiries.
- **CRM/admin data collections**: server-backed collections for `leads`, `applications`, `products`, `partners`, `tasks`, `customers`, `documents`, `notifications`, and `settings` via `GET /api/admin/store` and `PUT /api/admin/store/:name` (RBAC-protected, CSRF-validated, audited).
- **Graceful fallback**: if the backend is not running, the site keeps working as a static demo - content falls back to browser `localStorage` and enquiries are saved on the device only.

### Admin sign-in

- Default demo credentials: `admin@asfinancial.in` / `AS@2026`
- Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables before using in production.
- The password is hashed in memory (scrypt) and sessions use short-lived bearer tokens.

### Password reset email (optional)

Configure SMTP to deliver password reset links by email (otherwise reset links are logged and, in non-production, returned by the API for development):

- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_USER`, `SMTP_PASS`
- `SMTP_SECURE` (`true` for port 465/implicit TLS)
- `MAIL_FROM` (sender address)
- `APP_URL` (public base URL used to build absolute reset links, e.g. `https://your-domain.example`)

### Data storage

- Stored in `data/db.json` (created automatically). A backup of the previous version is kept as `data/db.backup.json`.
- `data/` is git-ignored. This JSON-file store is ideal for local/self-hosted use. On Vercel serverless the filesystem is not durable, so use a hosted database (e.g. Postgres/Neon/Supabase or KV) for live publishing - the store module can be swapped to a database adapter without changing the API.

## Static-only preview

```bash
python -m http.server 4173
```

Then open <http://127.0.0.1:4173/>.

## Deployment (Vercel)

- Import/connect the repository under **Project -> Settings -> Git** (production branch `main`).
- `vercel.json` enables clean URLs, long-lived caching for `/assets`, no-cache HTML, security headers, and redirects `/calculators` to `/guides#calculators`.
- `sitemap.xml` and `robots.txt` reference `https://as-financial-services-psi.vercel.app/`. Update these if the domain changes.
- To run the Node backend on Vercel you need a server/adapter deployment and a durable database; without it the site deploys and runs in static/demo mode.

### Admin utilities

- `GET /api/admin/export` (super_admin, authenticated session): exports content, admin collections, enquiries, sanitized users, recent audit entries, and stats for backup/migration planning. Secrets (password hashes/salts/reset tokens) are not included.

### JSON → PostgreSQL migration

When `DATABASE_URL`/`POSTGRES_URL` is configured, you can import existing JSON data into Postgres (auto-migrates schema first):

```bash
# preview
node server/migrate-json-to-pg.js --dry-run

# import from local data/db.json (full: users/credentials, sessions, audit, security)
DATABASE_URL=postgres://... node server/migrate-json-to-pg.js

# import from a specific file (e.g. a saved export or db snapshot)
DATABASE_URL=postgres://... node server/migrate-json-to-pg.js path/to/data.json
```

- Prefer `data/db.json` for a complete migration. Snapshots from `GET /api/admin/export` are sanitized (no password hashes/salts, reset tokens, sessions, or security state) and cannot restore credentials/sessions.
- Safe to re-run for most entities (upserts / conflict-safe inserts where applicable). Verify with `GET /api/health` (`backend: "postgres"`).

## Notes

- No build step. Calculator output is indicative; final rates and eligibility depend on the lender and the customer's profile.

## Business details

Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098  
Phone: +91 91827 03079 | Mon-Sat, 9:30 AM-7:00 PM  
Email: asfinancialservicesandsolution@gmail.com  
