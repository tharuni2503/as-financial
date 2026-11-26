'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-portal-hero.css');
const js = read('assets/js/home-portal-hero.js');
const portal = require('../assets/js/home-portal-hero.js');

/* ---------- scroll-bound animation maths ---------- */

test('portal progress is clamped and maps to a reversible reveal window', () => {
  assert.equal(portal.clamp(-1), 0);
  assert.equal(portal.clamp(2), 1);
  assert.deepEqual(portal.revealWindow(0), { opacity: 0, motion: 0 });
  assert.deepEqual(portal.revealWindow(1), { opacity: 0, motion: 1 });
  assert.equal(portal.revealWindow(0.5).opacity, 1);

  const forward = [0, 0.25, 0.5, 0.75, 1].map((p) => portal.portalValues(p));
  for (let i = 1; i < forward.length; i += 1) {
    assert.ok(Number.parseFloat(forward[i].scale) <= Number.parseFloat(forward[i - 1].scale));
    assert.ok(Number.parseFloat(forward[i].right) >= Number.parseFloat(forward[i - 1].right));
  }
  const reverse = forward.slice().reverse();
  for (let i = 1; i < reverse.length; i += 1) {
    assert.ok(Number.parseFloat(reverse[i].scale) >= Number.parseFloat(reverse[i - 1].scale));
    assert.ok(Number.parseFloat(reverse[i].right) <= Number.parseFloat(reverse[i - 1].right));
  }
});

test('portal values reproduce the selected animation at its midpoint', () => {
  const values = portal.portalValues(0.5);
  assert.equal(values.opacity, '1.000');
  assert.equal(values.scale, '1.105');
  assert.equal(values.duo, '0.220');
  assert.equal(values.left, '-60.24%');
  assert.equal(values.right, '60.24%');
  assert.equal(values['dot-a-x'], '9.43vw');
  assert.equal(values['dot-a-y'], '28.81vh');
  assert.equal(values['dot-b-x'], '-30.38vw');
  assert.equal(values['dot-b-y'], '-23.57vh');
  assert.equal(values['title-scale'], '1.063');
  assert.equal(values.tracking, '-0.0719em');
  assert.equal(values['half-left'], '-23.57%');
  assert.equal(values['half-right'], '23.57%');
});

/* ---------- restoration and layout safeguards ---------- */

test('the portal overlay is mounted only inside the original hero figure', () => {
  assert.equal((html.match(/data-portal-hero/g) || []).length, 1);
  assert.equal((html.match(/class="ph-portal"/g) || []).length, 1);
  assert.match(html, /<figure class="hero-clean-frame" data-hover-reveal data-portal-hero>/);
  assert.match(html, /<img class="parallax-y" src="assets\/img\/hero-family-home\.jpg"/);
  assert.match(html, /<figcaption class="hero-clean-caption">/);
  assert.ok(html.includes('assets/css/home-portal-hero.css'));
  assert.ok(html.includes('assets/js/home-portal-hero.js'));
});

test('every portal layer is absolute and never changes the figure box', () => {
  const rule = css.split('.ph-portal {')[1].split('}')[0];
  assert.match(rule, /position: absolute/);
  assert.match(rule, /inset: 0/);
  assert.match(rule, /pointer-events: none/);
  assert.match(rule, /opacity: var\(--ph-opacity, 0\)/);
  assert.ok(!/width:|height:|padding:|margin:/.test(rule));
  assert.match(css, /\.ph-portal-corner--left \{\s*left: 0;\s*transform: translateX\(var\(--ph-left, 0%\)\)/);
  assert.match(css, /\.ph-portal-corner--right \{\s*right: 0;\s*transform: translateX\(var\(--ph-right, 0%\)\)/);
  assert.match(css, /background: url\('\.\.\/img\/hero-family-home\.jpg'\) center \/ cover no-repeat/);
});

test('the five original cinema hooks remain in their own controller', () => {
  const cinema = read('assets/js/home-cinema.js');
  assert.match(cinema, /'--hero-type-y'/);
  assert.match(cinema, /'--manifesto-wipe'/);
  assert.match(cinema, /'--rail-x'/);
  assert.match(cinema, /'--packet-meter'/);
  assert.match(cinema, /classList\.toggle\('is-active', active\)/);
  assert.ok(!/ph-portal|home-portal/.test(cinema));
});

/* ---------- motion, responsive and functional safeguards ---------- */

test('the portal runs only for fine pointers on wide, no-preference screens', () => {
  assert.match(js, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(js, /matchMedia\('\(min-width: 701px\)'\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(js, /if \(!allowed\(\) \|\| root\.classList\.contains\('home-portal-hero-ready'\)\) return null;/);
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /display: none !important/);
});

test('one passive scroll listener batches portal writes inside requestAnimationFrame', () => {
  assert.equal((js.match(/listen\(window, 'scroll'/g) || []).length, 1);
  assert.match(js, /listen\(window, 'scroll', onScroll, \{ passive: true \}\)/);
  assert.match(js, /window\.requestAnimationFrame/);
  assert.match(js, /portal\.style\.setProperty\('--ph-' \+ name, values\[name\]\)/);
  assert.ok(!/preventDefault\(\)/.test(js));
});

test('resize, visibility and preference changes recalculate or tear down cleanly', () => {
  assert.match(js, /listen\(window, 'resize', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(window, 'orientationchange', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(document, 'visibilitychange', onVisibility\)/);
  assert.match(js, /new ResizeObserver/);
  assert.match(js, /document\.fonts\.ready/);
  assert.match(js, /query\.addEventListener\('change', onPreferenceChange\)/);
  assert.match(js, /portal\.style\.removeProperty\('--ph-' \+ name\)/);
});

test('the portal controller makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase/.test(js));
  assert.ok(!/data-lead-form|data-popup-open|<form/.test(
    html.split('<figure class="hero-clean-frame" data-hover-reveal data-portal-hero>')[1].split('</figure>')[0]
  ));
});
