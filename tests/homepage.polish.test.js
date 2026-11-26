'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/pro-light.css');

test('homepage loads the polished stylesheet with a fresh cache key', () => {
  assert.match(html, /assets\/css\/styles\.css\?v=20261126e/, 'core stylesheet cache-busted');
  assert.match(html, /assets\/css\/pro-light\.css\?v=20261126e/, 'theme stylesheet cache-busted');
  const coreAt = html.indexOf('assets/css/styles.css');
  const themeAt = html.indexOf('assets/css/pro-light.css');
  assert.ok(coreAt > -1 && themeAt > coreAt, 'pro-light still overrides the core stylesheet');
});

test('homepage headings use the Manrope sans stack with a gold accent', () => {
  assert.match(css, /body\.page-home \{[\s\S]{0,120}font-family:\s*var\(--sans\)/, 'body uses Manrope');
  assert.match(css, /body\.page-home h1,[\s\S]{0,220}font-family:\s*var\(--sans\)/, 'headings use Manrope');
  assert.match(css, /body\.page-home \.serif \{[\s\S]{0,180}font-style:\s*normal/, 'serif accent no longer forces a second family');
  assert.match(css, /body\.page-home \.serif \{[\s\S]{0,180}color:\s*var\(--gold-deep\)/, 'muted gold accent is retained');
});

test('desktop hero and section headings match the agreed type scale', () => {
  assert.match(css, /body\.page-home \.hero2 h1 \{\s*font-size:\s*clamp\(3rem,\s*4\.4vw,\s*3\.5rem\)/, 'hero is 48-56px on desktop');
  assert.match(
    css,
    /body\.page-home \.section-head h2,[\s\S]{0,320}font-size:\s*clamp\(2\.125rem,\s*3\.05vw,\s*2\.5rem\)/,
    'section headings are 34-40px on desktop'
  );
});

test('mobile hero and section headings stay readable without shrinking below target', () => {
  assert.match(
    css,
    /body\.page-home \.hero2 h1 \{\s*font-size:\s*clamp\(2\.125rem,\s*8\.6vw,\s*2\.375rem\)/,
    'hero is 34-38px on phones'
  );
  assert.match(
    css,
    /font-size:\s*clamp\(1\.75rem,\s*4\.6vw,\s*1\.875rem\)/,
    'section headings are 27-30px on phones'
  );
  assert.match(css, /font-size:\s*\.96875rem/, 'mobile body copy is 15-16px');
});

test('homepage labels are at least 13px, including ID-specific eyebrows', () => {
  for (const selector of [
    'body.page-home .eyebrow,',
    'body.page-home #products .eyebrow,',
    'body.page-home .pill,',
    'body.page-home .hero-clean-caption span,',
    'body.page-home .pgrid .pcard .tag,',
    'body.page-home .pgrid .pcard li'
  ]) {
    assert.ok(css.includes(selector), 'label rule present: ' + selector);
  }
  assert.match(css, /font-size:\s*\.8125rem/, 'small labels share a 13px scale');
});

test('product images and vertical spacing are consistent on small screens', () => {
  assert.match(
    css,
    /body\.page-home \.pgrid \.pcard-media:not\(\.icon-only\) \{\s*aspect-ratio:\s*16 \/ 10/,
    'card media keeps a readable 16:10 crop'
  );
  assert.match(css, /max-height:\s*220px/, 'compact cards no longer collapse to 110px');
  assert.match(
    css,
    /body\.page-home #why-us \.split-media img \{\s*aspect-ratio:\s*4 \/ 3/,
    'why-us image no longer stretches into a tall crop'
  );
  assert.match(css, /body\.page-home \.section \{\s*padding:\s*clamp\(56px,\s*5vw,\s*72px\)/, 'section rhythm is explicit');
  assert.match(css, /body\.page-home \.section \{\s*padding:\s*48px 0/, 'mobile section rhythm is explicit');
});
