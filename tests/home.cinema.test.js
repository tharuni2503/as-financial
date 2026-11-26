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
  assert.equal(cinema.progressFor(0, top, height, vh), 0);
  assert.equal(cinema.progressFor(top, top, height, vh), 0);
  assert.equal(cinema.progressFor(top + 600, top, height, vh), 0.5);
  assert.equal(cinema.progressFor(top + 1200, top, height, vh), 1);
  assert.equal(cinema.progressFor(top + 5000, top, height, vh), 1);
  assert.equal(cinema.progressFor(top - 500, top, height, vh), 0);
});

test('reverse scrolling produces monotonically decreasing stage progress', () => {
  const top = 1000;
  const height = 1800;
  const vh = 800;
  const forward = [0, 400, 800, 1200, 1600].map((y) => cinema.progressFor(y + top, top, height, vh));
  for (let i = 1; i < forward.length; i += 1) assert.ok(forward[i] >= forward[i - 1]);
  const reverse = forward.slice().reverse();
  for (let i = 1; i < reverse.length; i += 1) assert.ok(reverse[i] <= reverse[i - 1]);
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
      assert.ok(value >= previous && value >= 0 && value <= 1);
      previous = value;
    }
  }
});

test('rail overflow is measured, clamped, and fully consumed at progress 1', () => {
  assert.equal(cinema.railOverflow(1500, 1200), 300);
  assert.equal(cinema.railOverflow(1200, 1200), 0);
  assert.equal(cinema.railOverflow(900, 1200), 0);
  const overflow = cinema.railOverflow(1732, 1280);
  assert.equal(overflow, 452);
  assert.equal(-overflow * cinema.progressFor(1000, 800, 1600, 800), -113);
  assert.equal(-overflow * cinema.progressFor(1600, 800, 1600, 800), -452);
});

test('phase helper maps progress to one discrete step or chapter', () => {
  assert.equal(cinema.phaseFor(0, 5), 0);
  assert.equal(cinema.phaseFor(0.199, 5), 0);
  assert.equal(cinema.phaseFor(0.2, 5), 1);
  assert.equal(cinema.phaseFor(0.99, 5), 4);
  assert.equal(cinema.phaseFor(1, 5), 4);
  assert.equal(cinema.phaseFor(-1, 3), 0);
  assert.equal(cinema.phaseFor(0.5, 0), 0);
});

/* ---------- exact original structure and layout ---------- */

test('the five original stage wrappers and every original section are retained', () => {
  const names = Array.from(html.matchAll(/data-cine-stage="([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual(names, ['hero', 'manifesto', 'rail', 'packet', 'season']);
  for (const id of ['hero', 'partners', 'products', 'process-home', 'calculator', 'why-us', 'guides', 'faq', 'visit-us']) {
    assert.ok(html.includes(`id="${id}"`), `original section ${id} is retained`);
  }
  assert.ok(!html.includes('data-story-stage'), 'scroll-story markup is gone');
  assert.ok(!html.includes('story-stage'), 'scroll-story classes are gone');
});

test('original hero image, copy, buttons and contour artwork are restored', () => {
  assert.match(html, /<h1>Your Financial Goals, <span class="serif">Our Trusted Solutions\.<\/span><\/h1>/);
  assert.match(html, /<img class="parallax-y" src="assets\/img\/hero-family-home\.jpg"/);
  assert.match(html, /<svg class="cine-contours cine-contours--hero"/);
  assert.equal((html.match(/class="cine-contours cine-contours--hero"[\s\S]*?<\/svg>/)[0].match(/<path /g) || []).length, 3);
  assert.ok(html.includes('data-popup-open="apply-popup"'));
  assert.ok(html.includes('href="loans.html"') && html.includes('href="contact.html"'));
  assert.ok(!html.includes('story-hero-art') && !html.includes('story-finline'));
});

test('original stage heights, chrome offset and product-card sizing are restored', () => {
  assert.match(css, /:root \{\s*--cine-chrome-h:/, 'chrome offset keeps its original :root scope');
  assert.match(css, /height: 200vh;/);
  assert.match(css, /height: 230vh;/);
  assert.match(css, /height: 165vh;/);
  assert.match(css, /height: 180vh;/);
  assert.match(css, /height: clamp\(360px, 46vh, 460px\)/);
  assert.match(css, /max-height: 460px/);
  assert.match(css, /radial-gradient\(800px 260px at 90% 0%/);
});

test('header, ticker, navigation and footer markup are unchanged', () => {
  assert.match(html, /<header class="site-header">/);
  assert.ok((html.match(/class="nav-link"/g) || []).length >= 8);
  assert.match(read('assets/js/main.js'), /ticker\.className = 'live-ticker'/, 'live ticker is created by the shared script');
  assert.match(html, /<footer class="site-footer">/);
  assert.match(html, /footer-compact-brand/);
});

/* ---------- only five restrained animations ---------- */

test('the controller writes exactly the five approved animation hooks', () => {
  assert.match(js, /'--hero-type-y'/, 'hero headline lift');
  assert.match(js, /'--manifesto-wipe'/, 'manifesto reveal');
  assert.match(js, /'--rail-x'/, 'horizontal product rail');
  assert.match(js, /'--packet-meter'/, 'journey progress indicator');
  assert.match(js, /classList\.toggle\('is-active', active\)/, 'guidance chapter transition');
  assert.ok(!/IntersectionObserver|revSelectors|is-rev/.test(js), 'no extra reveal choreography');
  assert.match(js, /splitWords\(headline\)/, 'original hero text metrics are retained');
  assert.match(js, /splitWords\(manifestoFront\)/, 'original manifesto text metrics are retained');
  assert.ok(!/--hero-line|--manifesto-line|--packet-cut|--season-line/.test(js), 'no extra stage animations');
});

test('the hero headline moves subtly without changing its styling', () => {
  assert.match(js, /-12 \* easeInOut/);
  assert.match(css, /translate3d\(0, var\(--hero-type-y, 0px\), 0\) !important/);
  assert.match(css, /opacity: 1 !important/);
});

test('every process step and the flow remain visible; only the milestone is highlighted', () => {
  assert.match(css, /\.home-cinema-ready \.cine-stage--packet \.process-flow,\s*\.home-cinema-ready \.cine-stage--packet \.process-step \{\s*opacity: 1 !important/);
  assert.match(css, /clip-path: none !important/);
  assert.match(js, /step\.classList\.toggle\('is-packet-on', index <= packetPhase\)/);
  assert.ok((html.match(/class="process-step reveal"/g) || []).length === 5);
});

test('guidance chapters keep their crossfade but use only an 8px lift', () => {
  assert.match(css, /translate3d\(0, 8px, 0\) !important/);
  assert.match(css, /\.home-cinema-ready \.cine-chapter\.is-active \{\s*transform: none !important/);
  assert.equal((html.match(/data-cine-chapter="[0-2]"/g) || []).length, 3);
});

/* ---------- responsive, motion and functional safeguards ---------- */

test('mobile keeps the original static, touch-friendly layouts', () => {
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /height: auto !important/);
  assert.match(css, /position: static !important/);
  assert.match(css, /overflow-x: auto;[\s\S]{0,180}-webkit-overflow-scrolling: touch/);
  assert.match(css, /transform: none !important/);
  assert.match(css, /body\.page-home \{\s*overflow-x: clip;/);
});

test('reduced motion and no-JS keep every piece of content visible', () => {
  assert.match(js, /if \(reduceQuery && reduceQuery\.matches\) return null;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /clip-path: none !important/);
  assert.match(css, /stroke-dashoffset: 0 !important/);
  assert.ok(!/home-cinema-ready/.test(html), 'gating class is added by JS only');
});

test('one passive scroll listener batches writes inside requestAnimationFrame', () => {
  assert.equal((js.match(/listen\(window, 'scroll'/g) || []).length, 1);
  assert.match(js, /listen\(window, 'scroll', onScroll, \{ passive: true \}\)/);
  assert.match(js, /window\.requestAnimationFrame\(frame\)/);
  assert.match(js, /rect\.top \+ scrollY/);
  assert.match(js, /state\.needsMeasure/);
  assert.ok(!/preventDefault\(\)/.test(js));
});

test('resize, orientation and visibility changes recalculate stage measurements', () => {
  assert.match(js, /listen\(window, 'resize', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(window, 'orientationchange', onResize, \{ passive: true \}\)/);
  assert.match(js, /listen\(document, 'visibilitychange', onVisibility\)/);
  assert.match(js, /new ResizeObserver/);
  assert.match(js, /document\.fonts\.ready/);
});

test('existing homepage interactions and disclaimers are preserved', () => {
  assert.ok((html.match(/data-popup-open="apply-popup"/g) || []).length >= 4);
  assert.match(html, /<form[^>]*data-lead-form/);
  assert.match(html, /data-calc-tabs/);
  assert.match(html, /data-lp2-grid/);
  assert.match(html, /id="faq"/);
  assert.match(html, /\*Indicative rates\/terms only/);
  assert.match(html, /Subject to lender policy/);
});

test('the scroll controller makes no network, storage or backend calls', () => {
  assert.ok(!/fetch\(|XMLHttpRequest|Supabase|supabase/.test(js));
  assert.ok(!js.includes('localStorage'));
  for (const file of ['server/index.js', 'server/store-json.js', 'server/store-pg.js', 'server/validate.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, file)));
  }
});
