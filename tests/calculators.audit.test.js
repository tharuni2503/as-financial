'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const js = read('assets/js/calculators.js');
const emi = read('emi-calculator.html');
const bt = read('balance-transfer-calculator.html');
const pp = read('prepayment-calculator.html');
const tenure = read('tenure-calculator.html');
const tax = read('home-loan-tax-saving-calculator.html');
const buyRent = read('buy-vs-rent-calculator.html');

test('EMI results are announced politely to assistive technology', () => {
  assert.match(emi, /<div class="calc-side" aria-live="polite">/);
  assert.match(emi, /<span data-out="emi" role="status">/);
});

test('EMI toggle buttons expose pressed state and keep it in sync with .active', () => {
  const pressedFalse = emi.match(/aria-pressed="false"/g) || [];
  assert.equal(pressedFalse.length, 6, 'Years, Months and four presets start with aria-pressed="false"');
  assert.equal((emi.match(/<button[^>]*data-tenure-unit=/g) || []).length, 2);
  assert.equal((emi.match(/<button[^>]*data-preset=/g) || []).length, 4);

  assert.match(emi, /b\.setAttribute\('aria-pressed', active \? 'true' : 'false'\)/);
  assert.match(emi, /syncPressed\(\);[\s\S]{0,80}data-tenure-unit/);
  assert.match(js, /\[data-tenure-unit\], \[data-preset\]/);
  assert.match(js, /b\.setAttribute\('aria-pressed', b\.classList\.contains\('active'\) \? 'true' : 'false'\)/);
});

test('calculator tablist supports Arrow/Home/End keys and moves focus', () => {
  assert.match(js, /\[role="tablist"\] \[role="tab"\]\[data-calc-tab\]/);
  assert.match(js, /addEventListener\('keydown'/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    assert.ok(js.includes("event.key === '" + key + "'"), 'handles ' + key);
  }
  assert.match(js, /activate\(next\.getAttribute\('data-calc-tab'\)\)/);
  assert.match(js, /next\.focus\(\)/);
  assert.match(js, /t\.tabIndex = active \? 0 : -1/);
});

test('balance transfer copy reports signed differences instead of zero savings', () => {
  assert.match(bt, /id="res-save-label"/);
  assert.match(bt, /id="res-rate-note"[^>]*hidden>No saving — new rate is higher/);
  assert.match(bt, /label\.textContent='EMI increases by '\+inr\(-diff\)/);
  assert.match(bt, /const diff=e1-e2, intDiff=diff\*n/);
  assert.match(bt, /\.textContent=signed\(diff\)/);
  assert.match(bt, /\.textContent=signed\(intDiff\)/);
  assert.ok(!/Math\.max\(0,\s*e1-e2\)/.test(bt), 'no clamped monthly difference');
  assert.ok(!/Math\.max\(0,\s*\(e1-e2\)\*n\)/.test(bt), 'no clamped interest difference');
  assert.match(bt, /Indicative only/);
});

test('balance transfer runtime: higher rate shows increase, lower rate shows saving', () => {
  const blocks = Array.from(bt.matchAll(/<script>([\s\S]*?)<\/script>/g));
  assert.ok(blocks.length, 'inline calculator script is present');
  const script = blocks[blocks.length - 1][1];

  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        textContent: '',
        hidden: false,
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
        dispatch(type) { (this.listeners[type] || []).forEach((fn) => fn()); }
      });
    }
    return elements.get(id);
  };
  const document = { getElementById: el };
  el('bt-balance').value = '3000000';
  el('bt-old').value = '10.5';
  el('bt-new').value = '12';
  el('bt-months').value = '180';

  new Function('document', script)(document);

  assert.match(el('res-save-label').textContent, /^EMI increases by ₹ [\d,]+$/);
  assert.match(el('res-save').textContent, /^-₹ [\d,]+$/, 'negative signed saving is not shown as ₹ 0');
  assert.match(el('res-int').textContent, /^-₹ [\d,]+$/);
  assert.equal(el('res-rate-note').hidden, false);
  assert.match(el('res-rate-note').textContent, /No saving — new rate is higher/);
  assert.equal(el('res-int-label').textContent, 'Extra total interest (approx.)');

  el('bt-new').value = '8.75';
  el('bt-new').dispatch('input');
  assert.equal(el('res-save-label').textContent, 'Estimated monthly savings');
  assert.equal(el('res-save').textContent, '₹ 3,179');
  assert.equal(el('res-int').textContent, '₹ 5,72,131');
  assert.equal(el('res-rate-note').hidden, true);
  assert.equal(el('res-int-label').textContent, 'Total interest saving (approx.)');

  el('bt-new').value = '10.5';
  el('bt-new').dispatch('input');
  assert.match(el('res-save-label').textContent, /No EMI change/);
});

test('tax result headline is regime-specific and keeps the important note', () => {
  assert.match(tax, /Estimated annual tax saving \(old regime, if eligible\)/);
  assert.match(tax, /new tax regime, you may get no benefit/);
  assert.match(tax, /Important note/);
  assert.match(tax, /Regime & eligibility matter/);
});

test('calculator copy avoids unsupported promises and aligns FOIR with ~40-50%', () => {
  assert.ok(!/We can lower it\./.test(emi));
  assert.ok(!/leading banks/i.test(emi));
  assert.ok(!/negotiate on your behalf/i.test(emi));
  assert.ok(!/free of cost/i.test(emi));
  assert.ok(!/Even one extra EMI a year can cut years off/.test(emi));
  assert.ok(!/Keep EMIs under 40%/.test(emi));
  assert.match(emi, /we can help you explore options that may lower it/i);
  assert.match(emi, /can reduce total interest and may shorten tenure/);
  assert.match(emi, /40[–-]50% of net monthly income/);
});

test('no-JS result placeholders match the computed defaults', () => {
  assert.match(bt, /id="res-save">₹ 3,179</);
  assert.match(bt, /id="res-old">₹ 33,162</);
  assert.match(bt, /id="res-new">₹ 29,983</);
  assert.match(bt, /id="res-int">₹ 5,72,131</);

  assert.match(tenure, /id="res-tenure">~ 166 months</);
  assert.match(tenure, /id="res-years">~ 13\.8 years</);
  assert.match(tenure, /id="res-total">₹ 36,52,000</);
  assert.match(tenure, /id="res-int">₹ 16,52,000</);

  assert.match(pp, /id="res-save">₹ 2,60,918</);
  assert.match(pp, /id="res-emi">₹ 25,607</);
  assert.match(pp, /id="res-bal">₹ 18,00,000</);
  assert.match(pp, /id="res-tenure">~ 102 months</);

  assert.match(tax, /id="res-save">₹ 1,05,000</);
  assert.match(tax, /id="res-p">₹ 45,000</);
  assert.match(tax, /id="res-i">₹ 60,000</);

  assert.match(buyRent, /id="res-diff">Buying costs ₹ 20,418 more\/mo</);
  assert.match(buyRent, /id="res-buy">₹ 45,418</);
  assert.match(buyRent, /id="res-rent">₹ 25,000</);
  assert.match(buyRent, /id="res-emi">₹ 42,418</);

  assert.match(emi, /data-out="interest">₹43,31,103</);
  assert.match(emi, /data-out="total">₹83,31,103</);
});

test('all six calculators keep live input handlers, disclaimers and lead hooks', () => {
  for (const html of [bt, pp, tenure, tax, buyRent]) {
    assert.match(html, /addEventListener\('input',\s*(?:run|calc)\)/);
    assert.match(html, /Indicative only/);
    assert.match(html, /data-lead-form/);
  }
  assert.match(emi, /data-calculator="full"/);
  assert.match(emi, /dispatchEvent\(new Event\('input'\)\)/);
  assert.match(emi, /assets\/js\/main\.js/);
  assert.match(emi, /data-lead-form/);
});
