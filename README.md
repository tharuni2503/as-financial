# AS Financial Services & Solutions — website

Static marketing site for **AS Financial Services and Solutions**, Medipalli, Hyderabad.

## Pages

- `index.html` — home
- `about.html`, `loans.html`, `contact.html`
- `calculators.html` + 11 calculator pages (EMI, balance transfer, tenure, prepayment, buy vs rent, tax saving, and more)
- `guides.html`, `privacy-policy.html`, `terms-of-use.html`, `404.html`
- `admin.html` — front-end demo dashboard (no backend)

## Features

- Light navy/gold theme, responsive from 360 px to 1920 px
- Loan calculators, FAQ accordions, forms with inline validation
- Gallery lightbox, Google review section
- Accessible navigation, skip link, keyboard focus states, reduced-motion support
- LocalBusiness JSON-LD, Open Graph tags, favicon and robots.txt

## Local preview

```bash
python -m http.server 4173
```

Then open <http://127.0.0.1:4173/>.

## Notes

- No build step or dependencies; deploy the repository root as a static site (e.g. Vercel).
- Forms and the admin dashboard store data in `localStorage` only. A backend is required for real lead capture, authentication and notifications.
- Calculator output is indicative; final rates and eligibility depend on the lender and the customer's profile.

## Business details

Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098
Phone: +91 91827 03079 · Mon–Sat, 9:30 AM–7:00 PM
Email: asfinancialservicesandsolution@gmail.com
