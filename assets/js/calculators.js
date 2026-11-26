(function () {
  'use strict';
  function initTabbedCalculators() {
    var root = document.querySelector('[data-calc-tabs]');
    if (!root || root.dataset.ready === '1') return;
    root.dataset.ready = '1';

    function inr(n) {
      n = Math.round(Number(n) || 0);
      var neg = n < 0; n = Math.abs(n);
      var s = String(n);
      if (s.length > 3) {
        var last3 = s.slice(-3);
        var rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
        s = rest + ',' + last3;
      }
      return (neg ? '-₹' : '₹') + s;
    }
    function pct(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).replace(/\.00$/, '') + '%'; }
    function emi(P, annualRate, months) {
      P = Number(P) || 0; annualRate = Number(annualRate) || 0; months = Math.max(1, Math.round(Number(months) || 0));
      var r = annualRate / 12 / 100;
      if (r === 0) return P / months;
      var p = Math.pow(1 + r, months);
      return P * r * p / (p - 1);
    }
    function loanFromEmi(e, annualRate, months) {
      e = Number(e) || 0; annualRate = Number(annualRate) || 0; months = Math.max(1, Math.round(Number(months) || 0));
      var r = annualRate / 12 / 100;
      if (r === 0) return e * months;
      var p = Math.pow(1 + r, months);
      return e * (p - 1) / (r * p);
    }
    function setFill(el) {
      var min = parseFloat(el.min), max = parseFloat(el.max), val = parseFloat(el.value);
      var pctv = max > min ? ((val - min) / (max - min)) * 100 : 0;
      el.style.setProperty('--fill', pctv + '%');
    }
    function bindRange(id, outId, fmt, onChange) {
      var el = document.getElementById(id), out = document.getElementById(outId);
      if (!el) return function(){};
      var render = function () {
        setFill(el);
        if (out) out.textContent = fmt ? fmt(el.value) : el.value;
        if (onChange) onChange();
      };
      el.addEventListener('input', render);
      render();
      return render;
    }

    // Tabs
    var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tablist"] [role="tab"][data-calc-tab]'));
    var panels = Array.prototype.slice.call(root.querySelectorAll('[data-calc-panel]'));
    function activate(tabId) {
      tabs.forEach(function (t) {
        var active = t.getAttribute('data-calc-tab') === tabId;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
        t.tabIndex = active ? 0 : -1;
      });
      panels.forEach(function (p) {
        var active = p.getAttribute('data-calc-panel') === tabId;
        p.classList.toggle('is-active', active);
        p.hidden = !active;
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () { activate(t.getAttribute('data-calc-tab')); });
      t.addEventListener('keydown', function (event) {
        var index = tabs.indexOf(t);
        var target = index;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % tabs.length;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = tabs.length - 1;
        else return;
        event.preventDefault();
        var next = tabs[target];
        activate(next.getAttribute('data-calc-tab'));
        next.focus();
      });
    });

    // EMI
    function setDonut(principalEl, interestEl, interestPct) {
      var C = 326.73;
      var ip = Math.max(0, Math.min(100, Number(interestPct) || 0));
      var pp = 100 - ip;
      if (principalEl) principalEl.style.strokeDasharray = (pp / 100 * C) + ' ' + C;
      if (interestEl) {
        interestEl.style.strokeDasharray = (ip / 100 * C) + ' ' + C;
        interestEl.style.strokeDashoffset = (-pp / 100 * C) + '';
      }
    }
    function calcEmi() {
      var a = document.getElementById('emi-amount'), rEl = document.getElementById('emi-rate'), yEl = document.getElementById('emi-tenure');
      if (!a || !rEl || !yEl) return;
      var P = +a.value, r = +rEl.value, y = +yEl.value;
      var months = Math.max(1, Math.round(y * 12));
      var e = emi(P, r, months);
      var total = e * months;
      var interest = Math.max(0, total - P);
      var interestPct = total > 0 ? (interest / total * 100) : 0;
      var principalPct = 100 - interestPct;
      var out = document.getElementById('emi-out'); if (out) out.textContent = inr(e);
      var pr = document.getElementById('emi-principal'); if (pr) pr.textContent = inr(P);
      var intr = document.getElementById('emi-interest'); if (intr) intr.textContent = inr(interest);
      var tot = document.getElementById('emi-total'); if (tot) tot.textContent = inr(total);
      var ppct = document.getElementById('emi-principal-pct'); if (ppct) ppct.textContent = principalPct.toFixed(1).replace(/\.0$/, '') + '%';
      var ipct = document.getElementById('emi-interest-pct'); if (ipct) ipct.textContent = interestPct.toFixed(1).replace(/\.0$/, '') + '%';
      setDonut(document.getElementById('emi-donut-principal'), document.getElementById('emi-donut-interest'), interestPct);
    }
    bindRange('emi-amount', 'emi-amount-out', function(v){ return inr(v); }, calcEmi);
    bindRange('emi-rate', 'emi-rate-out', function(v){ return pct(v); }, calcEmi);
    bindRange('emi-tenure', 'emi-tenure-out', function(v){ v=+v; return v + (v===1?' year':' years'); }, calcEmi);

    // Affordability
    var FOIR = 0.5;
    function calcAff() {
      var inc = document.getElementById('aff-income'), ob = document.getElementById('aff-oblig'), rEl = document.getElementById('aff-rate'), yEl = document.getElementById('aff-tenure');
      if (!inc || !ob || !rEl || !yEl) return;
      var income = +inc.value, oblig = Math.max(0, +ob.value), r = +rEl.value, y = +yEl.value;
      var months = Math.max(1, Math.round(y * 12));
      var capacity = Math.max(0, income * FOIR - oblig);
      if (oblig > income) oblig = income;
      if (oblig + capacity > income) capacity = Math.max(0, income - oblig);
      var remain = Math.max(0, income - oblig - capacity);
      var loan = Math.max(0, loanFromEmi(capacity, r, months));
      var loanOut = document.getElementById('aff-loan-out'); if (loanOut) loanOut.textContent = inr(loan);
      var emiOut = document.getElementById('aff-emi-out'); if (emiOut) emiOut.textContent = inr(capacity);
      var obShow = document.getElementById('aff-oblig-show'); if (obShow) obShow.textContent = inr(oblig);
      var inShow = document.getElementById('aff-income-show'); if (inShow) inShow.textContent = inr(income);
      var op = income > 0 ? (oblig / income * 100) : 0;
      var cp = income > 0 ? (capacity / income * 100) : 0;
      var rp = Math.max(0, 100 - op - cp);
      var opEl = document.getElementById('aff-oblig-pct'); if (opEl) opEl.textContent = Math.round(op) + '%';
      var cpEl = document.getElementById('aff-capacity-pct'); if (cpEl) cpEl.textContent = Math.round(cp) + '%';
      var rpEl = document.getElementById('aff-remain-pct'); if (rpEl) rpEl.textContent = Math.round(rp) + '%';
      var wheel = document.getElementById('aff-wheel');
      if (wheel) wheel.style.setProperty('--wheel-bg', 'conic-gradient(#d8b35a 0% ' + op + '%, #163968 ' + op + '% ' + (op + cp) + '%, #e6edf6 ' + (op + cp) + '% 100%)');
    }
    bindRange('aff-income', 'aff-income-out', function(v){ return inr(v); }, calcAff);
    bindRange('aff-oblig', 'aff-oblig-out', function(v){ return inr(v); }, calcAff);
    bindRange('aff-rate', 'aff-rate-out', function(v){ return pct(v); }, calcAff);
    bindRange('aff-tenure', 'aff-tenure-out', function(v){ v=+v; return v + (v===1?' year':' years'); }, calcAff);

    // Down payment
    function calcDp() {
      var vEl = document.getElementById('dp-value'), dpEl = document.getElementById('dp-amount'), rEl = document.getElementById('dp-rate'), yEl = document.getElementById('dp-tenure');
      if (!vEl || !dpEl || !rEl || !yEl) return;
      var value = +vEl.value, dp = +dpEl.value, r = +rEl.value, y = +yEl.value;
      if (dp > value) { dp = value; dpEl.value = dp; }
      var loan = Math.max(0, value - dp);
      var months = Math.max(1, Math.round(y * 12));
      var e = emi(loan, r, months);
      var dpPct = value > 0 ? (dp / value * 100) : 0;
      var loanPct = 100 - dpPct;
      var dpText = inr(dp) + ' (' + (Math.round(dpPct * 10) / 10).toFixed(1).replace(/\.0$/, '') + '%)';
      var outA = document.getElementById('dp-amount-out'); if (outA) outA.textContent = dpText;
      var loanOut = document.getElementById('dp-loan-out'); if (loanOut) loanOut.textContent = inr(loan);
      var aShow = document.getElementById('dp-amount-show'); if (aShow) aShow.textContent = dpText;
      var eOut = document.getElementById('dp-emi-out'); if (eOut) eOut.textContent = inr(e);
      var vShow = document.getElementById('dp-value-show'); if (vShow) vShow.textContent = inr(value);
      var lp = document.getElementById('dp-loan-pct'); if (lp) lp.textContent = loanPct.toFixed(1).replace(/\.0$/, '') + '%';
      var dpp = document.getElementById('dp-dp-pct'); if (dpp) dpp.textContent = dpPct.toFixed(1).replace(/\.0$/, '') + '%';
      setDonut(document.getElementById('dp-donut-loan'), document.getElementById('dp-donut-dp'), dpPct);
    }
    bindRange('dp-value', 'dp-value-out', function(v){ return inr(v); }, calcDp);
    (function(){
      var el = document.getElementById('dp-amount');
      if (!el) return;
      var render = function(){ setFill(el); calcDp(); };
      el.addEventListener('input', render); render();
    })();
    bindRange('dp-rate', 'dp-rate-out', function(v){ return pct(v); }, calcDp);
    bindRange('dp-tenure', 'dp-tenure-out', function(v){ v=+v; return v + (v===1?' year':' years'); }, calcDp);

    // BT
    function calcBt() {
      var b = document.getElementById('bt-balance'), o = document.getElementById('bt-old'), nEl = document.getElementById('bt-new'), m = document.getElementById('bt-months');
      if (!b || !o || !nEl || !m) return;
      var P = +b.value, r1 = +o.value, r2 = +nEl.value, n = Math.max(1, Math.round(+m.value));
      var e1 = emi(P, r1, n), e2 = emi(P, r2, n);
      var save = Math.max(0, e1 - e2);
      var ints = Math.max(0, (e1 - e2) * n);
      var sOut = document.getElementById('bt-save-out'); if (sOut) sOut.textContent = inr(save);
      var oe = document.getElementById('bt-old-emi'); if (oe) oe.textContent = inr(e1);
      var ne = document.getElementById('bt-new-emi'); if (ne) ne.textContent = inr(e2);
      var oeb = document.getElementById('bt-old-emi-bar'); if (oeb) oeb.textContent = inr(e1);
      var neb = document.getElementById('bt-new-emi-bar'); if (neb) neb.textContent = inr(e2);
      var isv = document.getElementById('bt-interest-save'); if (isv) isv.textContent = inr(ints);
      var savePct = e1 > 0 ? (save / e1 * 100) : 0;
      var newPct = e1 > 0 ? (e2 / e1 * 100) : 0;
      if (newPct > 100) newPct = 100;
      var bOld = document.getElementById('bt-bar-old'); if (bOld) bOld.style.width = '100%';
      var bNew = document.getElementById('bt-bar-new'); if (bNew) bNew.style.width = Math.max(0, newPct) + '%';
      var sp = document.getElementById('bt-save-pct'); if (sp) sp.textContent = savePct.toFixed(1).replace(/\.0$/, '') + '%';
      var np = document.getElementById('bt-new-pct'); if (np) np.textContent = (100 - savePct).toFixed(1).replace(/\.0$/, '') + '%';
      var wheel = document.getElementById('bt-wheel');
      if (wheel) wheel.style.setProperty('--wheel-bg', 'conic-gradient(#163968 0% ' + (100 - savePct) + '%, #d8b35a ' + (100 - savePct) + '% 100%)');
    }
    bindRange('bt-balance', 'bt-balance-out', function(v){ return inr(v); }, calcBt);
    bindRange('bt-old', 'bt-old-out', function(v){ return pct(v); }, calcBt);
    bindRange('bt-new', 'bt-new-out', function(v){ return pct(v); }, calcBt);
    bindRange('bt-months', 'bt-months-out', function(v){ v=Math.round(+v); return v + ' months'; }, calcBt);

    setTimeout(function(){
      [calcEmi, calcAff, calcDp, calcBt].forEach(function(fn){ try{ fn(); }catch(e){} });
      root.querySelectorAll('input[type="range"]').forEach(setFill);
    }, 50);
  }

  // Keep aria-pressed in sync with the active state of toggle-style calculator buttons.
  function initPressedButtons() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-tenure-unit], [data-preset]'));
    function sync() {
      buttons.forEach(function (b) {
        b.setAttribute('aria-pressed', b.classList.contains('active') ? 'true' : 'false');
      });
    }
    if (!buttons.length) return;
    buttons.forEach(function (b) { b.addEventListener('click', sync); });
    sync();
  }

  function onReady() {
    initTabbedCalculators();
    initPressedButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();