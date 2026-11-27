'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const htmlFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const readHtml = (f) => read(f);

const themeCss = read('assets/css/pro-light.css');
const coreCss = read('assets/css/styles.css');
const mainJs = read('assets/js/main.js');
const lendersJs = read('assets/js/lenders-ui.js');
const assistantJs = read('assets/js/assistant.js');
const cinemaJs = read('assets/js/home-cinema.js');
const serverJs = read('server/index.js');
const homeHtml = readHtml('index.html');
const guidesHtml = readHtml('guides.html');
const buyRentHtml = readHtml('buy-vs-rent-calculator.html');
const vercel = JSON.parse(read('vercel.json'));
const sitemap = read('sitemap.xml');

test('layout corrections restore gutters, narrow cap, section rhythm and textarea height', () => {
  assert.match(themeCss, /@media \(min-width: 769px\) and \(max-width: 1199px\) \{\s*\.container \{ padding-inline: 24px; \}/);
  assert.match(themeCss, /@media \(min-width: 769px\) \{\s*\.container-narrow \{ width: min\(880px, 100%\); \}/);
  assert.match(themeCss, /body\.page-home #process-home \{ padding: clamp\(56px, 5vw, 72px\) 0; \}/);
  assert.match(themeCss, /@media \(max-width: 768px\) \{ body\.page-home #process-home \{ padding: 48px 0; \} \}/);
  assert.match(themeCss, /@media \(max-width: 560px\) \{ body\.page-home #process-home \{ padding: 42px 0; \} \}/);
  assert.match(themeCss, /\.form-grid \.field textarea \{ min-height: 120px; \}/);
});

test('audit fixes keep focus visible and improve small-text contrast without changing brand tokens', () => {
  assert.match(themeCss, /input\[type="range"\]:focus-visible \{[\s\S]*?outline: 3px solid rgba\(196, 154, 69, \.55\)/);
  assert.match(themeCss, /\.lp2-search:focus-within \{[\s\S]*?border-color: #C49A45;[\s\S]*?box-shadow: 0 0 0 3px rgba\(196, 154, 69, \.25\)/);
  assert.match(themeCss, /\.blog-tag,\s*\.calc-result-label,\s*body\.page-home \.blog-tag \{ color: #7A5F14; \}/);
  assert.doesNotMatch(coreCss, /@import url\('https:\/\/fonts\.googleapis\.com/);
  assert.ok((homeHtml.match(/fonts\.googleapis\.com\/css2\?family=Manrope:wght@400;500;600;700;800&display=swap/) || []).length === 1);
});

test('shared CTA degrades to a real link on pages without the apply popup', () => {
  const popupLess = ['404.html', 'privacy-policy.html', 'terms-of-use.html'];
  for (const file of popupLess) {
    const html = readHtml(file);
    assert.doesNotMatch(html, /id="apply-popup"/, `${file} has no apply popup`);
  }
  assert.match(mainJs, /const hasApplyPopup = !!document\.getElementById\('apply-popup'\)/);
  assert.match(mainJs, /href="contact\.html">Apply Now/);
  assert.match(mainJs, /href="contact\.html">Apply for a loan/);
  assert.match(mainJs, /if \(document\.getElementById\('apply-popup'\)\) document\.querySelectorAll\('a, button'\)/);
  assert.match(mainJs, /window\.ASApplyPopup = \{ open: openPopup, close: closePopup \}/);
  assert.match(lendersJs, /window\.ASApplyPopup\.open\('apply-popup'\)/);
});

test('FAQ closed panels are hidden from assistive technology and restored with animation', () => {
  assert.ok((homeHtml.match(/<div class="faq-a" hidden id=/g) || []).length >= 4);
  assert.ok((readHtml('contact.html').match(/<div class="faq-a" hidden id=/g) || []).length >= 4);
  assert.match(mainJs, /panel\.hidden = false;\s*panel\.style\.maxHeight = panel\.scrollHeight/);
  assert.match(mainJs, /panel\.style\.maxHeight = '0px';[\s\S]*?panel\.hidden = true;/);
});

test('assistant mini-form captures explicit consent instead of assuming it', () => {
  assert.match(assistantJs, /name="consent" required/);
  assert.match(assistantJs, /if \(!consent \|\| !consent\.checked\) \{ addMsg\('Please confirm/);
  assert.match(coreCss, /\.as-lead-form \.as-consent\{display:flex/);
});

test('buy-vs-rent slider is clamped in the input itself', () => {
  assert.match(buyRentHtml, /down=Math\.min\(\+g\('br-down'\)\.value,price\);g\('br-down'\)\.value=down/);
});

test('inactive cinema chapters cannot receive keyboard focus', () => {
  assert.match(cinemaJs, /var exposed = state\.staticMode \|\| active;/);
  assert.match(cinemaJs, /chapter\.inert = !exposed;/);
});

test('structured data, metadata and asset dimensions are valid', () => {
  const homeJson = homeHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const graph = JSON.parse(homeJson)['@graph'];
  const ids = graph.map((n) => n['@id']);
  assert.ok(ids.includes('https://as-financial.vercel.app/#org'));
  assert.ok(ids.includes('https://as-financial.vercel.app/#website'));
  const loansJson = readHtml('loans.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  const emiJson = readHtml('emi-calculator.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(loansJson, /&(amp|ndash|mdash);/);
  assert.doesNotMatch(emiJson, /&(amp|ndash|mdash);/);
  assert.match(homeHtml, /assets\/img\/gallery\/instant\.jpg" alt="Instant loan approval" width="659" height="782"/);
  assert.match(readHtml('emi-calculator.html'), /class="calc-result-label" style="color:#7A5F14"/);
  assert.match(guidesHtml, /<h2 class="sr-only">Loan guides<\/h2>/);
  assert.ok(vercel.redirects.every((r) => r.destination === '/index.html#calculator'));
  assert.ok(!sitemap.includes('2026-11-22'));
});

test('shared landmarks and brand names expose matching accessible names', () => {
  for (const file of htmlFiles) {
    const html = readHtml(file);
    assert.doesNotMatch(html, /aria-label="AS Financial home"/, `${file} still has a mismatched brand name`);
    if (html.includes('<div class="topbar">')) assert.fail(`${file} topbar is not a labelled landmark`);
  }
  assert.match(homeHtml, /aria-label="Open AI assistant — Ask AI"/);
});

test('admin store returns applications and logo resolution is allowlisted', () => {
  assert.match(serverJs, /applications: admin\.applications \|\| \[\]/);
  assert.match(serverJs, /app\.post\('\/api\/admin\/resolve-logo'/);
  assert.match(serverJs, /function resolveLenderLogo\(name\)/);
  assert.match(serverJs, /if \(!needle \|\| !\/\^\[a-z0-9 \]\{2,80\}\$\/\.test\(needle\)\) return '';/);
  assert.match(serverJs, /if \(!\/\\\.\(svg\|png\|jpe\?g\|webp\)\$\/i\.test\(file\)\) continue;/);
  assert.ok(serverJs.includes("const key = file.replace(/\\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();"));
});
