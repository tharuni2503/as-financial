'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const publicPages = [
  '404.html',
  'about.html',
  'balance-transfer-calculator.html',
  'buy-vs-rent-calculator.html',
  'contact.html',
  'emi-calculator.html',
  'guides.html',
  'home-loan-tax-saving-calculator.html',
  'index.html',
  'loans.html',
  'prepayment-calculator.html',
  'privacy-policy.html',
  'tenure-calculator.html',
  'terms-of-use.html'
];

test('public pages load the current scroll polish layer', () => {
  for (const page of publicPages) {
    const html = read(page);
    assert.match(html, /assets\/css\/scroll-polish\.css\?v=20261127g/, page + ' CSS cache key');
    assert.match(html, /assets\/js\/scroll-polish\.js\?v=20261127g/, page + ' JS cache key');
  }

  assert.doesNotMatch(read('admin.html'), /scroll-polish/, 'public motion layer stays off admin');
});

test('reveal state does not collide with the offering popup state', () => {
  const css = read('assets/css/scroll-polish.css');
  const js = read('assets/js/scroll-polish.js');
  const theme = read('assets/css/pro-light.css');

  assert.doesNotMatch(css, /sp-reveal\.is-revealed/, 'polish CSS no longer uses the popup state for reveals');
  assert.doesNotMatch(js, /is-revealed/, 'polish JS no longer uses the popup state');
  assert.match(css, /\.sp-in/, 'polish CSS uses its own reveal state');
  assert.match(js, /classList\.toggle\('sp-in'/, 'polish JS toggles its own reveal state');
  assert.match(js, /window\.setTimeout\(revealVisible, 120\)/, 'visible content has a reveal fallback');
  assert.match(theme, /\.pcard\.is-revealed \.pcard-popup/, 'existing popup state is preserved');
});

test('homepage offerings keep every card and control', () => {
  const html = read('index.html');
  const products = html.match(/<section[\s\S]*?id="products"[\s\S]*?<\/section>/);
  assert.ok(products, 'products section is present');

  const section = products[0];
  assert.equal((section.match(/class="pcard reveal"/g) || []).length, 12, 'all 12 offerings remain');
  assert.match(section, /data-products-more/, 'show more control remains');
  assert.match(section, /class="profiles reveal"/, 'specialised profiles panel remains');
});
