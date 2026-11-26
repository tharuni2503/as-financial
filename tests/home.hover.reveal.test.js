'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-hover-reveal.css');
const js = read('assets/js/home-hover-reveal.js');

test('the selected hover reveal is mounted on the original hero frame only', () => {
  assert.equal((html.match(/data-hover-reveal/g) || []).length, 1);
  assert.match(html, /<figure class="hero-clean-frame" data-hover-reveal data-portal-hero>/);
  assert.match(html, /<img class="parallax-y" src="assets\/img\/hero-family-home\.jpg"/);
  assert.match(html, /<figcaption class="hero-clean-caption">/);
  assert.ok(html.includes('assets/css/home-hover-reveal.css'));
  assert.ok(html.includes('assets/js/home-hover-reveal.js'));
});

test('the goo mask and alternate image preserve the original frame layout', () => {
  assert.match(css, /\.hero-clean-frame\[data-hover-reveal\] \{\s*isolation: isolate;/);
  assert.match(css, /-webkit-mask: url\(#hr-blob-mask\)/);
  assert.match(css, /mask: url\(#hr-blob-mask\)/);
  assert.match(html, /feGaussianBlur[^>]*stdDeviation="10"/);
  assert.match(html, /feColorMatrix[^>]*values="1 0 0 0 0/);
  assert.match(css, /background-image: url\('\.\.\/img\/advisor\.jpg'\)/);
  assert.match(css, /background-size: cover/);
  assert.ok(!/width:|height:|padding:|margin:/.test(css.split('.hr-reveal-image')[1].split('}')[0]));
});

test('the three spring followers match the selected animation', () => {
  assert.match(js, /stiffness: 200, damping: 25, mass: 0\.5/);
  assert.match(js, /stiffness: 150, damping: 30, mass: 0\.8/);
  assert.match(js, /stiffness: 100, damping: 35, mass: 1/);
  assert.match(js, /circles\.length !== 3/);
  assert.match(js, /pointerenter/);
  assert.match(js, /pointermove/);
  assert.match(js, /pointerleave/);
});

test('touch, reduced-motion and no-JS users keep the static hero', () => {
  assert.match(js, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /display: none !important/);
  assert.match(js, /root\.classList\.add\('home-hover-reveal-ready'\)/);
  assert.match(css, /\.home-hover-reveal-ready \.hero-clean-frame\[data-hover-reveal\]\.is-hr-active \.hr-reveal/);
});

test('the hover reveal makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase/.test(js));
  assert.ok(!/data-lead-form|data-popup-open|<form/.test(html.split('<figure class="hero-clean-frame" data-hover-reveal data-portal-hero>')[1].split('</figure>')[0]));
});
