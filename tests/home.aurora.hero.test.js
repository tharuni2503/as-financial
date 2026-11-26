'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-aurora-hero.css');
const js = read('assets/js/home-aurora-hero.js');
const aurora = require('../assets/js/home-aurora-hero.js');

/* ---------- pointer offset maths ---------- */

test('aurora pointer offsets are bounded and centred at the hero middle', () => {
  const rect = { left: 100, top: 200, width: 800, height: 400 };
  assert.deepEqual(aurora.offsetFor(500, 400, rect), { x: 0, y: 0 });
  assert.deepEqual(aurora.offsetFor(100, 200, rect), { x: -12, y: -12 });
  assert.deepEqual(aurora.offsetFor(900, 600, rect), { x: 12, y: 12 });
  assert.deepEqual(aurora.offsetFor(500, 400, rect, 6), { x: 0, y: 0 });
  assert.deepEqual(aurora.offsetFor(500, 400, null), { x: 0, y: 0 });
  assert.equal(aurora.clamp(-2), 0);
  assert.equal(aurora.clamp(3), 1);
});

/* ---------- restoration and layout safeguards ---------- */

test('the aurora is mounted behind the original hero, not around the page', () => {
  assert.equal((html.match(/data-aurora-hero/g) || []).length, 1);
  assert.equal((html.match(/class="au-aurora"/g) || []).length, 1);
  assert.match(html, /<section class="hero2 hero-clean" id="hero" data-aurora-hero>/);
  assert.match(html, /<div class="au-blade au-core"><\/div>/);
  assert.match(html, /<div class="au-blade au-b4"><\/div>/);
  assert.match(html, /<h1>Your Financial Goals, <span class="serif">Our Trusted Solutions\.<\/span><\/h1>/);
  assert.ok(html.includes('assets/css/home-aurora-hero.css'));
  assert.ok(html.includes('assets/js/home-aurora-hero.js'));
});

test('the aurora layer is absolute and writes no box dimensions', () => {
  const rule = css.split('.au-aurora {')[1].split('}')[0];
  assert.match(rule, /position: absolute/);
  assert.match(rule, /inset: -30%/);
  assert.match(rule, /pointer-events: none/);
  assert.match(rule, /opacity: 0/);
  assert.ok(!/width:|height:|padding:|margin:/.test(rule));
  assert.match(css, /\.home-aurora-ready \.hero2\[data-aurora-hero\]\.is-au-active \.au-aurora \{\s*opacity: \.26;/);
});

test('the five blades keep the selected source timings', () => {
  assert.equal((css.match(/animation: au-drift[1-4] /g) || []).length, 4);
  assert.match(css, /au-drift1 18s ease-in-out infinite alternate/);
  assert.match(css, /au-drift2 21s ease-in-out infinite alternate/);
  assert.match(css, /au-drift3 15s ease-in-out infinite alternate/);
  assert.match(css, /au-drift4 22s ease-in-out infinite alternate/);
  assert.match(css, /au-breathe 16s ease-in-out infinite alternate/);
  assert.equal((css.match(/@keyframes au-/g) || []).length, 5);
});

test('the existing cinema hooks stay in their own controller', () => {
  const cinema = read('assets/js/home-cinema.js');
  assert.match(cinema, /'--hero-type-y'/);
  assert.match(cinema, /'--manifesto-wipe'/);
  assert.match(cinema, /'--rail-x'/);
  assert.match(cinema, /'--packet-meter'/);
  assert.match(cinema, /classList\.toggle\('is-active', active\)/);
  assert.ok(!/au-aurora|home-aurora/.test(cinema));
});

/* ---------- motion, responsive and functional safeguards ---------- */

test('aurora runs only for fine pointers on wide, no-preference screens', () => {
  assert.match(js, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(js, /matchMedia\('\(min-width: 701px\)'\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(js, /if \(!allowed\(\) \|\| root\.classList\.contains\('home-aurora-ready'\)\) return null;/);
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /display: none !important/);
});

test('the aurora only paints pointer offsets while the hero is active', () => {
  assert.match(js, /pointerenter/);
  assert.match(js, /pointermove/);
  assert.match(js, /pointerleave/);
  assert.match(js, /pointercancel/);
  assert.match(js, /hero\.classList\.add\('is-au-active'\)/);
  assert.match(js, /hero\.classList\.remove\('is-au-active'\)/);
  assert.match(js, /aurora\.style\.setProperty\('--au-x', x\.toFixed\(2\) \+ 'px'\)/);
  assert.match(js, /aurora\.style\.setProperty\('--au-y', y\.toFixed\(2\) \+ 'px'\)/);
});

test('visibility and preference changes tear the aurora down cleanly', () => {
  assert.match(js, /listen\(window, 'resize', measure, \{ passive: true \}\)/);
  assert.match(js, /query\.addEventListener\('change', onPreferenceChange\)/);
  assert.match(js, /aurora\.style\.removeProperty\('--au-x'\)/);
  assert.match(js, /aurora\.style\.removeProperty\('--au-y'\)/);
  assert.match(js, /window\.addEventListener\('pagehide'/);
});

test('the aurora controller makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase/.test(js));
  assert.ok(!/data-lead-form|<form/.test(
    html.split('<section class="hero2 hero-clean" id="hero" data-aurora-hero>')[1].split('</section>')[0]
  ));
});
