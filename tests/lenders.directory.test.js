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
  assert.ok(js.includes('empty.textContent = noMatch'), 'empty copy is assigned only when shown');
  assert.ok(js.includes("        : '';"), 'hidden empty state is cleared');
  assert.ok(js.includes('empty.hidden = !noMatch;'), 'visibility still follows match results');
  assert.ok(js.includes('var list = Array.isArray(defaults.list) ? defaults.list.slice() : [];'), 'bundled list is the initial source');
  assert.ok(js.includes('if (merged.length >= list.length) list = merged;'), 'backend data cannot shrink the bundled set');
});
