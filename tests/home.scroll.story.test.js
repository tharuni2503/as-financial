'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const html = read('index.html');
const css = read('assets/css/home-scroll-story.css');
const js = read('assets/js/home-scroll-story.js');
const mainJs = read('assets/js/main.js');
const story = require('../assets/js/home-scroll-story.js');

/* ---------- pure scroll calculations ---------- */

test('stageWindow and progressFor measure pinned travel from real geometry', () => {
  const win = story.stageWindow(4000, 2000, 800, 100);
  assert.deepEqual(win, { start: 3900, travel: 1200 });

  assert.equal(story.progressFor(0, win.start, win.travel), 0, 'before the stage');
  assert.equal(story.progressFor(win.start, win.start, win.travel), 0, 'where pinning begins');
  assert.equal(story.progressFor(4500, win.start, win.travel), 0.5, 'mid stage');
  assert.equal(story.progressFor(5100, win.start, win.travel), 1, 'where pinning ends');
  assert.equal(story.progressFor(9000, win.start, win.travel), 1, 'past the stage');
});

test('reverse and fast scrolling stay clamped and deterministic', () => {
  const win = story.stageWindow(1200, 1800, 700, 100);
  const down = [0, 1300, 1700, 2300, 2900].map((y) => story.progressFor(y, win.start, win.travel));
  const up = [2900, 2300, 1700, 1300, 0].map((y) => story.progressFor(y, win.start, win.travel));

  assert.equal(down[0], 0);
  assert.equal(down[down.length - 1], 1);
  assert.deepEqual(up, [...down].reverse());
  assert.ok(down.every((value) => value >= 0 && value <= 1));
});

test('rail overflow and endpoint are measured, never hardcoded', () => {
  const overflow = story.railOverflow(3680, 1280);
  assert.equal(overflow, 2400);
  assert.equal(story.railOverflow(900, 1280), 0);
  assert.equal(-overflow * 1, -2400, 'progress 1 lands exactly on the measured endpoint');
  assert.match(js, /railOverflow\(track\.scrollWidth, railViewport\.clientWidth\)/);
  assert.match(js, /-state\.railOverflow \* railProgress/);
  assert.match(css, /translate3d\(var\(--story-rail-x, 0px\), 0, 0\)/);
  assert.match(html, /data-story-rail-track/);
  assert.match(html, /data-story-rail-viewport/);
});

test('milestone timing completes before each stage ends', () => {
  assert.equal(story.milestoneFor(0, 5, 0.82), 0);
  assert.equal(story.milestoneFor(0.16, 5, 0.82), 0);
  assert.equal(story.milestoneFor(0.17, 5, 0.82), 1);
  assert.equal(story.milestoneFor(0.82, 5, 0.82), 4);
  assert.equal(story.milestoneFor(1, 5, 0.82), 4, 'final milestone holds until the stage ends');
  assert.equal(story.milestoneFor(0.78, 3, 0.78), 2);
  assert.equal(story.phaseFor(1, 5), 4);
  assert.equal(story.phaseFor(0.5, 5), 2);
});

test('hero fit and manifesto alignment helpers return measured deltas', () => {
  assert.equal(story.textFitOverflow(1220, 1200), 20);
  assert.equal(story.textFitOverflow(1100, 1200), 0);
  assert.deepEqual(story.alignmentDelta(
    { left: 100, top: 200, width: 640, height: 180 },
    { left: 100, top: 200, width: 640, height: 180 }
  ), { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(story.alignmentDelta(
    { left: 102.5, top: 199.25, width: 640, height: 180 },
    { left: 100, top: 200, width: 642, height: 180 }
  ), { x: 2.5, y: -0.75, width: -2, height: 0 });
  assert.match(js, /headline\.scrollWidth, headline\.clientWidth/);
  assert.match(js, /manifestoFront\.getBoundingClientRect\(\)/);
});

test('easing helpers remain bounded', () => {
  [-1, 0, 0.25, 0.5, 0.75, 1, 2].forEach((value) => {
    [story.easeIn, story.easeOut, story.easeInOut].forEach((fn) => {
      const result = fn(value);
      assert.ok(result >= 0 && result <= 1, `${fn.name}(${value}) = ${result}`);
    });
  });
});

/* ---------- five-stage markup and CSS contract ---------- */

test('index contains exactly the five requested story stages', () => {
  const stages = [...html.matchAll(/data-story-stage="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(stages, ['hero', 'manifesto', 'rail', 'journey', 'guidance']);
  assert.equal((html.match(/data-cine-stage=/g) || []).length, 0);
  ['hero', 'products', 'process-home', 'calculator', 'why-us', 'guides', 'faq', 'visit-us'].forEach((id) => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
});

test('old cinema implementation is fully superseded', () => {
  assert.equal(exists('assets/css/home-cinema.css'), false);
  assert.equal(exists('assets/js/home-cinema.js'), false);
  assert.equal(exists('assets/css/home-scroll-story.css'), true);
  assert.equal(exists('assets/js/home-scroll-story.js'), true);
  assert.doesNotMatch(html, /home-cinema/);
  assert.match(html, /assets\/css\/home-scroll-story\.css\?v=20261126f/);
  assert.match(html, /assets\/js\/home-scroll-story\.js\?v=20261126f/);
});

test('hero poster uses independent transform and opacity variables', () => {
  assert.match(html, /data-story-hero-headline/);
  assert.match(html, /data-story-hero-lede/);
  assert.match(html, /data-story-hero-image/);
  assert.match(html, /data-story-hero-art/);
  assert.match(html, /Your Financial Goals, <span class="serif">Our Trusted Solutions\.<\/span>/);
  assert.match(css, /transform: scale\(var\(--story-hero-headline-scale, 1\)\)/);
  assert.doesNotMatch(css, /--story-hero-headline-y/);
  assert.doesNotMatch(js, /--story-hero-headline-y/);
  assert.match(css, /translate3d\(0, var\(--story-hero-lede-y, 0px\), 0\)/);
  assert.match(css, /translate3d\(0, var\(--story-hero-image-y, 0px\), 0\) scale\(var\(--story-hero-image-scale, 1\)\)/);
});

test('hero line artwork is generated locally as SVG', () => {
  assert.match(js, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', name\)/);
  assert.match(js, /'class': 'story-finline__line'/);
  assert.match(js, /pathLength: '1'/);
  assert.match(css, /stroke-dashoffset: calc\(1 - var\(--story-hero-line, 0\)\)/);
  assert.doesNotMatch(html, /<img[^>]+fallow/i);
});

test('manifesto uses an exactly aligned duplicate and bottom-up wipe', () => {
  const copies = [...html.matchAll(/<p class="story-manifesto-copy[^"]*"[^>]*>([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.equal(copies.length, 2);
  assert.equal(copies[0], copies[1]);
  assert.match(html, /data-story-manifesto-ghost aria-hidden="true"/);
  assert.match(html, /data-story-manifesto-front/);
  assert.match(css, /grid-area: 1 \/ 1/);
  assert.match(css, /clip-path: inset\(var\(--story-manifesto-wipe, 100%\) 0 0 0\)/);
  assert.match(css, /translate3d\(var\(--story-manifesto-x, 0px\), var\(--story-manifesto-y, 0px\), 0\)/);
  assert.match(js, /setVar\(stages\.manifesto, '--story-manifesto-x', '0px'\)/);
  assert.match(js, /setVar\(stages\.manifesto, '--story-manifesto-x'/);
});

test('rail reuses all twelve genuine loan products with a progress indicator', () => {
  const exploreLinks = [...html.matchAll(/href="loans\.html#[^"]+">Explore/g)];
  assert.ok(exploreLinks.length >= 12);
  assert.match(html, /data-story-rail-progress/);
  assert.match(css, /transform: scaleX\(var\(--story-rail-progress, 0\)\)/);
  assert.match(css, /display: flex;\s*flex-wrap: nowrap;\s*width: max-content;/);
  assert.match(css, /padding: 6px clamp\(12px, 2vw, 24px\) 14px;/);
  assert.match(css, /\.pgrid-wrap:not\(\[data-story-rail-viewport\]\) \{\s*overflow: visible;/);
  assert.match(js, /state\.visibleRailCards/);
});

test('journey document uses only five genuine process milestones', () => {
  const steps = [...html.matchAll(/<li class="process-step reveal">/g)];
  assert.equal(steps.length, 5);
  ['Share your need', 'Compare options', 'Prepare documents', 'Application support', 'Move to closure'].forEach((heading) => {
    assert.match(html, new RegExp(`<h3>${heading}</h3>`));
  });
  assert.match(html, /data-story-journey-document/);
  assert.match(html, /data-story-journey-phase/);
  assert.doesNotMatch(css, /--story-journey-cut/);
  assert.doesNotMatch(css, /--story-journey-alpha/);
  assert.match(css, /\.process-step \{\s*position: relative;\s*min-width: 0;\s*opacity: 1;/);
  assert.match(css, /width: var\(--story-journey-meter, 0%\)/);
  assert.match(js, /step\.classList\.toggle\('is-story-milestone', index <= milestone\)/);
  assert.doesNotMatch(js, /approved|approval confirmed|application submitted|customer name/i);
});

test('guidance uses parallax contours and three existing homepage chapters', () => {
  assert.equal((html.match(/data-story-chapter="/g) || []).length, 3);
  assert.match(html, /data-story-guidance-art/);
  assert.match(html, /href="#calculator"/);
  assert.match(html, /href="contact\.html"/);
  assert.match(css, /translate3d\(0, var\(--story-guidance-y, 0px\), 0\) scale\(var\(--story-guidance-scale, 1\)\)/);
  assert.match(css, /stroke-dashoffset: calc\(1 - var\(--story-guidance-line, 0\)\)/);
  assert.doesNotMatch(css, /transition: opacity \.5s ease, transform \.5s ease, visibility/);
  assert.match(js, /item\.classList\.toggle\('is-active', active\)/);
  assert.match(js, /item\.inert = !active && !state\.staticMode/);
});

/* ---------- engine, reveals, responsive and accessibility ---------- */

test('one central controller uses rAF, passive scroll and efficient measurement', () => {
  assert.match(js, /listen\(window, 'scroll', onScroll, \{ passive: true \}\)/);
  assert.match(js, /window\.requestAnimationFrame\(frame\)/);
  assert.match(js, /new ResizeObserver/);
  assert.match(js, /visibilitychange/);
  assert.match(js, /document\.fonts\.ready/);
  assert.match(js, /state\.needsMeasure/);
  assert.doesNotMatch(js, /preventDefault\(/);
  assert.doesNotMatch(js, /setInterval\(/);
});

test('existing reveal observer is reused and never duplicated', () => {
  assert.doesNotMatch(js, /IntersectionObserver/);
  assert.doesNotMatch(js, /data-rev/);
  assert.match(mainJs, /const io = new IntersectionObserver/);
  assert.equal((mainJs.match(/const io = new IntersectionObserver/g) || []).length, 1);
  assert.ok((html.match(/class="[^"]*\breveal\b/g) || []).length >= 30);
  assert.match(html, /hero2-copy reveal-left/);
  assert.match(html, /hero2-visual hero-clean-visual reveal-right/);
});

test('reduced motion and no-JS states keep all content visible', () => {
  assert.match(js, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /html:not\(\.home-scroll-story-ready\) \.story-manifesto-copy--ghost \{\s*display: none;/);
  assert.match(css, /html:not\(\.home-scroll-story-ready\) \.story-contours path/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.page-home \.story-chapter \{/);
  assert.match(reduced, /\.page-home \.story-stage--journey \.process-step/);
  assert.match(reduced, /overflow-x: auto !important/);
  assert.doesNotMatch(reduced, /\.page-home \.story-stage > \* \{\s*position: static/);
  assert.match(reduced, /\.page-home \.story-guidance-art \{\s*inset: 0 !important;/);
  assert.doesNotMatch(reduced, /html\.home-scroll-story-ready/);
  assert.match(css, /clip-path: none !important/);
  assert.match(css, /position: static !important/);
  assert.match(html, /<noscript><style>\.reveal,\.reveal-zoom,\.reveal-left,\.reveal-right\{opacity:1!important;transform:none!important\}<\/style><\/noscript>/);
  assert.doesNotMatch(html, /home-scroll-story-ready/);
});

test('guidance artwork stays contained in no-JS, mobile and reduced-motion states', () => {
  assert.match(css, /\.page-home \.story-guidance-inner \{\s*position: relative;\s*overflow: hidden;\s*\}/);
  assert.equal((css.match(/position: relative !important;/g) || []).length, 2);
  assert.match(css, /html\.home-scroll-story-ready \.page-home \.story-guidance-inner \{\s*position: relative !important;\s*\}/);
});

test('tablet and mobile stages shorten or drop pinning safely', () => {
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /height: 155svh/);
  assert.match(css, /@media \(max-width: 700px\)/);
  assert.match(css, /html\.home-scroll-story-ready \.page-home \.story-stage \{\s*height: auto !important;/);
  assert.match(css, /overflow-x: auto/);
  assert.match(css, /-webkit-overflow-scrolling: touch/);
  assert.match(css, /touch-action: pan-x pan-y/);
  assert.match(css, /\.page-home \.hero2-copy\.reveal-left/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.page-home \.story-manifesto-copy \{\s*max-width: 100%;/);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.doesNotMatch(css, /overflow-x: hidden/);
});

test('sticky chrome offsets are measured and used for anchors', () => {
  assert.match(css, /\.page-home \[id\] \{\s*scroll-margin-top: calc\(var\(--story-chrome-h\) \+ 12px\);/);
  assert.match(js, /function measureChrome\(\)/);
  assert.match(js, /setVar\(document\.body, '--story-chrome-h'/);
  assert.match(js, /document\.querySelector\('\.live-ticker'\)/);
});

test('new CSS is scoped to the homepage and does not suppress document overflow', () => {
  assert.match(css, /html\.home-scroll-story-ready \.page-home \.story-stage/);
  assert.match(css, /\.page-home \{/);
  assert.doesNotMatch(css, /(^|\n)\s*(html|body)\s*\{[^}]*overflow-x:\s*hidden/);
});

test('existing homepage functionality remains wired up', () => {
  assert.ok((html.match(/data-popup-open="apply-popup"/g) || []).length >= 4);
  assert.match(html, /<form[^>]+data-lead-form[^>]+data-source="Homepage popup"/);
  assert.match(html, /data-calc-tabs/);
  assert.match(html, /data-lp2-grid/);
  assert.match(html, /id="faq"/);
  assert.match(html, /\*Indicative rates\/terms only/);
  assert.match(html, /Subject to lender policy/);
  assert.match(html, /data-menu-open/);
  assert.match(html, /data-popup-close/);
});
