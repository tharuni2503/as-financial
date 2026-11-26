'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('bundled lender directory still advertises 37 lenders in the expected categories', () => {
  const src = read('assets/js/lenders.js');
  const json = src.replace(/^\s*window\.AS_LENDERS\s*=\s*/, '').replace(/;\s*$/, '');
  const data = JSON.parse(json);
  assert.equal(data.list.length, 37, 'bundled fallback must contain all 37 lenders');
  assert.equal(data.list.filter((l) => l.c === 'psu').length, 10, 'public-sector count');
  assert.equal(data.list.filter((l) => l.c === 'private').length, 10, 'private-bank count');
  assert.equal(data.list.filter((l) => l.c === 'nbfc').length, 17, 'NBFC/HFC count');
});

test('empty lender state has no misleading copy in the initial DOM', () => {
  const html = read('index.html');
  const match = html.match(/<p[^>]*data-lp2-empty[^>]*>([\s\S]*?)<\/p>/);
  assert.ok(match, 'empty-state element is present');
  assert.match(match[0], /\bhidden\b/, 'empty state starts hidden');
  assert.match(match[0], /aria-hidden="true"/, 'empty state starts inaccessible to assistive tech');
  assert.equal(match[1].trim(), '', 'empty copy is rendered only by lenders-ui.js');
  assert.ok(!html.includes('No lender matches your search.'), 'static HTML cannot report no results before rendering');
});

test('lender renderer clears hidden empty copy and loads above the bundled fallback', () => {
  const html = read('index.html');
  const js = read('assets/js/lenders-ui.js');
  const bundledAt = html.indexOf('assets/js/lenders.js');
  const uiAt = html.indexOf('assets/js/lenders-ui.js');
  assert.ok(bundledAt > -1 && uiAt > -1, 'both lender scripts are loaded');
  assert.ok(bundledAt < uiAt, 'lenders.js must load before lenders-ui.js');
  assert.ok(js.includes('empty.textContent = copy'), 'empty copy is assigned only when shown');
  assert.ok(js.includes("if (matches.length) return '';"), 'hidden empty state is cleared');
  assert.ok(js.includes('empty.hidden = !copy;'), 'visibility still follows match results');
  assert.ok(js.includes('var list = Array.isArray(defaults.list) ? defaults.list.slice() : [];'), 'bundled list is the initial source');
  assert.ok(!js.includes('if (merged.length >= list.length) list = merged;'), 'backend data must be authoritative');
  assert.ok(js.includes('list = mapFromBackend(raw);'), 'a valid backend list replaces bundled data');
});

test('lenders content section accepts verbose admin and compact bundled shapes', () => {
  const validate = require('../server/validate');
  const verbose = [{
    id: 'LND-1',
    name: 'Admin Bank',
    category: 'psu',
    monogram: 'AB',
    color: '#123456',
    logo: 'assets/img/lenders/sbi.svg',
    rate: '8% p.a.',
    tenure: 'Up to 30 years',
    amount: '₹1 L – ₹5 Cr',
    fee: 'As applicable',
    benefits: ['Benefit one', 'Benefit two'],
    products: ['home', 'lap'],
    active: false,
    published: true,
    order: 4
  }];
  const out = validate.content('lenders', verbose);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Admin Bank');
  assert.equal(out[0].n, 'Admin Bank', 'short name alias preserved');
  assert.equal(out[0].category, 'psu');
  assert.equal(out[0].c, 'psu', 'short category alias preserved');
  assert.equal(out[0].active, false, 'hidden lenders stay hidden');
  assert.equal(out[0].published, true);
  assert.equal(out[0].order, 4);
  assert.deepEqual(out[0].benefits, ['Benefit one', 'Benefit two']);
  assert.deepEqual(out[0].products, ['home', 'lap']);

  const short = [{
    n: 'Compact NBFC', c: 'mystery', i: 'cn', k: '#abcdef',
    r: '9%', emi: 'Indicative*', t: '5 years', amt: '₹2 L', fee: 'Fee',
    b: ['x'], p: ['gold'], logo: ''
  }];
  const shortOut = validate.content('lenders', short);
  assert.equal(shortOut[0].name, 'Compact NBFC');
  assert.equal(shortOut[0].c, 'nbfc');
  assert.equal(shortOut[0].category, 'nbfc', 'unknown categories default to nbfc');
  assert.equal(shortOut[0].active, true);
  assert.equal(shortOut[0].published, true);
  assert.deepEqual(shortOut[0].b, ['x']);
});

test('lenders validator bounds lists and rejects unsafe values', () => {
  const validate = require('../server/validate');
  const many = Array.from({ length: 81 }, (_, i) => ({ name: 'Bank ' + i }));
  assert.throws(() => validate.content('lenders', many), /Too many lenders/);
  assert.throws(() => validate.content('lenders', [{ name: '' }]), /Missing lender name/);
  assert.throws(() => validate.content('lenders', [{ name: 'X', logo: 'https://example.test/x.png' }]), /Image must be/);

  const bounded = validate.content('lenders', [{
    name: 'Bounded Bank',
    benefits: Array(20).fill('benefit'),
    products: Array(30).fill('home')
  }]);
  assert.equal(bounded[0].benefits.length, 8);
  assert.equal(bounded[0].products.length, 12);
});

test('both datastores persist the lenders content section', () => {
  ['server/store-json.js', 'server/store-pg.js'].forEach((file) => {
    const src = read(file);
    assert.match(src, /const SECTIONS = \['testimonials', 'gallery', 'posts', 'lenders'\];/, file);
    assert.match(src, /return \{ testimonials: \[\], gallery: \[\], posts: \[\], lenders: \[\], images: \{\} \};/, file);
  });
});

test('lender storage and API keys remain unchanged', () => {
  assert.ok(read('assets/js/admin-sync.js').includes("as_lenders: 'lenders'"), 'localStorage bridge key');
  assert.ok(read('assets/js/admin.js').includes('api/content/lenders'), 'admin publish endpoint');
  assert.ok(read('assets/js/lenders-ui.js').includes("fetch('api/content'"), 'relative public endpoint');
  assert.ok(!read('assets/js/lenders-ui.js').includes("fetch('/api/content'"), 'no absolute public endpoint');
});

test('public directory treats a valid backend lender list as authoritative', () => {
  const js = read('assets/js/lenders-ui.js');
  assert.ok(js.includes('function isLenderPayload(arr)'), 'backend payload sanity check');
  assert.ok(js.includes('if (!isLenderPayload(raw)) { finishLoad(false); return; }'), 'malformed payloads fall back');
  assert.ok(js.includes('list = mapFromBackend(raw);'), 'valid backend list replaces bundled data');
  assert.ok(js.includes('if (loadState.pending && (!list || !list.length)'), 'bundled fallback is not resurrected after backend answers');
  assert.ok(js.includes('l.active !== false && l.published !== false'), 'hidden/inactive filtering preserved');
  assert.ok(!js.includes('mergeLenders'), 'old size guard and merge path removed');
  assert.ok(!js.includes('Math.random()'), 'ids must be stable');
});

test('SBI indicative EMI matches the displayed rate and 30-year range', () => {
  const src = read('assets/js/lenders.js');
  const json = src.replace(/^\s*window\.AS_LENDERS\s*=\s*/, '').replace(/;\s*$/, '');
  const data = JSON.parse(json);
  const sbi = data.list.find((l) => l.n === 'SBI');
  assert.ok(sbi, 'SBI is present');
  assert.equal(sbi.emi, 'From ~₹682/₹1L*');
  assert.ok(!src.includes('₹791/₹1L'), 'stale EMI must be removed');
});

test('lender empty copy distinguishes loading, no-match and unavailable states', () => {
  const js = read('assets/js/lenders-ui.js');
  assert.ok(js.includes("var LOADING_COPY = 'Loading lender options…';"));
  assert.ok(js.includes("var NO_MATCH_COPY = 'No lender matches your search."));
  assert.ok(js.includes("var UNAVAILABLE_COPY = 'Lender information is currently unavailable. Please refresh and try again.';"));
  assert.ok(js.includes('if (loadState.pending && !list.length) return LOADING_COPY;'));
  assert.ok(js.includes('if (!list.length && loadState.failed) return UNAVAILABLE_COPY;'));
  assert.ok(!js.includes('Lender information is loading. Please refresh if it does not appear.'));
  const loadingAt = js.indexOf('if (loadState.pending && !list.length) return LOADING_COPY;');
  const refreshAt = js.indexOf('if (!list.length && loadState.failed) return UNAVAILABLE_COPY;');
  assert.ok(loadingAt > -1 && refreshAt > loadingAt, 'loading copy takes precedence while pending');
});

test('lender normaliser coerces values and defaults unknown categories', () => {
  const js = read('assets/js/lenders-ui.js');
  assert.ok(js.includes('function str(value, fallback)'));
  assert.ok(js.includes("if (typeof value === 'object') return fallback;"));
  assert.ok(js.includes("var c = (str(l.c, '') || str(l.category, '') || 'nbfc').toLowerCase();"));
  assert.ok(js.includes("if (c !== 'psu' && c !== 'private' && c !== 'nbfc') c = 'nbfc';"));
});

test('lender cards expose lender-specific names and stable aria-controls ids', () => {
  const js = read('assets/js/lenders-ui.js');
  assert.ok(js.includes("esc('Details for ' + lenderName)"));
  assert.ok(js.includes("esc('Check options for ' + lenderName)"));
  assert.ok(js.includes('function detailsId(l, idx)'));
  assert.ok(js.includes("return 'lp2d-' + (slug || 'lender') + '-' + (idx + 1);"));
  assert.ok(js.includes('aria-controls=') && js.includes('esc(detailId)'));
  assert.ok(js.includes("toggle.setAttribute('aria-label',"));
  assert.ok(js.includes("grid.removeAttribute('aria-live')"), 'no noisy whole-grid announcements');
  assert.ok(!js.includes(".setAttribute('aria-live'"));
  assert.ok(js.includes("$$('[data-lp2-count]').forEach"), 'result count still rendered via existing text');
  assert.ok(js.includes("$$('[data-lp2-tabcount]').forEach"), 'per-tab counts still rendered');
});

test('apply popup product mapping uses existing labels and falls back cleanly', () => {
  const js = read('assets/js/lenders-ui.js');
  ['msme:', 'gold:', 'vehicle:'].forEach((key) => {
    assert.ok(js.includes(key), key + ' has an explicit candidate mapping');
  });
  assert.ok(js.includes("var PRODUCT_FALLBACK = 'Other / not sure';"));
  assert.ok(js.includes('var candidates = PRODUCT_LABELS[prodKey] || [];'));
  assert.ok(js.includes('if (sel) setApplyProduct(sel, prodKey);'), 'selection is always assigned, never left stale');
  assert.ok(js.includes('if (!target) {'), 'missing labels fall back');
  assert.ok(!js.includes("vehicle:'Car Loan'"), 'vehicle is not mislabelled as a car loan');
});

test('lender stylesheet keeps 44px touch targets and a 16px mobile search input', () => {
  const css = read('assets/css/lenders.css');
  assert.ok(!/!important/.test(css), 'no forced compact search/input rules');
  assert.ok(!/min-height:\s*(?:28|30|32|40)px/.test(css), 'no sub-44px min-height overrides');
  assert.match(css, /\.lp2-link, \.lp2-cta \{ min-height:44px; padding:0 14px; \}/);
  assert.match(css, /\.lp2-tab \{[^}]*min-height:44px/);
  assert.match(css, /#partners \.lp2-tab\{[^}]*min-height:44px/);
  assert.match(css, /\.lp2-search input\{[^}]*font-size:16px/);
  assert.ok(!css.includes('.lp2-card'), 'dead .lp2-card selector removed');
});
