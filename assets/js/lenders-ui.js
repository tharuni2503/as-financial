(function () {
  'use strict';
  var grid = document.querySelector('[data-lp2-grid]');
  if (!grid) return;

  var defaults = window.AS_LENDERS || {};
  var cats = defaults.categories || { psu: { label: 'Public sector bank' }, private: { label: 'Private bank' }, nbfc: { label: 'NBFC / HFC' } };
  var prods = defaults.products || { home:'Home', lap:'LAP', personal:'Personal', business:'Business', education:'Education', plot:'Plot', car:'Car', vehicle:'Vehicle', gold:'Gold', transfer:'Balance transfer', msme:'MSME' };
  var list = Array.isArray(defaults.list) ? defaults.list.slice() : [];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); };

  // The host markup declares the whole grid as a live region. Re-rendering every
  // card on each keystroke would announce the entire grid, so rely on the
  // visible counts and empty copy instead of adding noisy live announcements.
  grid.removeAttribute('aria-live');

  var LOADING_COPY = 'Loading lender options…';
  var NO_MATCH_COPY = 'No lender matches your search. Try another name, category or loan type, or ask our advisor for help.';
  var UNAVAILABLE_COPY = 'Lender information is currently unavailable. Please refresh and try again.';
  var loadState = { pending: true, ok: false, failed: false };

  // Accurate labels are applied only when the apply popup actually offers them.
  // vehicle/gold have no dedicated option here, so they fall back to
  // "Other / not sure" instead of inheriting a stale selection.
  var PRODUCT_LABELS = {
    home: ['Home Loan'],
    lap: ['Mortgage / LAP', 'Loan Against Property'],
    personal: ['Personal Loan'],
    business: ['Business Loan'],
    education: ['Education Loan'],
    plot: ['Plot / Land Loan'],
    car: ['Car Loan'],
    vehicle: ['Vehicle Loan'],
    gold: ['Gold Loan'],
    transfer: ['Balance Transfer'],
    msme: ['MSME Loan', 'Business Loan']
  };
  var PRODUCT_FALLBACK = 'Other / not sure';

  function str(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'object') return fallback;
    var out = String(value).trim();
    return out || fallback;
  }

  function strList(value, max) {
    if (!Array.isArray(value)) return [];
    return value.map(function (v) { return str(v, ''); }).filter(Boolean).slice(0, max);
  }

  function norm(l) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
    var name = str(l.n, '') || str(l.name, '') || 'Lender';
    var c = (str(l.c, '') || str(l.category, '') || 'nbfc').toLowerCase();
    if (c !== 'psu' && c !== 'private' && c !== 'nbfc') c = 'nbfc';
    var mono = str(l.i, '') || str(l.monogram, '') || name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
    var benefits = Array.isArray(l.b) && l.b.length ? l.b : l.benefits;
    var products = Array.isArray(l.p) && l.p.length ? l.p : l.products;
    return {
      n: name,
      c: c,
      i: (mono.toUpperCase() || 'LN').slice(0, 4),
      k: str(l.k, '') || str(l.color, '') || '#163968',
      logo: str(l.logo, '') || str(l.image, '') || str(l.logoUrl, '') || str(l.img, ''),
      r: str(l.r, '') || str(l.rate, '') || 'Indicative*',
      emi: str(l.emi, ''),
      t: str(l.t, '') || str(l.tenure, '') || 'As per lender*',
      amt: str(l.amt, '') || str(l.amount, '') || 'As per profile & product*',
      fee: str(l.fee, '') || 'As per lender schedule*',
      b: strList(benefits, 8),
      p: strList(products, 12)
    };
  }

  function isLenderPayload(arr) {
    if (!Array.isArray(arr) || !arr.length) return false;
    return arr.every(function (l) {
      if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
      var name = str(l.n, '') || str(l.name, '');
      var c = (str(l.c, '') || str(l.category, '')).toLowerCase();
      return !!name && (c === 'psu' || c === 'private' || c === 'nbfc');
    });
  }

  function mapFromBackend(arr) {
    if (!Array.isArray(arr)) return [];
    // Public API already hides inactive partners; keep the guard client-side too.
    return arr.filter(function (l) {
      return l && typeof l === 'object' && l.active !== false && l.published !== false;
    }).map(norm).filter(Boolean);
  }

  function setApplyProduct(sel, prodKey) {
    if (!sel || !sel.options) return;
    var options = Array.prototype.slice.call(sel.options);
    var candidates = PRODUCT_LABELS[prodKey] || [];
    var target = null;
    var i, j;
    for (i = 0; i < candidates.length && !target; i += 1) {
      for (j = 0; j < options.length; j += 1) {
        if (str(options[j].text, '') === candidates[i] || str(options[j].value, '') === candidates[i]) {
          target = options[j];
          break;
        }
      }
    }
    if (!target) {
      for (i = 0; i < options.length; i += 1) {
        if (str(options[i].text, '') === PRODUCT_FALLBACK || str(options[i].value, '') === PRODUCT_FALLBACK) {
          target = options[i];
          break;
        }
      }
    }
    if (target) sel.value = str(target.value, '') || str(target.text, '');
    else sel.selectedIndex = 0;
  }

  var cards = [];
  var state = { f: 'all', q: '', expanded: false };
  var empty = $('[data-lp2-empty]');
  var moreBtn = $('[data-lp2-more]');

  function detailsId(l, idx) {
    var slug = str(l.n, 'lender').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return 'lp2d-' + (slug || 'lender') + '-' + (idx + 1);
  }

  function card(l, idx) {
    var lenderName = str(l.n, 'Lender');
    var detailId = detailsId(l, idx);
    var tags = (l.p || []).map(function (k) { return '<span>' + esc(prods[k] || k) + '</span>'; }).join('');
    var ben = (l.b || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('');
    var onReq = /varies|depends/i.test(l.r || '');
    var facts = [
      ['Interest rate', l.r || 'Indicative*', onReq],
      ['Tenure', l.t || 'As per lender*', false],
      ['Loan amount', l.amt || 'As per profile & product*', false],
      ['Processing / charges', l.fee || 'As per lender schedule*', true]
    ].map(function (f) {
      return '<div class="lp2-fact"><small>' + esc(f[0]) + '</small><b' + (f[2] ? ' class="muted"' : '') + '>' + esc(f[1]) + '</b></div>';
    }).join('');
    if (l.emi) facts += '<div class="lp2-fact"><small>Indicative EMI / \u20B91L</small><b class="muted">' + esc(l.emi) + '</b></div>';
    var nameBlob = (lenderName + ' ' + (cats[l.c] ? cats[l.c].label : l.c) + ' ' + (l.p||[]).map(function(k){return prods[k]||k;}).join(' ')).toLowerCase();
    var logoHtml = l.logo
      ? '<span class="lp2-logo has-img" aria-hidden="true"><img src="' + esc(l.logo) + '" alt="' + esc(lenderName) + ' logo" loading="lazy" decoding="async"></span>'
      : '<span class="lp2-logo has-img lp2-logo-empty" aria-hidden="true"></span>';
    var summaryRate = esc(l.r || 'Indicative*');
    var summaryTenure = esc(l.t || 'As per lender*');
    var pNames = (l.p || []).map(function (k) { return prods[k] || k; });
    var pPreview = pNames.slice(0, 3).map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('');
    if (pNames.length > 3) pPreview += '<span class="lp2-more-tag">+' + (pNames.length - 3) + '</span>';
    return '<article class="lp2-item" data-cat="' + esc(l.c) + '" data-name="' + esc(nameBlob) + '">' +
      '<div class="lp2-row">' +
        '<div class="lp2-main">' + logoHtml +
          '<div class="lp2-title"><h3>' + esc(lenderName) + '</h3><span class="lp2-badge lp2-' + esc(l.c) + '">' + esc(cats[l.c] ? cats[l.c].label : l.c) + '</span>' +
          (pPreview ? '<div class="lp2-products-preview" aria-label="Loan types">' + pPreview + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="lp2-meta"><span class="lp2-meta-item"><small>Interest</small><b>' + summaryRate + '</b></span><span class="lp2-meta-item"><small>Tenure</small><b>' + summaryTenure + '</b></span></div>' +
        '<div class="lp2-actions">' +
          '<button type="button" class="lp2-link" data-lp2-toggle aria-expanded="false" aria-controls="' + esc(detailId) + '" aria-label="' + esc('Details for ' + lenderName) + '">Details</button>' +
          '<button type="button" class="lp2-cta" data-lp2-apply="' + esc(lenderName) + '" data-lp2-prod="' + esc((l.p && l.p[0]) || 'home') + '" aria-label="' + esc('Check options for ' + lenderName) + '">Check options</button>' +
        '</div>' +
      '</div>' +
      '<div class="lp2-details" id="' + esc(detailId) + '" hidden>' +
        '<div class="lp2-facts">' + facts + '</div>' +
        (ben ? '<ul class="lp2-benefits">' + ben + '</ul>' : '') +
        (tags ? '<div class="lp2-tags" aria-label="Products">' + tags + '</div>' : '') +
        '<p class="lp2-eligibility-note">Eligibility, rates, and charges vary by lender, profile, and product. Final terms are subject to lender assessment.</p>' +
      '</div>' +
      '</article>';
  }

  function updateCounts() {
    $$('[data-lp2-count]').forEach(function (el) { el.textContent = String(list.length); });
    $$('[data-lp2-tabcount]').forEach(function (el) {
      var f = el.getAttribute('data-lp2-tabcount');
      el.textContent = f === 'all' ? String(list.length) : String(list.filter(function (l) { return l.c === f; }).length);
    });
  }

  function emptyMessage(matches) {
    if (loadState.pending && !list.length) return LOADING_COPY;
    if (matches.length) return '';
    if (!list.length && loadState.failed) return UNAVAILABLE_COPY;
    return NO_MATCH_COPY;
  }

  function perPage() { return 6; }
  function render() {
    var q = (state.q || '').trim().toLowerCase();
    var matches = cards.filter(function (c) {
      return (state.f === 'all' || c.getAttribute('data-cat') === state.f) && (!q || (c.getAttribute('data-name') || '').indexOf(q) > -1);
    });
    var pp = perPage();
    var limit = (state.expanded || q) ? matches.length : pp;
    cards.forEach(function (c) { c.style.display = 'none'; });
    matches.forEach(function (c, idx) { if (idx < limit) c.style.display = ''; });
    if (empty) {
      var copy = emptyMessage(matches);
      if (empty.textContent !== copy) empty.textContent = copy;
      empty.hidden = !copy;
      empty.setAttribute('aria-hidden', copy ? 'false' : 'true');
    }
    if (moreBtn) {
      if (q || matches.length <= pp) {
        moreBtn.hidden = true;
        moreBtn.setAttribute('aria-expanded', 'false');
      } else {
        moreBtn.hidden = false;
        moreBtn.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
        moreBtn.textContent = state.expanded ? 'Show less' : ('Show more lenders (' + (matches.length - pp) + ')');
      }
    }
  }

  function mount() {
    var defaultsNow = window.AS_LENDERS || defaults || {};
    var catsNow = defaultsNow.categories || cats;
    var prodsNow = defaultsNow.products || prods;
    // Bundled data is only a pre-backload fallback; never resurrect it after
    // the backend has authoritatively answered with an empty result.
    if (loadState.pending && (!list || !list.length) && Array.isArray(defaultsNow.list) && defaultsNow.list.length) {
      cats = catsNow; prods = prodsNow; list = defaultsNow.list.slice();
    }
    list = list.map(norm).filter(Boolean);
    grid.innerHTML = list.map(card).join('');
    cards = $$('.lp2-item', grid);
    updateCounts();
    render();
  }

  $$('[data-lp2-tabs] .lp2-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('[data-lp2-tabs] .lp2-tab').forEach(function (t) { t.classList.remove('active'); t.setAttribute('aria-pressed', 'false'); });
      tab.classList.add('active'); tab.setAttribute('aria-pressed', 'true');
      state.f = tab.getAttribute('data-filter') || 'all';
      state.expanded = false;
      render();
    });
  });
  var search = $('[data-lp2-search]');
  if (search) search.addEventListener('input', function () { state.q = search.value || ''; state.expanded = false; render(); });
  if (moreBtn) moreBtn.addEventListener('click', function () { state.expanded = !state.expanded; render(); });
  window.addEventListener('resize', function () { if (!state.expanded && !state.q) render(); }, { passive: true });

  grid.addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-lp2-toggle]');
    var row = e.target.closest('.lp2-row');
    if (!toggle && row && !e.target.closest('.lp2-actions, [data-lp2-apply], a, button, input, select, textarea, label')) {
      toggle = row.querySelector('[data-lp2-toggle]');
    }
    if (toggle) {
      var item = toggle.closest('.lp2-item');
      var details = item ? item.querySelector('.lp2-details') : null;
      if (!details) return;
      var open = !details.hidden;
      var heading = item ? item.querySelector('h3') : null;
      var lenderName = str(heading && heading.textContent, 'this lender');
      details.hidden = open;
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      toggle.setAttribute('aria-label', open ? ('Details for ' + lenderName) : ('Hide details for ' + lenderName));
      toggle.textContent = open ? 'Details' : 'Hide';
      if (item) item.classList.toggle('is-open', !open);
      return;
    }
    var b = e.target.closest('[data-lp2-apply]');
    if (!b) return;
    var lender = b.getAttribute('data-lp2-apply') || '';
    var prodKey = b.getAttribute('data-lp2-prod') || '';
    var pop = document.getElementById('apply-popup');
    if (pop) {
      var msg = pop.querySelector('#ap-message, [name="message"]');
      var sel = pop.querySelector('#ap-product, [name="product"]');
      if (msg) msg.value = 'Interested in options from ' + lender + '. Please share suitable loan options for my profile.';
      if (sel) setApplyProduct(sel, prodKey);
      pop.classList.add('open');
      document.body.style.overflow = 'hidden';
      var first = pop.querySelector('input, select, textarea, button');
      if (first) setTimeout(function(){ try{ first.focus(); }catch(e){} }, 120);
    }
  });

  function finishLoad(ok) {
    if (!loadState.pending) return;
    loadState.pending = false;
    loadState.ok = !!ok;
    loadState.failed = !list.length;
    mount();
  }

  function loadFromBackend() {
    if (typeof fetch !== 'function') { finishLoad(false); return; }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function(){ if (ctrl) try{ ctrl.abort(); }catch(e){} }, 5000);
    var opts = ctrl ? { credentials: 'same-origin', signal: ctrl.signal } : { credentials: 'same-origin' };
    return fetch('api/content', opts).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      clearTimeout(t);
      var raw = j && Array.isArray(j.lenders) ? j.lenders : null;
      if (!isLenderPayload(raw)) { finishLoad(false); return; }
      // A valid non-empty backend list is authoritative, even when it is
      // smaller than the bundled fallback. Bundled data is used only when the
      // API is unavailable, empty or malformed.
      list = mapFromBackend(raw);
      finishLoad(list.length > 0);
    }).catch(function(){ clearTimeout(t); finishLoad(false); });
  }

  // Initial render with bundled fallback, then try backend content.
  mount();
  if (!list.length) {
    setTimeout(function(){ if (!list.length) mount(); }, 600);
    setTimeout(function(){ if (!list.length) mount(); }, 1800);
  }
  loadFromBackend();
})();
