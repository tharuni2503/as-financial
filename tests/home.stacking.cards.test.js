'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-stacking-cards.css');
const js = read('assets/js/home-stacking-cards.js');
const stacking = require('../assets/js/home-stacking-cards.js');

/* ---------- source-exact values ---------- */

test('the scrub uses the selected source scale and brightness values', () => {
  assert.equal(stacking.SCALE_END, 0.95);
  assert.equal(stacking.BRIGHTNESS_END, 0.5);
  assert.deepEqual(stacking.styleFor(0), { scale: 1, brightness: 1 });
  assert.deepEqual(stacking.styleFor(1), { scale: 0.95, brightness: 0.5 });
  assert.deepEqual(stacking.styleFor(0.5), { scale: 0.975, brightness: 0.75 });
});

test('the trigger runs from top bottom to top top of the next card', () => {
  assert.equal(stacking.progressFor(1200, 1200), 0);
  assert.equal(stacking.progressFor(600, 1200), 0.5);
  assert.equal(stacking.progressFor(0, 1200), 1);
  assert.equal(stacking.progressFor(-200, 1200), 1);
  assert.equal(stacking.progressFor(2000, 1200), 0);
  assert.equal(stacking.progressFor(0, 0), 0);
  assert.equal(stacking.clamp(3), 1);
  assert.equal(stacking.clamp(-2), 0);
});

/* ---------- restoration and layout safeguards ---------- */

test('the effect is mounted once on the original FAQ list', () => {
  assert.equal((html.match(/data-stacking-cards/g) || []).length, 1);
  assert.match(html, /<div class="faq-list reveal" data-stacking-cards>/);
  assert.equal((html.match(/class="faq-item open"/g) || []).length, 1);
  assert.equal((html.match(/class="faq-item"/g) || []).length, 4);
  assert.ok(html.includes('assets/css/home-stacking-cards.css'));
  assert.ok(html.includes('assets/js/home-stacking-cards.js'));
});

test('only transform and filter are animated; no box dimensions are written', () => {
  assert.match(css, /\.home-stacking-ready \[data-stacking-cards\] \.faq-item \{/);
  assert.match(css, /transform-origin: center top/);
  assert.match(css, /will-change: transform, filter/);
  assert.match(js, /items\[i\]\.style\.transform = p > 0 \? 'scale\(' \+ style\.scale\.toFixed\(4\) \+ '\)'/);
  assert.match(js, /items\[i\]\.style\.filter = p > 0 \? 'brightness\(' \+ style\.brightness\.toFixed\(4\) \+ '\)'/);
  assert.ok(!/width|height|padding|margin|position|display/.test(css.split('}')[0]));
});

test('the existing cinema hooks stay in their own controller', () => {
  const cinema = read('assets/js/home-cinema.js');
  assert.match(cinema, /'--hero-type-y'/);
  assert.match(cinema, /'--manifesto-wipe'/);
  assert.match(cinema, /'--rail-x'/);
  assert.match(cinema, /'--packet-meter'/);
  assert.match(cinema, /classList\.toggle\('is-active', active\)/);
  assert.ok(!/stacking|faq-item/.test(cinema));
});

/* ---------- motion, responsive and functional safeguards ---------- */

test('the effect runs only for fine pointers on wide, no-preference screens', () => {
  assert.match(js, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(js, /matchMedia\('\(min-width: 701px\)'\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(js, /if \(!allowed\(\) \|\| root\.classList\.contains\('home-stacking-ready'\)\) return null;/);
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /transform: none !important/);
  assert.match(css, /filter: none !important/);
});

test('the scrub follows scroll and reverse scroll through one animation frame', () => {
  assert.match(js, /listen\(window, 'scroll', schedule, \{ passive: true \}\)/);
  assert.match(js, /listen\(window, 'resize', schedule, \{ passive: true \}\)/);
  assert.match(js, /items\[i \+ 1\]\.getBoundingClientRect\(\)\.top/);
  assert.match(js, /state\.progress\[i\] = p/);
  assert.ok(!/window\.scrollTo/.test(js));
});

test('preference changes and page hide tear the effect down cleanly', () => {
  assert.match(js, /query\.addEventListener\('change', onPreferenceChange\)/);
  assert.match(js, /window\.cancelAnimationFrame\(raf\)/);
  assert.match(js, /item\.style\.removeProperty\('transform'\)/);
  assert.match(js, /item\.style\.removeProperty\('filter'\)/);
  assert.match(js, /window\.addEventListener\('pagehide'/);
});

test('the stacking controller makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase/.test(js));
});
