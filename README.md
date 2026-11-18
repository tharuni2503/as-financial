# AS Financial Services & Solutions — website

Static marketing site for **AS Financial Services and Solutions**, Medipalli, Hyderabad.

## Pages

- `index.html` — home (hero, offerings, EMI calculator, gallery, reviews, FAQs, visit info)
- `about.html`, `loans.html`, `contact.html`
- `guides.html` — loan guides plus the calculators hub (`#calculators`)
- Calculator pages: `emi-calculator.html`, `balance-transfer-calculator.html`, `tenure-calculator.html`, `prepayment-calculator.html`, `buy-vs-rent-calculator.html`, `home-loan-tax-saving-calculator.html`
- `privacy-policy.html`, `terms-of-use.html`, `404.html`
- `admin.html` — front-end demo dashboard (no backend)

## Features

- Light navy/gold theme, responsive from 360 px to 1920 px
- Loan calculators, FAQ accordions, forms with inline validation
- Gallery lightbox, Google review section, back-to-top control
- Accessible navigation, skip link, keyboard focus states, reduced-motion support
- LocalBusiness JSON-LD, Open Graph tags, favicon, `robots.txt` and `sitemap.xml`

## Local preview

```bash
python -m http.server 4173
```

Then open <http://127.0.0.1:4173/>.

## Deployment (Vercel)

- Import the repository or connect it under **Project → Settings → Git** (production branch `main`); no build step is required.
- `vercel.json` enables clean URLs, long-lived caching for `/assets`, no-cache HTML, security headers, and redirects the old `/calculators` URL to `/guides#calculators`.
- `sitemap.xml` and `robots.txt` reference `https://as-financial-services-psi.vercel.app/`. If the site moves to a custom domain, update those URLs (and add that domain in Vercel).

## Notes

- No build step or dependencies; deploy the repository root as a static site.
- Forms and the admin dashboard store data in `localStorage` only. A backend is required for real lead capture, authentication, notifications, and site-wide (public) content publishing.
- Calculator output is indicative; final rates and eligibility depend on the lender and the customer's profile.

## Business details

Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098
Phone: +91 91827 03079 · Mon–Sat, 9:30 AM–7:00 PM
Email: asfinancialservicesandsolution@gmail.com
