'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const readHtml = (f) => read(f);

const coreCss = read('assets/css/styles.css');
const themeCss = read('assets/css/pro-light.css');
const mainJs = read('assets/js/main.js');
const assistantJs = read('assets/js/assistant.js');
const validate = require('../server/validate');

const STALE_PALETTE = [
  '#10294B', '#C9A227', '#c9a227', '#D6A329', '#d6a329',
  'rgba(214, 163, 41', 'rgba(214,163,41',
  'rgba(16, 41, 75', 'rgba(16,41,75'
];

test('shared stylesheets declare the exact canonical brand tokens', () => {
  for (const [name, css] of [['styles.css', coreCss], ['pro-light.css', themeCss]]) {
    for (const token of [
      '--navy: #101F38;',
      '--gold: #C49A45;',
      '--bg: #F5F6F8;',
      '--ink: #202938;',
      '--muted: #667085;',
      "--sans: 'Manrope'",
      "--serif: 'Manrope'"
    ]) {
      assert.ok(css.includes(token), `${name} is missing ${token}`);
    }
    for (const stale of STALE_PALETTE) {
      assert.ok(!css.includes(stale), `${name} still contains legacy palette value ${stale}`);
    }
    assert.ok(!/Playfair|Instrument Serif/i.test(css), `${name} still requests a legacy display font`);
  }
  assert.equal(themeCss.match(/^:root \{/gm).length, 1, 'theme tokens are consolidated into one :root block');
  assert.match(themeCss, /html \{ color-scheme: light; \}/);
});

test('every page uses the canonical theme colour and a Manrope-only webfont', () => {
  assert.ok(htmlFiles.length >= 15, 'all public and admin pages were discovered');
  for (const file of htmlFiles) {
    const html = readHtml(file);
    assert.match(html, /<meta name="theme-color" content="#101F38">/, `${file} theme colour`);
    assert.match(html, /fonts\.googleapis\.com\/css2\?family=Manrope:wght@400;500;600;700;800&display=swap/, `${file} Manrope request`);
    assert.ok(!/Playfair|Instrument Serif/i.test(html), `${file} has no legacy font request`);
  }
});

test('every local stylesheet and script uses the current cache key', () => {
  for (const file of htmlFiles) {
    const html = readHtml(file);
    const refs = html.match(/(?:href|src)="assets\/(?:css|js)\/[^"]+"/g) || [];
    assert.ok(refs.length > 0, `${file} loads local assets`);
    for (const ref of refs) {
      assert.match(ref, /\?v=20261126e/, `${file} stale cache key on ${ref}`);
    }
    const keys = html.match(/\?v=[0-9A-Za-z]+/g) || [];
    for (const key of keys) {
      assert.equal(key, '?v=20261126e', `${file} has an out-of-date cache key ${key}`);
    }
  }
});

test('the assistant contact-form anchor resolves to the real enquiry form', () => {
  assert.match(read('contact.html'), /<form[^>]*id="contact-form"[^>]*data-lead-form/, 'contact form anchor exists');
  assert.match(assistantJs, /contact\.html#contact-form/, 'assistant links to that anchor');
});

test('contact form amount choices pass enquiry validation', () => {
  const contact = read('contact.html');
  const select = (contact.match(/<select id="ct-amount"[^>]*>[\s\S]*?<\/select>/) || [''])[0];
  const labels = Array.from(select.matchAll(/<option[^>]*>([^<]+)<\/option>/g)).map(m => m[1].trim());
  assert.ok(labels.length >= 5, 'loan amount choices were discovered');
  for (const amount of labels) {
    assert.doesNotThrow(() => validate.enquiry({
      name: 'QA User',
      phone: '9182703079',
      product: 'Home Loan',
      amount,
      consent: true
    }), `amount choice "${amount}" should validate`);
  }
  assert.throws(() => validate.enquiry({
    name: 'QA User',
    phone: '9182703079',
    product: 'Home Loan',
    amount: '<script>alert(1)</script>',
    consent: true
  }), /valid requested amount/);
});

test('homepage testimonials are published-only and the process is an ordered list', () => {
  const home = read('index.html');
  const openTag = (home.match(/<section[^>]*id="testimonials"[^>]*>/) || [''])[0];
  assert.match(openTag, /\bhidden\b/, 'testimonials section is hidden until items are published');
  const grid = (home.match(/<div class="testi-grid" data-testimonials>[\s\S]*?<\/div>/) || [''])[0];
  assert.ok(grid.includes('sr-only'), 'empty grid has a screen-reader fallback');
  assert.ok(!grid.includes('testi-card'), 'no hard-coded testimonials remain');
  assert.match(home, /<ol class="process-flow" aria-label="Loan process steps">/, 'process uses ordered-list semantics');
  assert.ok(!home.includes('<div class="process-flow"'), 'process is no longer an unlabelled div');
  assert.match(mainJs, /if \(section\) section\.hidden = false;/, 'published items unhide the section');
});

test('assistant links are allowlisted and the panel closes on Escape', () => {
  assert.match(assistantJs, /function safeHref\(href\)/, 'link allowlist exists');
  assert.ok(assistantJs.includes('tel:\\+?\\d{8,15}'), 'tel links are allowlisted');
  assert.match(assistantJs, /wa\.me/, 'WhatsApp links are allowlisted');
  assert.match(assistantJs, /rel="noopener noreferrer"/, 'external links are isolated');
  assert.match(assistantJs, /messages\.setAttribute\('aria-live', 'polite'\)/, 'replies are announced');
  assert.match(assistantJs, /event\.key === 'Escape'/, 'Escape closes the panel');
  assert.match(assistantJs, /aria-label="Your name"/, 'mini lead form labels its name field');
  assert.match(assistantJs, /aria-label="Mobile number"/, 'mini lead form labels its phone field');
  assert.match(assistantJs, /aria-label="Loan type"/, 'mini lead form labels its select');
});

test('phone validation normalises +91 and requires a 10-digit Indian mobile number', () => {
  assert.match(mainJs, /function phoneDigits\(value\)[\s\S]{0,240}digits\.slice\(2\)/, 'leading 91 is stripped');
  assert.match(mainJs, /function phoneDigits\(value\)[\s\S]{0,300}digits\.slice\(3\)/, 'leading 091 is stripped');
  assert.match(mainJs, /\/\^\[6-9\]\\d\{9\}\$\//, 'main form enforces a 10-digit Indian mobile');
  assert.match(assistantJs, /\/\^\[6-9\]\\d\{9\}\$\//, 'assistant mini form enforces the same rule');
});

test('inline validation preserves existing aria-describedby references', () => {
  for (const helper of ['describedIds', 'addDescribedBy', 'removeDescribedBy']) {
    assert.match(mainJs, new RegExp(`function ${helper}\\(`), `${helper} helper exists`);
  }
  assert.match(mainJs, /fieldErrorEl\(control, false\)/, 'clearing does not create an error node');
  assert.match(mainJs, /removeDescribedBy\(control, el\.id\)/, 'clearing removes only its own error id');
  assert.match(mainJs, /form\.querySelectorAll\('\[aria-invalid="true"\]'\)\.forEach\(clearFieldError\)/, 'submit reset uses the preserving helper');
  assert.ok(!mainJs.includes("control.setAttribute('aria-describedby', el.id)"), 'no direct overwrite of aria-describedby remains');
});

test('calculator reset restores tenure units and native range attributes', () => {
  assert.match(mainJs, /root\.dataset\.defaultTenureUnit = unit/, 'default unit is captured');
  assert.match(mainJs, /tenure\.dataset\[key\] = tenure\.getAttribute\(attr\)/, 'min/max/step defaults are captured');
  assert.match(mainJs, /root\.addEventListener\('calc:reset'/, 'calculator listens for the reset event');
  assert.match(mainJs, /dispatchEvent\(new CustomEvent\('calc:reset'/, 'reset button broadcasts the event');
  assert.match(mainJs, /btn\.setAttribute\('aria-pressed', String\(active\)\)/, 'tenure unit buttons expose pressed state');
  assert.ok(!mainJs.includes("item.addEventListener('mouseenter'"), 'FAQ panels no longer open on hover');
});

test('public controls keep 44px touch targets', () => {
  assert.match(coreCss, /\.nav-link[\s\S]{0,180}min-height: 44px/, 'core nav links have 44px targets');
  assert.match(themeCss, /input, select, textarea, \.btn, button \{ min-height: 44px; \}/, 'mobile controls have 44px targets');
  assert.match(themeCss, /\.nav-link,\.dropdown a,\.mobile-nav a\{min-height:44px/, 'mobile navigation has 44px targets');
  assert.match(read('assets/css/lenders.css'), /\.lp2-tab \{[^}]*min-height:44px/, 'lender tabs have 44px targets');
});

test('no stale or unsupported public copy remains', () => {
  const staleCopy = [
    'Free eligibility check',
    "Let's find your best loan.",
    'lowest rates',
    'guaranteed approval',
    'instant approval',
    'save you lakhs',
    'negotiate on your behalf'
  ];
  for (const file of htmlFiles) {
    const html = readHtml(file);
    for (const copy of staleCopy) {
      assert.ok(!html.toLowerCase().includes(copy.toLowerCase()), `${file} still contains "${copy}"`);
    }
  }
});
