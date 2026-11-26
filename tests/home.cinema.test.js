'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('index.html');
const css = read('assets/css/home-cinema.css');
const js = read('assets/js/home-cinema.js');
const cinema = require('../assets/js/home-cinema.js');

/* ---------- pure scroll-engine maths ---------- */

test('stage progress is relative to each stage and clamped to 0..1', () => {
  const top = 4000;
  const height = 2000;
  const vh = 800;
  assert.equal(cinema.progressFor(0, top, height, vh), 0, 'before the stage');
  assert.equal(cinema.progressFor(top, top, height, vh), 0, 'at the stage top');
  assert.equal(cinema.progressFor(top + 600, top, height, vh), 0.5, 'mid stage');
  assert.equal(cinema.progressFor(top + 1200, top, height, vh), 1, 'at the stage end');
  assert.equal(cinema.progressFor(top + 5000, top, height, vh), 1, 'past the stage');
  assert.equal(cinema.progressFor(top - 500, top, height, vh), 0, 'negative progress never leaks');
});

test('reverse scrolling produces monotonically decreasing stage progress', () => {
  const top = 1000;
  const height = 1800;
  const vh = 800;
  const forward = [0, 400, 800, 1200, 1600].map((y) => cinema.progressFor(y + top, top, height, vh));
  for (let i = 1; i < forward.length; i += 1) {
    assert.ok(forward[i] >= forward[i - 1], 'forward progress rises');
  }
  const reverse = forward.slice().reverse();
  for (let i = 1; i < reverse.length; i += 1) {
    assert.ok(reverse[i] <= reverse[i - 1], 'reverse progress falls');
  }
});

test('easing helpers stay bounded and preserve stage direction', () => {
  for (const ease of [cinema.easeInOut, cinema.easeOut, cinema.easeIn]) {
    assert.equal(ease(-2), 0);
    assert.equal(ease(0), 0);
    assert.equal(ease(1), 1);
    assert.equal(ease(4), 1);
    let previous = 0;
    for (let i = 1; i <= 20; i += 1) {
      const value = ease(i / 20);
      assert.ok(value >= previous, 'easing is monotonic');
      assert.ok(value >= 0 && value <= 1, 'easing is bounded');
      previous = value;
    }
  }
});

test('rail overflow is measured, clamped, and fully consumed at progress 1', () => {
  assert.equal(cinema.railOverflow(1500, 1200), 300);
  assert.equal(cinema.railOverflow(1200, 1200), 0, 'no phantom movement when the cards fit');
  assert.equal(cinema.railOverflow(900, 1200), 0, 'overflow never becomes negative');
  const overflow = cinema.railOverflow(1732, 1280);
  assert.equal(overflow, 452);
  assert.equal(-overflow * cinema.progressFor(1000, 800, 1600, 800), -113, 'quarter progress moves a quarter of the overflow');
  assert.equal(-overflow * cinema.progressFor(1600, 800, 1600, 800), -452, 'last card lands flush with the viewport edge');
});

test('phase helper maps progress to one discrete step or chapter', () => {
  assert.equal(cinema.phaseFor(0, 5), 0);
  assert.equal(cinema.phaseFor(0.199, 5), 0);
  assert.equal(cinema.phaseFor(0.2, 5), 1);
  assert.equal(cinema.phaseFor(0.99, 5), 4);
  assert.equal(cinema.phaseFor(1, 5), 4);
  assert.equal(cinema.phaseFor(-1, 3), 0);
  assert.equal(cinema.phaseFor(0.5, 0), 0, 'zero count cannot produce a negative phase');
});

/* ---------- markup and CSS contract ---------- */

test('all five cinematic stages wrap the original homepage sections in order', () => {
  const names = Array.from(html.matchAll(/data-cine-stage="([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual(names, ['hero', 'manifesto', 'rail', 'packet', 'season']);
  for (const id of ['hero', 'products', 'process-home']) {
    assert.ok(html.includes(`id="${id}"`), `original section ${id} is retained`);
  }
  for (const id of ['calculator', 'why-us', 'guides', 'faq', 'visit-us']) {
    assert.ok(html.includes(`id="${id}"`), `original section ${id} is retained`);
  }
});

test('stage 1 uses three independent hero type variables and measures headline overflow', () => {
  for (const name of ['--hero-type-y', '--hero-type-scale', '--hero-type-alpha']) {
    assert.ok(css.includes(name), `${name} drives the hero independently`);
    assert.ok(js.includes(`'${name}'`) || js.includes(`"${name}"`), `${name} is written by the controller`);
  }
  assert.match(css, /translate3d\(0, var\(--hero-type-y, 0px\), 0\) scale\(var\(--hero-type-scale, 1\)\)/);
  assert.match(css, /opacity: var\(--hero-type-alpha, 1\)/);
  assert.match(js, /headline\.scrollWidth - headline\.clientWidth/, 'headline itself is measured, not just the document');
  assert.match(html, /<h1>Your Financial Goals, <span class="serif">Our Trusted Solutions\.<\/span><\/h1>/, 'existing headline copy is unchanged');
});

test('stage 2 reveals a perfectly overlapping duplicate manifesto with clip-path', () => {
  const copies = Array.from(html.matchAll(/class="cine-manifesto-copy[^"]*"[^>]*>([^<]+)</g)).map((m) => m[1].trim());
  assert.equal(copies.length, 2, 'one muted and one full-contrast layer');
  assert.equal(copies[0], copies[1], 'both layers preserve the exact same approved wording');
  assert.match(html, /cine-manifesto-copy--ghost" aria-hidden="true"/, 'duplicate is hidden from assistive technology');
  assert.match(css, /clip-path: inset\(var\(--manifesto-wipe, 100%\) 0 0 0\)/, 'bottom-to-top wipe');
  assert.match(css, /transform: scale\(var\(--manifesto-scale, 1\)\)/, 'separate scale variable');
  assert.match(css, /\.cine-manifesto-copy \{\s*grid-area: 1 \/ 1/, 'both layers share one grid cell');
  assert.match(js, /frontRect\.left - ghostRect\.left/, 'alignment is measured');
  assert.match(js, /frontRect\.width - ghostRect\.width/, 'width alignment is measured');
});

test('stage 3 is a non-wrapping rail that translates by the measured overflow', () => {
  assert.match(css, /#products-grid \{\s*display: flex;\s*flex-wrap: nowrap;/);
  assert.match(css, /transform: translate3d\(var\(--rail-x, 0px\), 0, 0\)/);
  assert.match(js, /railOverflow\(track\.scrollWidth, viewport\.clientWidth\)/);
  assert.match(js, /-state\.railOverflow \* railProgress/);
  assert.match(css, /\.cine-rail-progress span \{[\s\S]{0,160}background: var\(--gold\)/);
  assert.match(css, /\.cine-rail-progress span \{[\s\S]{0,160}transform: scaleX\(var\(--rail-progress, 0\)\)/);
  const productLinks = Array.from(html.matchAll(/loans\.html#[a-z-]+">Explore/g)).length;
  assert.ok(productLinks >= 12, 'existing product links are preserved, including the hidden extras');
});

test('stage 4 exposes every required packet variable and only verified step text', () => {
  for (const name of [
    '--packet-alpha', '--packet-enter', '--packet-scale', '--packet-cut',
    '--packet-meter', '--packet-copy-x'
  ]) {
    assert.ok(css.includes(name), `${name} is defined`);
    assert.ok(js.includes(`'${name}'`), `${name} is driven by scroll progress`);
  }
  assert.match(css, /border-top: 1px dashed/, 'restrained perforation finish');
  assert.equal((html.match(/class="process-step reveal"/g) || []).length, 5, 'the real five-step process is reused');
  assert.match(js, /'Step ' \+ String\(index \+ 1\)/, 'status label describes the real step number only');
  assert.ok(!/Application ID|application has been (submitted|approved)|Approved:/i.test(html), 'no fabricated application state');
  assert.match(js, /if \(packetPhase !== state\.packetPhase\)/, 'milestone text is written only on phase change');
  assert.match(html, /data-popup-open="apply-popup"/, 'enquiry CTA remains in the document');
});

test('stage 5 keeps exactly one active chapter from existing content and parallaxes gently', () => {
  assert.equal((html.match(/data-cine-chapter="[0-2]"/g) || []).length, 3);
  assert.match(css, /--season-y/);
  assert.match(css, /--season-scale/);
  assert.match(js, /\(\(0\.5 - seasonProgress\) \* 24\)/, 'parallax stays within +/-12px');
  assert.match(css, /\.home-cinema-ready \.cine-chapter\.is-active \{[\s\S]{0,160}opacity: 1/);
  assert.match(js, /chapter\.classList\.toggle\('is-active', active\)/);
  assert.match(js, /state\.staticMode \|\| active \? 'false' : 'true'/, 'mobile chapters stay exposed to assistive technology');
  assert.ok(html.includes('href="loans.html"') && html.includes('href="contact.html"'), 'chapter links resolve to real pages');
});

test('SVG contour paths draw from progress and use restrained navy/gold strokes', () => {
  assert.equal((html.match(/pathLength="1"/g) || []).length, 8, 'every decorative path is normalized for drawing');
  for (const name of ['--hero-line', '--manifesto-line', '--season-line']) {
    assert.ok(js.includes(`'${name}'`), `${name} is driven independently`);
    assert.ok(css.includes(`var(${name}, 0)`), `${name} controls stroke-dashoffset`);
  }
  assert.match(css, /stroke-dasharray: 1;\s*stroke-dashoffset: calc\(1 - var\(--hero-line, 0\)\)/);
  assert.match(css, /\.cine-contours path\.gold \{\s*stroke: var\(--gold\)/);
  assert.ok(!/canvas|\.png|\.jpg/i.test(html.slice(html.indexOf('cine-contours'), html.indexOf('cine-contours') + 600)), 'no new stock imagery in the artwork');
});

/* ---------- engine, reveal, responsive and accessibility ---------- */

test('one passive scroll listener batches writes inside requestAnimationFrame', () => {
  assert.equal((js.match(/listen\(window, 'scroll'/g) || []).length, 1, 'exactly one scroll listener');
  assert.match(js, /listen\(window, 'scroll', onScroll, \{ passive: true \}\)/);
  assert.match(js, /window\.requestAnimationFrame\(frame\)/, 'visual updates are batched');
  assert.ok(!/preventDefault\(\)/.test(js), 'no scroll hijacking');
  assert.match(js, /rect\.top \+ scrollY/, 'stage progress is measured in document coordinates');
  assert.match(js, /state\.needsMeasure/, 'measurement is separated from style writes');
});

test('resize, orientation and visibility changes recalculate stage measurements', () => {
  assert.match(js, /listen\(window, 'resize', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(window, 'orientationchange', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(document, 'visibilitychange', onVisibility\)/);
  assert.match(js, /new ResizeObserver/, 'element resizes are observed too');
  assert.match(js, /document\.fonts\.ready/, 'font swaps are measured');
});

test('the reusable reveal system uses one observer and CSS stagger delays', () => {
  assert.equal((js.match(/new IntersectionObserver/g) || []).length, 1);
  assert.match(js, /entry\.target\.classList\.add\('is-rev'\)/);
  assert.match(js, /--d', Math\.min\(index \* 60, 360\)/, 'groups stagger through --d');
  assert.match(css, /transition-delay: var\(--d, 0ms\)/);
  assert.ok((js.match(/revSelectors = \[/g) || []).length === 1, 'a single curated selector list');
  assert.ok(js.includes("'#faq .faq-item'") && js.includes("'#products-grid > .pcard'"), 'headings, cards and rows are covered');
});

test('reduced motion and no-JS keep every piece of content visible', () => {
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/, 'preference is detected');
  assert.match(js, /if \(reduceQuery && reduceQuery\.matches\) return null;/, 'controller does not boot under reduced motion');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, 'CSS fallback exists');
  assert.match(css, /\.home-cinema-ready \.cine-manifesto-copy--front \{\s*clip-path: none !important/);
  assert.match(css, /\.home-cinema-ready \.cine-chapter \{\s*position: static;/);
  assert.ok(!/home-cinema-ready/.test(html), 'the gating class is never written into the HTML');
  assert.match(js, /el\.classList\.add\('is-rev'\)[\s\S]{0,200}\}, 2400\)/, 'reveal failsafe clears hidden content');
});

test('mobile stages stay static, touch-friendly and free of page-level overflow', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /height: auto !important/, 'pinned stages are released on phones');
  assert.match(css, /position: static !important/, 'no sticky traps on phones');
  assert.match(css, /overflow-x: auto;[\s\S]{0,160}-webkit-overflow-scrolling: touch/, 'horizontal rail is swipable');
  assert.match(css, /transform: none !important;/, 'rail is not scroll-translated on phones');
  assert.match(css, /grid-template-columns: 1fr;[\s\S]{0,120}\.home-cinema-ready \.cine-stage--packet \.process-step/, 'journey connector becomes vertical');
  assert.match(css, /@media \(max-width: 430px\)/, 'smallest tested phones are covered');
  assert.match(css, /body\.page-home \{\s*overflow-x: clip;/, 'clip avoids a sticky-breaking scroll container');
});

test('existing homepage interactions and disclaimers are preserved', () => {
  assert.ok((html.match(/data-popup-open="apply-popup"/g) || []).length >= 4, 'apply CTAs survive');
  assert.match(html, /<form[^>]*data-lead-form/, 'enquiry form is still present');
  assert.match(html, /href="contact\.html"/, 'contact page link survives');
  assert.match(html, /data-calc-tabs/, 'calculator tabs survive');
  assert.match(html, /data-lp2-grid/, 'lender directory survives');
  assert.match(html, /id="faq"/, 'FAQ survives');
  assert.match(html, /\*Indicative rates\/terms only/, 'existing rate disclaimer is unchanged');
  assert.match(html, /Subject to lender policy/, 'existing product disclaimer is unchanged');
});

test('no backend, storage or admin contracts were modified by the choreography', () => {
  for (const file of ['server/index.js', 'server/store-json.js', 'server/store-pg.js', 'server/validate.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} still exists`);
  }
  assert.ok(!/fetch\(|XMLHttpRequest|Supabase|supabase/.test(js), 'the scroll controller makes no network or data calls');
  assert.ok(!js.includes('localStorage'), 'no client-side persistence added');
});
