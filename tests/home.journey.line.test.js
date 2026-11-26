'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-journey-line.css');
const js = read('assets/js/home-journey-line.js');
const journey = require('../assets/js/home-journey-line.js');

/* ---------- source-exact values ---------- */

test('the winding path matches the selected Superdesign source exactly', () => {
  assert.equal(
    journey.PATH_D,
    'M 50 0 C 50 100, 80 150, 80 250 S 20 350, 20 500 S 80 650, 80 800 S 50 900, 50 1000'
  );
  assert.equal(journey.STIFFNESS, 400);
  assert.equal(journey.DAMPING, 90);
  assert.equal(journey.REST_DELTA, 1e-3);
});

test('scroll progress is clamped and zero when the page cannot scroll', () => {
  assert.equal(journey.pageProgress(0, 1000, 1000), 0);
  assert.equal(journey.pageProgress(250, 2000, 1000), 0.25);
  assert.equal(journey.pageProgress(1000, 2000, 1000), 1);
  assert.equal(journey.pageProgress(5000, 2000, 1000), 1);
  assert.equal(journey.pageProgress(-20, 2000, 1000), 0);
  assert.equal(journey.clamp(2), 1);
  assert.equal(journey.clamp(-1), 0);
});

test('the spring settles on the scroll target without overshooting bounds', () => {
  const spring = journey.createSpring(0, 400, 90, 1e-3);
  spring.set(1);
  let value = 0;
  for (let i = 0; i < 240; i++) value = spring.step(1 / 60);
  assert.ok(value > 0 && value <= 1);
  assert.ok(Math.abs(value - 1) < 1e-3);
  assert.equal(spring.get(), value);
});

/* ---------- restoration and layout safeguards ---------- */

test('the journey rail is mounted once, outside the restored sections', () => {
  assert.equal((html.match(/data-journey-line/g) || []).length, 1);
  assert.equal((html.match(/class="jl-journey"/g) || []).length, 1);
  assert.match(html, /<div class="jl-journey" data-journey-line aria-hidden="true">/);
  assert.ok(html.includes('assets/css/home-journey-line.css'));
  assert.ok(html.includes('assets/js/home-journey-line.js'));
  // The five approved cinema stages remain untouched.
  assert.match(html, /class="hero2 hero-clean" id="hero" data-aurora-hero>/);
  assert.match(html, /id="process-home" data-cine-packet-document>/);
});

test('the source SVG structure is preserved with the site navy and gold palette', () => {
  assert.match(html, /viewBox="0 0 100 1000" preserveAspectRatio="none"/);
  assert.match(html, /<linearGradient id="jl-gradient" x1="0" y1="0" x2="0" y2="1">/);
  assert.match(html, /<stop offset="0%" stop-color="#C49A45" stop-opacity="0\.5">/);
  assert.match(html, /<stop offset="50%" stop-color="#C49A45">/);
  assert.match(html, /<stop offset="100%" stop-color="#9A7A1A">/);
  assert.match(html, /<filter id="jl-glow" x="-50%" y="-50%" width="200%" height="200%">/);
  assert.match(html, /<feGaussianBlur stdDeviation="2" result="coloredBlur">/);
  assert.match(html, /<feMergeNode in="coloredBlur">/);
  assert.match(html, /<feMergeNode in="SourceGraphic">/);
  assert.match(html, /class="jl-track"/);
  assert.match(html, /class="jl-progress"/);
  assert.match(html, /pathLength="1"/);
  assert.match(html, /filter="url\(#jl-glow\)"/);
});

test('the rail is fixed and non-interactive, so it writes no layout dimensions', () => {
  const rule = css.split('.jl-journey {')[1].split('}')[0];
  assert.match(rule, /position: fixed/);
  assert.match(rule, /pointer-events: none/);
  assert.match(rule, /opacity: 0/);
  assert.match(rule, /z-index: 40/);
  assert.match(css, /\.jl-progress \{\s*stroke-dasharray: 1 1;\s*stroke-dashoffset: calc\(1 - var\(--jl-progress, 0\)\);/);
});

test('the existing cinema hooks stay in their own controller', () => {
  const cinema = read('assets/js/home-cinema.js');
  assert.match(cinema, /'--hero-type-y'/);
  assert.match(cinema, /'--manifesto-wipe'/);
  assert.match(cinema, /'--rail-x'/);
  assert.match(cinema, /'--packet-meter'/);
  assert.match(cinema, /classList\.toggle\('is-active', active\)/);
  assert.ok(!/jl-journey|home-journey/.test(cinema));
});

/* ---------- motion, responsive and functional safeguards ---------- */

test('the rail runs only for fine pointers on wide, no-preference screens', () => {
  assert.match(js, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(js, /matchMedia\('\(min-width: 701px\)'\)/);
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(js, /if \(!allowed\(\) \|\| root\.classList\.contains\('home-journey-line-ready'\)\) return null;/);
  assert.match(css, /@media \(max-width: 700px\), \(hover: none\), \(pointer: coarse\), \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /display: none !important/);
});

test('the rail follows scroll and reverse scroll through a single animation frame', () => {
  assert.match(js, /listen\(window, 'scroll', start, \{ passive: true \}\)/);
  assert.match(js, /listen\(window, 'resize', start, \{ passive: true \}\)/);
  assert.match(js, /spring\.set\(state\.target\)/);
  assert.match(js, /path\.style\.setProperty\('--jl-progress', clamp\(value, 0, 1\)\.toFixed\(4\)\)/);
  assert.ok(!/window\.scrollTo/.test(js));
});

test('visibility and preference changes tear the rail down cleanly', () => {
  assert.match(js, /query\.addEventListener\('change', onPreferenceChange\)/);
  assert.match(js, /window\.cancelAnimationFrame\(raf\)/);
  assert.match(js, /path\.style\.removeProperty\('--jl-progress'\)/);
  assert.match(js, /window\.addEventListener\('pagehide'/);
});

test('the journey controller makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|Supabase|supabase/.test(js));
  assert.ok(!/data-lead-form|<form/.test(
    html.split('<div class="jl-journey"')[1].split('</div>')[0]
  ));
});
