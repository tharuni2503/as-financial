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

  function norm(l) {
    if (!l || typeof l !== 'object') return null;
    var c = String(l.c || l.category || 'nbfc').toLowerCase();
    if (c !== 'psu' && c !== 'private' && c !== 'nbfc') c = 'nbfc';
    var name = l.n || l.name || 'Lender';
    return {
      n: name,
      c: c,
      i: (l.i || l.monogram || String(name).slice(0, 2)).toUpperCase(),
      k: l.k || l.color || '#163968',
      logo: l.logo || l.image || l.logoUrl || l.img || '',
      r: l.r || l.rate || 'Indicative*',
      emi: l.emi || '',
      t: l.t || l.tenure || 'As per lender*',
      amt: l.amt || l.amount || 'As per profile & product*',
      fee: l.fee || 'As per lender schedule*',
      b: Array.isArray(l.b) ? l.b : (Array.isArray(l.benefits) ? l.benefits : []),
      p: Array.isArray(l.p) ? l.p : (Array.isArray(l.products) ? l.products : [])
    };
  }

  function mapFromBackend(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(norm).filter(Boolean);
  }

  var cards = [];
  var state = { f: 'all', q: '', expanded: false };
  var empty = $('[data-lp2-empty]');
  var moreBtn = $('[data-lp2-more]');

  function card(l) {
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
    var nameBlob = (l.n + ' ' + (cats[l.c] ? cats[l.c].label : l.c) + ' ' + (l.p||[]).map(function(k){return prods[k]||k;}).join(' ')).toLowerCase();
    var logoHtml = l.logo
      ? '<span class="lp2-logo has-img" aria-hidden="true"><img src="' + esc(l.logo) + '" alt="' + esc(l.n) + ' logo" loading="lazy" decoding="async"></span>'
      : '<span class="lp2-logo has-img lp2-logo-empty" aria-hidden="true"></span>';
    var summaryRate = esc(l.r || 'Indicative*');
    var summaryTenure = esc(l.t || 'As per lender*');
    var detailsId = 'lp2d-' + Math.random().toString(36).slice(2, 9);
    return '<article class="lp2-item" data-cat="' + esc(l.c) + '" data-name="' + esc(nameBlob) + '">' +
      '<div class="lp2-row">' +
        '<div class="lp2-main">' + logoHtml +
          '<div class="lp2-title"><h3>' + esc(l.n) + '</h3><span class="lp2-badge lp2-' + esc(l.c) + '">' + esc(cats[l.c] ? cats[l.c].label : l.c) + '</span></div>' +
        '</div>' +
        '<div class="lp2-meta"><span class="lp2-meta-item"><small>Interest</small><b>' + summaryRate + '</b></span><span class="lp2-meta-item"><small>Tenure</small><b>' + summaryTenure + '</b></span></div>' +
        '<div class="lp2-actions">' +
          '<button type="button" class="lp2-link" data-lp2-toggle aria-expanded="false" aria-controls="' + detailsId + '">Details</button>' +
          '<button type="button" class="lp2-cta" data-lp2-apply="' + esc(l.n) + '" data-lp2-prod="' + esc((l.p && l.p[0]) || 'home') + '">Check</button>' +
        '</div>' +
      '</div>' +
      '<div class="lp2-details" id="' + detailsId + '" hidden>' +
        '<div class="lp2-facts">' + facts + '</div>' +
        (ben ? '<ul class="lp2-benefits">' + ben + '</ul>' : '') +
        (tags ? '<div class="lp2-tags" aria-label="Products">' + tags + '</div>' : '') +
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
    if (empty) empty.hidden = matches.length > 0;
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
      details.hidden = open;
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
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
      if (sel) {
        var map = { home:'Home Loan', lap:'Mortgage / LAP', personal:'Personal Loan', business:'Business Loan', education:'Education Loan', plot:'Plot / Land Loan', car:'Car Loan', vehicle:'Car Loan', transfer:'Balance Transfer' };
        var want = map[prodKey];
        if (want) Array.prototype.forEach.call(sel.options, function (o) { if ((o.text||'').indexOf(want) > -1 || (o.value||'') === want) sel.value = o.value || o.text; });
      }
      pop.classList.add('open');
      document.body.style.overflow = 'hidden';
      var first = pop.querySelector('input, select, textarea, button');
      if (first) setTimeout(function(){ try{ first.focus(); }catch(e){} }, 120);
    }
  });

  function loadFromBackend() {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function(){ if (ctrl) try{ ctrl.abort(); }catch(e){} }, 5000);
    var opts = ctrl ? { credentials: 'same-origin', signal: ctrl.signal } : { credentials: 'same-origin' };
    return fetch('/api/content', opts).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      clearTimeout(t);
      if (!j) return;
      var fromApi = mapFromBackend(j.lenders || []);
      if (fromApi.length) list = fromApi;
    }).catch(function(){ clearTimeout(t); });
  }

  // Initial render with bundled fallback, then try backend content.
  mount();
  loadFromBackend().then(function () {
    // Re-mount if backend provided lenders (list already replaced when non-empty)
    mount();
  });
})();
