/* ==========================================================================
   AS Financial — public site interactions
   ========================================================================== */
(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    businessName: 'AS Financial Services and Solutions',
    tagline: 'Your Goals, Our Solutions',
    phone: '+91 91827 03079',
    phoneRaw: '919182703079',
    email: 'asfinancialservicesandsolution@gmail.com',
    address: 'Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098',
    hours: 'Mon – Sat · 9:30 AM – 7:00 PM',
    whatsapp: '919182703079'
  };

  /* ---------- storage helpers ---------- */
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  const settings = Object.assign({}, DEFAULT_SETTINGS, read('as_settings', {}));

  function getVisitorId() {
    try {
      let id = localStorage.getItem('as_vid');
      if (!id) {
        id = 'V-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem('as_vid', id);
      }
      return id;
    } catch (e) { return ''; }
  }

  function getSessionId() {
    try {
      let id = sessionStorage.getItem('as_sid');
      if (!id) { id = 'S-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); sessionStorage.setItem('as_sid', id); }
      return id;
    } catch (e) { return ''; }
  }

  function getUtm() {
    try {
      const p = new URLSearchParams(location.search);
      const utm = {};
      ['utm_source','utm_medium','utm_campaign'].forEach(k => { const v = p.get(k); if (v) utm[k] = v.slice(0, 80); });
      if (Object.keys(utm).length) sessionStorage.setItem('as_utm', JSON.stringify(utm));
      const stored = JSON.parse(sessionStorage.getItem('as_utm') || '{}');
      return stored && typeof stored === 'object' ? stored : {};
    } catch (e) { return {}; }
  }

  function trackEvent(type, meta) {
    try {
      const utm = getUtm();
      const payload = {
        eventId: 'EVT-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        type: type,
        page: location.pathname + (location.hash || ''),
        visitorId: getVisitorId(),
        sessionId: getSessionId(),
        referrer: document.referrer || '',
        utmSource: utm.utm_source || '',
        utmMedium: utm.utm_medium || '',
        utmCampaign: utm.utm_campaign || '',
        meta: Object.assign({}, utm, meta || {})
      };
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
    } catch (e) {}
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (a) {
      const href = String(a.getAttribute('href') || '');
      const label = (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 80);
      if (href.startsWith('tel:')) { trackEvent('phone_click', { label, href: 'tel' }); return; }
      if (href.startsWith('mailto:')) { trackEvent('email_click', { label, href: 'mailto' }); return; }
      if (/wa\.me|whatsapp/i.test(href)) { trackEvent('whatsapp_click', { label, href: 'whatsapp' }); return; }
      if (a.hasAttribute('download')) { trackEvent('download_click', { label, href: href.slice(0,120) }); return; }
      try {
        const url = new URL(href, location.href);
        if (url.origin !== location.origin && /^https?:/.test(url.protocol)) trackEvent('external_link_click', { label, href: url.origin });
      } catch (_) {}
    }
    const cta = e.target.closest('[data-popup-open],[data-open-apply],.apply-btn,.enquire-btn,[data-track="cta"]');
    if (cta) {
      const label = (cta.getAttribute('aria-label') || cta.textContent || '').trim().slice(0, 80);
      trackEvent('cta_click', { label, action: cta.getAttribute('data-track') || 'cta' });
    }
  }, { capture: true });

  const flushAbandon = (reason) => {
    document.querySelectorAll('[data-lead-form]').forEach(f => { if (typeof f._asTrackAbandon === 'function') f._asTrackAbandon(reason); });
  };
  window.addEventListener('pagehide', () => flushAbandon('pagehide'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAbandon('hidden'); });

  /* ---------- inject business details ---------- */
  function setAnchorText(el, key) {
    const val = settings[key];
    if (val == null) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) { if (n.nodeValue.trim()) nodes.push(n); }
    if (!nodes.length) return;
    if (key === 'phone') {
      nodes.forEach(node => { node.nodeValue = node.nodeValue.replace(/(?:\+?91[\s-]*)?\d{5}[\s-]*\d{5}/, val); });
    } else if (key === 'email') {
      nodes.forEach(node => { node.nodeValue = node.nodeValue.replace(/[\w.+-]+@[\w.-]+\.\w+/, val); });
    } else if (key === 'address') {
      nodes[nodes.length - 1].nodeValue = val;
    }
  }

  function applySettings() {
    document.querySelectorAll('[data-setting]').forEach(el => {
      const key = el.getAttribute('data-setting');
      if (settings[key] == null) return;
      if (el.tagName === 'A') {
        if (key === 'phone') {
          el.href = 'tel:+' + (settings.phoneRaw || settings.phone).replace(/[^\d]/g, '');
        } else if (key === 'email') {
          el.href = 'mailto:' + settings.email;
        } else if (key === 'address') {
          el.href = 'https://maps.google.com/?q=' + encodeURIComponent(settings.address);
          el.target = '_blank';
          el.rel = 'noopener';
        } else if (key === 'whatsapp') {
          el.href = 'https://wa.me/' + settings.whatsapp + '?text=' + encodeURIComponent('Hi AS Financial, I would like to know more about your loan services.');
        }
        if (key === 'phone' || key === 'email' || key === 'address') setAnchorText(el, key);
      } else {
        el.textContent = settings[key];
      }
    });
    const wa = document.querySelector('[data-wa-link]');
    if (wa) wa.href = 'https://wa.me/' + settings.whatsapp + '?text=' + encodeURIComponent(wa.dataset.waLink || 'Hi AS Financial, I need help with a loan.');
  }
  applySettings();
  trackEvent('page_view', { title: document.title || '' });

  /* ---------- toast ---------- */
  window.asToast = function (message, type) {
    let host = document.querySelector('.as-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'as-toast-host';
      host.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:400;display:grid;gap:8px;width:min(92vw,420px)';
      document.body.appendChild(host);
    }
    const t = document.createElement('div');
    t.style.cssText = 'background:' + (type === 'error' ? '#b3423a' : '#0d2b4e') + ';color:#fff;padding:13px 18px;border-radius:12px;font-size:.84rem;font-weight:600;box-shadow:0 18px 40px -18px rgba(7,28,51,.6);display:flex;gap:9px;align-items:center;opacity:0;transform:translateY(10px);transition:.25s';
    t.innerHTML = '<svg class="icon" style="width:18px;height:18px;flex:none" aria-hidden="true"><use href="#i-' + (type === 'error' ? 'alert' : 'check-circle') + '"></use></svg><span></span>';
    t.querySelector('span').textContent = message;
    host.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'none'; });
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 300); }, 3600);
  };

  /* ---------- header ---------- */
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- live ticker (under navbar) ---------- */
  (function initLiveTicker() {
    try {
      if (document.body && document.body.classList.contains('admin-page')) return;
      const siteHeader = document.querySelector('.site-header');
      if (!siteHeader || document.querySelector('.live-ticker')) return;

      const fallbackItems = [
        'Compare loan options from SBI, HDFC Bank, ICICI Bank, Axis Bank & Kotak Mahindra Bank',
        'Public sector banks: Bank of Baroda, Canara Bank, Union Bank, PNB & Indian Bank',
        'Private banks: IDFC FIRST Bank, Yes Bank, Federal Bank, IndusInd Bank & Bandhan Bank',
        'NBFCs & HFCs: Bajaj Finserv, Tata Capital, HDB Financial, L&T Finance & LIC Housing Finance',
        'Rates & terms indicative*, subject to lender policy & eligibility',
        'Call +91 91827 03079 • Medipalli, Hyderabad'
      ];

      const ticker = document.createElement('div');
      ticker.className = 'live-ticker';
      ticker.setAttribute('role', 'status');
      ticker.setAttribute('aria-label', 'Live lender updates');
      ticker.innerHTML =
        '<span class="live-ticker-badge"><span class="live-ticker-dot" aria-hidden="true"></span>LIVE</span>' +
        '<div class="live-ticker-track"><div class="live-ticker-marquee"></div></div>';
      siteHeader.insertAdjacentElement('afterend', ticker);
      document.body.classList.add('has-live-ticker');

      const marquee = ticker.querySelector('.live-ticker-marquee');
      const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      function renderItems(items) {
        if (!marquee) return;
        const list = (items && items.length ? items : fallbackItems).slice(0, 60);
        const row = list.map(t => '<span class="live-ticker-item">' + escHtml(t) + '</span>').join('');
        marquee.innerHTML = row + row;
      }

      const prodShort = { home: 'Home', lap: 'LAP', personal: 'Personal', business: 'Business', education: 'Education', plot: 'Plot', car: 'Car', vehicle: 'Vehicle', gold: 'Gold', transfer: 'BT', msme: 'MSME' };
      function normalizeLenders(raw) {
        const list = Array.isArray(raw && raw.list) ? raw.list : (Array.isArray(raw) ? raw : []);
        return list.map(l => {
          if (!l || typeof l !== 'object') return null;
          const name = String(l.n || l.name || '').trim();
          if (!name) return null;
          const rate = String(l.r || l.rate || l.interestRate || '').trim();
          const tenure = String(l.t || l.tenure || '').trim();
          const amount = String(l.amt || l.amount || '').trim();
          const products = Array.isArray(l.p) ? l.p : (Array.isArray(l.products) ? l.products : []);
          return { name, rate, tenure, amount, products };
        }).filter(Boolean);
      }
      function buildItems(lenders, productsMap) {
        const pmap = productsMap || (window.AS_LENDERS && window.AS_LENDERS.products) || prodShort;
        const out = [];
        lenders.slice(0, 24).forEach(l => {
          const parts = [l.name];
          if (l.rate) parts.push(l.rate.replace(/\s+/g, ' '));
          if (l.tenure) parts.push(l.tenure);
          else if (l.amount) parts.push(l.amount);
          const prods = (l.products || []).map(p => pmap[p] || prodShort[p] || p).filter(Boolean).slice(0, 3);
          if (prods.length) parts.push(prods.join(', ') + ((l.products || []).length > 3 ? ' & more' : ''));
          out.push(parts.join(' • '));
        });
        if (out.length) {
          out.push('Rates, tenure & amounts are indicative* • Subject to lender policy & eligibility');
          out.push('Compare banks & NBFCs with AS Financial • Call +91 91827 03079');
        }
        return out.length ? out : fallbackItems;
      }

      async function loadAndRender() {
        try {
          let lenders = normalizeLenders(window.AS_LENDERS);
          let pmap = (window.AS_LENDERS && window.AS_LENDERS.products) || null;
          if (!lenders.length && window.ASBackend && window.ASBackend.request) {
            const data = await window.ASBackend.request('api/content');
            lenders = normalizeLenders(data && data.lenders);
          }
          if (lenders.length) renderItems(buildItems(lenders, pmap));
        } catch (e) { /* keep fallback */ }
      }

      renderItems(fallbackItems);
      loadAndRender();
      // lenders.js may load after this script (deferred order varies by page); retry shortly
      let tries = 0;
      const retry = setInterval(() => {
        tries++;
        if (window.AS_LENDERS && Array.isArray(window.AS_LENDERS.list) && window.AS_LENDERS.list.length) {
          renderItems(buildItems(normalizeLenders(window.AS_LENDERS), window.AS_LENDERS.products));
          clearInterval(retry);
        } else if (tries >= 20) {
          clearInterval(retry);
        }
      }, 300);
      window.addEventListener('load', () => { loadAndRender().catch(() => {}); }, { once: true });
    } catch (e) { /* no-op */ }
  })();

  /* ---------- mobile nav ---------- */
  let lastMenuTrigger = null;
  function closeMobileNav(restoreFocus) {
    const nav = document.querySelector('.mobile-nav');
    if (!nav || !nav.classList.contains('open')) return;
    nav.classList.remove('open');
    document.body.style.overflow = '';
    if (restoreFocus && lastMenuTrigger) lastMenuTrigger.focus();
  }
  document.querySelectorAll('[data-menu-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = document.querySelector('.mobile-nav');
      if (!nav) return;
      lastMenuTrigger = btn;
      nav.classList.add('open');
      document.body.style.overflow = 'hidden';
      const closeBtn = nav.querySelector('[data-menu-close]');
      if (closeBtn) closeBtn.focus();
    });
  });
  document.querySelectorAll('[data-menu-close]').forEach(btn => {
    btn.addEventListener('click', () => closeMobileNav(true));
  });
  document.querySelectorAll('.mobile-nav a').forEach(link => {
    link.addEventListener('click', () => closeMobileNav(false));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileNav(true);
  });

  /* ---------- reveal on scroll ---------- */
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.querySelector('.reveal')) {
    if (!reduceMotion && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.08, rootMargin: '120px 0px -20px 0px' });
      const watch = (root) => {
        if (!root || root.nodeType !== 1) return;
        if (root.classList && root.classList.contains('reveal') && !root.classList.contains('in')) io.observe(root);
        if (root.querySelectorAll) root.querySelectorAll('.reveal:not(.in)').forEach(el => io.observe(el));
      };
      watch(document.body);
      // Content rendered later (gallery, reviews, offering images) must reveal too.
      if ('MutationObserver' in window) {
        new MutationObserver((muts) => {
          muts.forEach(m => Array.prototype.forEach.call(m.addedNodes, watch));
        }).observe(document.body, { childList: true, subtree: true });
      }
      // Safety net: never leave content hidden if the observer misses an element.
      setTimeout(() => document.querySelectorAll('.reveal:not(.in)').forEach(el => el.classList.add('in')), 2400);
    } else {
      document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
    }
  }

  /* ---------- FAQ ---------- */
  function asSetFaqState(item, open) {
    const btn = item.querySelector('.faq-q');
    const panel = item.querySelector('.faq-a');
    if (!btn || !panel) return;
    item.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    panel.style.maxHeight = open ? panel.scrollHeight + 'px' : '';
  }
  document.querySelectorAll('.faq-item').forEach(item => {
    const btn = item.querySelector('.faq-q');
    const panel = item.querySelector('.faq-a');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      const parent = item.parentElement;
      if (parent) {
        parent.querySelectorAll('.faq-item.open').forEach(other => {
          if (other !== item) asSetFaqState(other, false);
        });
      }
      asSetFaqState(item, !isOpen);
    });
    item.addEventListener('mouseenter', () => {
      if (item.classList.contains('open')) return;
      const parent = item.parentElement;
      if (parent) {
        parent.querySelectorAll('.faq-item.open').forEach(other => {
          if (other !== item) asSetFaqState(other, false);
        });
      }
      asSetFaqState(item, true);
    });
  });

  /* ---------- partner tabs ---------- */
  document.querySelectorAll('[data-partner-tabs]').forEach(wrap => {
    const tabs = wrap.querySelectorAll('.partner-tab');
    const tiles = document.querySelectorAll('[data-partner-grid] .logo-tile');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const f = tab.dataset.filter;
        tiles.forEach(tile => {
          const show = f === 'all' || tile.dataset.category === f;
          tile.classList.toggle('hide', !show);
        });
      });
    });
  });



  /* ---------- counters ---------- */
  const counters = document.querySelectorAll('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseFloat(el.dataset.count);
        const decimals = (el.dataset.decimals | 0);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const dur = 1300;
        const start = performance.now();
        function tick(now) {
          const p = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          const val = target * eased;
          el.textContent = prefix + val.toLocaleString('en-IN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        co.unobserve(el);
      });
    }, { threshold: 0.5 });
    counters.forEach(el => co.observe(el));
  }

  /* ---------- currency helpers ---------- */
  function inr(n) {
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
  function compact(n) {
    if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.00$/, '') + ' Cr';
    if (n >= 100000) return '₹' + (n / 100000).toFixed(2).replace(/\.00$/, '') + ' L';
    return inr(n);
  }
  window.asInr = inr;
  window.asCompact = compact;

  function emiOf(P, annualRate, months) {
    const r = annualRate / 12 / 100;
    if (r === 0) return P / months;
    return P * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  }

  /* ---------- calculators ---------- */
  document.querySelectorAll('[data-calculator]').forEach(root => {
    const amount = root.querySelector('[data-calc="amount"]');
    const rate = root.querySelector('[data-calc="rate"]');
    const tenure = root.querySelector('[data-calc="tenure"]');
    if (!amount || !rate || !tenure) return;
    const isFull = root.dataset.calculator === 'full';
    const out = {
      emi: root.querySelector('[data-out="emi"]'),
      interest: root.querySelector('[data-out="interest"]'),
      total: root.querySelector('[data-out="total"]'),
      principal: root.querySelector('[data-out="principal"]'),
      interestPct: root.querySelector('[data-out="interestPct"]'),
      principalPct: root.querySelector('[data-out="principalPct"]'),
      principalPct2: root.querySelector('[data-out="principalPct2"]'),
      barPrincipal: root.querySelector('[data-out="barPrincipal"]'),
      barInterest: root.querySelector('[data-out="barInterest"]'),
      amountLabel: root.querySelector('[data-label="amount"]'),
      rateLabel: root.querySelector('[data-label="rate"]'),
      tenureLabel: root.querySelector('[data-label="tenure"]'),
      donutPrincipal: root.querySelector('[data-donut="principal"]'),
      donutInterest: root.querySelector('[data-donut="interest"]'),
      schedule: root.querySelector('[data-schedule]') || (isFull ? document.querySelector('[data-schedule]') : null)
    };

    let unit = 'years';

    function paintRange(el) {
      const min = parseFloat(el.min), max = parseFloat(el.max), val = parseFloat(el.value);
      const pct = ((val - min) / (max - min)) * 100;
      el.style.setProperty('--fill', pct + '%');
    }

    function calc() {
      const P = parseFloat(amount.value);
      const annualRate = parseFloat(rate.value);
      const rawTenure = parseFloat(tenure.value);
      const months = unit === 'months' ? Math.max(1, Math.round(rawTenure)) : Math.max(1, Math.round(rawTenure * 12));
      const emi = emiOf(P, annualRate, months);
      const total = emi * months;
      const interest = total - P;
      const interestPct = (interest / total) * 100;

      if (out.emi) out.emi.textContent = inr(emi).replace('₹', '₹ ');
      if (out.interest) out.interest.textContent = inr(interest);
      if (out.total) out.total.textContent = inr(total);
      if (out.principal) out.principal.textContent = inr(P);
      if (out.interestPct) out.interestPct.textContent = interestPct.toFixed(1) + '%';
      if (out.principalPct) out.principalPct.textContent = (100 - interestPct).toFixed(1) + '%';
      if (out.principalPct2) out.principalPct2.textContent = (100 - interestPct).toFixed(0) + '%';
      if (out.barPrincipal) out.barPrincipal.style.width = (100 - interestPct) + '%';
      if (out.barInterest) out.barInterest.style.width = interestPct + '%';
      if (out.amountLabel) out.amountLabel.textContent = inr(P);
      if (out.rateLabel) out.rateLabel.textContent = annualRate.toFixed(2) + '% p.a.';
      if (out.tenureLabel) out.tenureLabel.textContent = unit === 'months'
        ? rawTenure + (rawTenure === 1 ? ' month' : ' months')
        : rawTenure + (rawTenure === 1 ? ' year' : ' years');

      // donut (r=52, circumference 326.7)
      const C = 326.73;
      if (out.donutPrincipal) out.donutPrincipal.style.strokeDasharray = ((100 - interestPct) / 100 * C) + ' ' + C;
      if (out.donutInterest) {
        out.donutInterest.style.strokeDasharray = (interestPct / 100 * C) + ' ' + C;
        out.donutInterest.style.strokeDashoffset = (-(100 - interestPct) / 100 * C) + '';
      }

      if (out.schedule) {
        let balance = P;
        let rows = '';
        const r = annualRate / 12 / 100;
        for (let y = 1; y <= Math.ceil(months / 12); y++) {
          let interestY = 0, principalY = 0;
          for (let m = 0; m < 12 && (y - 1) * 12 + m < months; m++) {
            const iPart = balance * r;
            const pPart = emi - iPart;
            interestY += iPart;
            principalY += pPart;
            balance -= pPart;
          }
          rows += `<tr><td>Year ${y}</td><td>${inr(principalY)}</td><td>${inr(interestY)}</td><td>${inr(Math.max(0, balance))}</td></tr>`;
        }
        out.schedule.innerHTML = rows;
      }

      root.querySelectorAll('input[type="range"]').forEach(paintRange);
    }

    amount.addEventListener('input', calc);
    rate.addEventListener('input', calc);
    tenure.addEventListener('input', calc);

    root.querySelectorAll('[data-tenure-unit]').forEach(btn => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('[data-tenure-unit]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        unit = btn.dataset.tenureUnit;
        const current = parseFloat(tenure.value) || 0;
        if (unit === 'months') {
          tenure.min = 12; tenure.max = 360; tenure.step = 6;
          tenure.value = Math.min(360, Math.round(current * 12));
        } else {
          tenure.min = 1; tenure.max = 30; tenure.step = 1;
          tenure.value = Math.max(1, Math.round(current / 12));
        }
        calc();
      });
    });

    calc();
  });

  /* ---------- lead persistence ---------- */
  const statusDefault = 'New';
  function saveLead(payload) {
    const leads = read('as_leads', []);
    const lead = Object.assign({
      id: 'ASL-' + String(Date.now()).slice(-6),
      status: statusDefault,
      priority: 'Medium',
      source: 'Website',
      owner: 'Unassigned',
      createdAt: new Date().toISOString(),
      notes: []
    }, payload);
    leads.unshift(lead);
    try { localStorage.setItem('as_leads', JSON.stringify(leads)); } catch (e) {}
    return lead;
  }
  window.asSaveLead = saveLead;

  /* Inline validation helpers */
  function fieldErrorEl(control) {
    const field = control.closest('.field');
    const host = field || (control.closest('.full') || control.parentElement);
    if (!host) return null;
    let el = host.querySelector('.field-error');
    if (!el) {
      el = document.createElement('span');
      el.className = 'field-error';
      el.setAttribute('role', 'alert');
      el.id = 'err-' + (control.id || control.name || Math.random().toString(36).slice(2));
      host.appendChild(el);
    }
    return el;
  }
  function clearFieldError(control) {
    const el = fieldErrorEl(control);
    if (el) { el.textContent = ''; el.classList.remove('show'); }
    control.removeAttribute('aria-invalid');
    const field = control.closest('.field');
    if (field) field.classList.remove('has-error');
    const consent = control.closest('.consent');
    if (consent) consent.classList.remove('has-error');
  }
  function showFieldError(control, message) {
    const el = fieldErrorEl(control);
    if (el) {
      el.textContent = message;
      el.classList.add('show');
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', el.id);
    }
    const field = control.closest('.field');
    if (field) field.classList.add('has-error');
    const consent = control.closest('.consent');
    if (consent) consent.classList.add('has-error');
  }
  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }
  function phoneDigits(value) {
    return (value || '').replace(/[^\d]/g, '').replace(/^91(?=\d{10}$)/, '');
  }

  const TURNSTILE_SITE_KEY = (window.AS_TURNSTILE_SITE_KEY || (document.querySelector('meta[name="turnstile-site-key"]') || {}).content || '').trim();
  let turnstileScriptPromise = null;
  function ensureTurnstileScript() {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve(false);
    if (window.turnstile) return Promise.resolve(true);
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return turnstileScriptPromise;
  }
  function mountTurnstile(form) {
    if (!TURNSTILE_SITE_KEY) return;
    let wrap = form.querySelector('.turnstile-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'turnstile-wrap';
      wrap.style.margin = '10px 0 4px';
      const submit = form.querySelector('button[type="submit"], .btn[type="submit"]');
      (submit ? submit.parentElement : form).insertBefore(wrap, submit);
    }
    if (wrap.dataset.widgetId) return;
    ensureTurnstileScript().then((ok) => {
      if (!ok || !window.turnstile || wrap.dataset.widgetId) return;
      try {
        const id = window.turnstile.render(wrap, { sitekey: TURNSTILE_SITE_KEY, theme: 'light' });
        wrap.dataset.widgetId = String(id);
      } catch (e) { /* no-op */ }
    });
  }
  function turnstileToken(form) {
    if (!TURNSTILE_SITE_KEY || !window.turnstile) return '';
    const wrap = form.querySelector('.turnstile-wrap');
    const id = wrap && wrap.dataset.widgetId;
    if (!id) return '';
    try { return window.turnstile.getResponse(id) || ''; } catch (e) { return ''; }
  }
  function resetTurnstile(form) {
    if (!window.turnstile) return;
    const wrap = form.querySelector('.turnstile-wrap');
    const id = wrap && wrap.dataset.widgetId;
    if (!id) return;
    try { window.turnstile.reset(id); } catch (e) { /* no-op */ }
  }

  document.querySelectorAll('[data-lead-form]').forEach(form => {
    form.noValidate = true;
    mountTurnstile(form);
    const submitBtn = form.querySelector('button[type="submit"], .btn[type="submit"]');
    const success = form.querySelector('.form-success');
    if (success) success.setAttribute('aria-live', 'polite');

    let formStarted = false;
    let formSubmitted = false;
    let startedAt = 0;
    let abandonSent = false;
    const touchedFields = new Set();
    const formName = form.id || form.getAttribute('name') || 'lead-form';
    const formSource = form.dataset.source || 'Website form';
    const sendAbandon = (reason) => {
      if (!formStarted || formSubmitted || abandonSent) return;
      abandonSent = true;
      trackEvent('form_abandon', {
        form: formName,
        source: formSource,
        field: Array.from(touchedFields).slice(-1)[0] || '',
        fieldsTouched: String(touchedFields.size),
        seconds: startedAt ? String(Math.max(0, Math.round((Date.now() - startedAt) / 1000))) : '0',
        reason: reason || 'leave'
      });
    };
    form._asTrackAbandon = sendAbandon;
    form.querySelectorAll('input, select, textarea').forEach(control => {
      const evt = (control.type === 'checkbox' || control.tagName === 'SELECT') ? 'change' : 'input';
      const fieldName = control.name || control.id || control.type || 'field';
      if (fieldName === 'website') return;
      control.addEventListener('focus', () => {
        if (!formStarted) {
          formStarted = true;
          startedAt = Date.now();
          trackEvent('form_start', { form: formName, source: formSource });
        }
        if (!touchedFields.has(fieldName)) {
          touchedFields.add(fieldName);
          trackEvent('form_step', { form: formName, source: formSource, field: fieldName, step: String(touchedFields.size) });
        }
      }, { passive: true });
      control.addEventListener(evt, () => {
        clearFieldError(control);
        if (!formStarted) {
          formStarted = true;
          startedAt = Date.now();
          trackEvent('form_start', { form: formName, source: formSource });
        }
        if (!touchedFields.has(fieldName)) {
          touchedFields.add(fieldName);
          trackEvent('form_step', { form: formName, source: formSource, field: fieldName, step: String(touchedFields.size) });
        }
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submitBtn && submitBtn.disabled) return;

      const data = new FormData(form);
      const name = (data.get('name') || '').toString().trim();
      const phone = (data.get('phone') || '').toString().trim();
      const email = (data.get('email') || '').toString().trim();
      const consent = form.querySelector('input[type="checkbox"][name="consent"], .consent input[type="checkbox"]');
      let firstInvalid = null;

      form.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; el.classList.remove('show'); });
      form.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute('aria-invalid'));

      const nameField = form.querySelector('[name="name"]');
      const phoneField = form.querySelector('[name="phone"]');
      const emailField = form.querySelector('[name="email"]');

      if (nameField && name.length < 2) {
        showFieldError(nameField, 'Please enter your full name.');
        firstInvalid = firstInvalid || nameField;
      }
      if (phoneField) {
        const digits = phoneDigits(phone);
        if (!digits) {
          showFieldError(phoneField, 'Please enter your mobile number.');
          firstInvalid = firstInvalid || phoneField;
        } else if (!/^\d{10,13}$/.test(digits)) {
          showFieldError(phoneField, 'Enter a valid 10-digit mobile number (with or without +91).');
          firstInvalid = firstInvalid || phoneField;
        }
      }
      if (emailField && email && !isEmail(email)) {
        showFieldError(emailField, 'Enter a valid email address, e.g. name@example.com.');
        firstInvalid = firstInvalid || emailField;
      }
      if (consent && !consent.checked) {
        showFieldError(consent, 'Please accept the consent note so we can contact you.');
        firstInvalid = firstInvalid || consent;
      }
      if (TURNSTILE_SITE_KEY && !turnstileToken(form)) {
        asToast('Please complete the verification check and try again.', 'error');
        if (!firstInvalid) {
          const tw = form.querySelector('.turnstile-wrap');
          if (tw) tw.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      if (firstInvalid) {
        asToast('Please check the highlighted fields and try again.', 'error');
        firstInvalid.focus({ preventScroll: false });
        return;
      }

      formSubmitted = true;
      trackEvent('form_submit', { form: formName, source: formSource, fieldsTouched: String(touchedFields.size), seconds: startedAt ? String(Math.max(0, Math.round((Date.now() - startedAt) / 1000))) : '0' });
      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
        submitBtn.setAttribute('aria-busy', 'true');
        submitBtn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span>Saving…';
      }

      const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
      const submissionId = 'SUB-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
      const payload = {
        name,
        phone,
        email,
        product: data.get('product') || 'General enquiry',
        amount: data.get('amount') || '',
        income: data.get('income') || '',
        employment: data.get('employment') || '',
        city: data.get('city') || 'Hyderabad',
        message: data.get('message') || '',
        source: form.dataset.source || 'Website form',
        consent: true,
        website: (data.get('website') || '').toString(),
        turnstileToken: turnstileToken(form),
        submissionId
      };

      // Send to the backend when one is running; otherwise keep the local copy.
      const api = window.ASBackend;
      const delivery = api
        ? api.enquire(payload).then((result) => !!(result && result.ok)).catch(() => false)
        : Promise.resolve(false);

      delivery.then((delivered) => {
        trackEvent(delivered ? 'form_submit_success' : 'form_submit_failed', { form: form.id || form.getAttribute('name') || 'lead-form', source: form.dataset.source || 'Website form' });
        if (!delivered) saveLead(payload);

        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove('is-loading');
          submitBtn.removeAttribute('aria-busy');
          submitBtn.innerHTML = originalBtnHtml;
        }

        if (success) {
          const first = escape(name.split(' ')[0] || 'there');
          const msg = settings.whatsapp || '919182703079';
          const waText = encodeURIComponent(
            'Hi AS Financial, my name is ' + name + '. I would like help with a ' +
            (data.get('product') || 'loan') + '. My mobile is ' + phone + '.'
          );
          success.innerHTML =
            '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-check-circle"></use></svg>' +
            '<span><strong>Thanks, ' + first + '. ' +
            (delivered ? 'Your enquiry has reached our team.' : 'Your enquiry has been saved.') + '</strong>' +
            ' For an immediate response, call or message us on ' +
            '<a href="tel:+' + (settings.phoneRaw || '919182703079') + '">' + settings.phone + '</a>.' +
            '<a class="success-wa" href="https://wa.me/' + msg + '?text=' + waText + '" target="_blank" rel="noopener">' +
            '<svg class="icon icon-sm" aria-hidden="true"><use href="#i-whatsapp"></use></svg> Send details on WhatsApp</a>' +
            (delivered
              ? '<small class="demo-note">Received ' + new Date().toLocaleString('en-IN') + '. An advisor will call you back on the number you shared.</small>'
              : '<small class="demo-note">Saved on this device only. If this message repeats, please call or WhatsApp us so nothing is missed.</small>') +
            '</span>';
          success.classList.add('show');
          success.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        form.reset();
        resetTurnstile(form);
        form.querySelectorAll('.field-error.show').forEach(el => el.classList.remove('show'));
        asToast(delivered
          ? 'Enquiry received. We will call you back shortly.'
          : 'Enquiry saved locally. For immediate help, call or WhatsApp ' + settings.phone + '.');
      });
    });
  });

  /* ---------- popup ---------- */
  function openPopup(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    document.body.style.overflow = 'hidden';
    const first = el.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 120);
  }
  function closePopup(el) {
    if (!el) return;
    el.querySelectorAll('[data-lead-form]').forEach(f => { if (typeof f._asTrackAbandon === 'function') f._asTrackAbandon('popup_close'); });
    el.classList.remove('open');
    document.body.style.overflow = '';
  }
  document.querySelectorAll('[data-popup-open]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); openPopup(btn.dataset.popupOpen); });
  });
  document.querySelectorAll('[data-popup-close]').forEach(btn => {
    btn.addEventListener('click', () => closePopup(btn.closest('.popup-overlay')));
  });
  document.querySelectorAll('.popup-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePopup(overlay); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.popup-overlay.open').forEach(closePopup);
  });

  /* ---------- year ---------- */
  document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });

  /* ---------- 3D tilt (hero/cards) ---------- */
  (function(){
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scene = document.getElementById('hero3d-scene');
    if (scene) {
      const items = scene.querySelectorAll('.tilt-live');
      scene.addEventListener('mousemove', (e) => {
        const r = scene.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        items.forEach((el, idx) => {
          const depth = 1 + idx * 0.15;
          const rx = (-py * 6 * depth).toFixed(2);
          const ry = (px * 8 * depth).toFixed(2);
          el.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) translateZ(${10 + idx*6}px)`;
        });
      });
      scene.addEventListener('mouseleave', () => {
        items.forEach((el) => { el.style.transform = ''; });
      });
    }
  })();

  /* ---------- calculator reset controls ---------- */
  (function () {
    const hosts = document.querySelectorAll('.calc-form, .calc-box, .calc-layout[data-calculator="full"] .calc-panel:first-child');
    hosts.forEach(host => {
      if (host.querySelector('[data-calc-reset]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-block';
      btn.setAttribute('data-calc-reset', '');
      btn.textContent = 'Reset to defaults';
      const anchor = host.querySelector('[data-calc-run]');
      const note = host.querySelector('.calc-note-box');
      if (anchor) anchor.insertAdjacentElement('afterend', btn);
      else if (note) note.insertAdjacentElement('afterend', btn);
      else host.appendChild(btn);
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-calc-reset]');
      if (!btn) return;
      const host = btn.closest('.calc-form, .calc-box, .calc-panel');
      if (!host) return;
      host.querySelectorAll('input, select').forEach(control => {
        if (control.type === 'checkbox' || control.type === 'radio') {
          control.checked = control.defaultChecked;
        } else if (control.tagName === 'SELECT') {
          let idx = 0;
          Array.prototype.forEach.call(control.options, (opt, i) => { if (opt.defaultSelected) idx = i; });
          control.selectedIndex = idx;
        } else {
          control.value = control.defaultValue;
        }
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const run = host.querySelector('[data-calc-run]');
      if (run) run.click();
      asToast('Calculator inputs restored to their default values.');
    });
  })();

  /* ---------- active nav ---------- */
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link[href], .m-link[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path) a.setAttribute('aria-current', 'page');
  });
})();

/* ---------- homepage gallery: admin content ---------- */
(function () {
  const grid = document.querySelector('.gal-grid[data-gallery]');
  if (!grid) return;

  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const safeSrc = (value) => {
    if (typeof value !== 'string') return false;
    if (/^assets\/img\/[a-z0-9\/._-]+$/i.test(value) && value.indexOf('..') === -1) return true;
    return /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
  };

  function render(list) {
    const items = list.filter((item) => item && safeSrc(item.src));
    if (!items.length) return;
    grid.innerHTML = items.map((item) => {
      const caption = esc(item.caption || item.alt || 'Poster');
      const alt = esc(item.alt || item.caption || 'Poster');
      const src = item.src;
      return '<button class="gal-item reveal" type="button" data-full="' + esc(src) + '" aria-label="View larger: ' + caption + '">' +
        '<img src="' + esc(src) + '" alt="' + alt + '" loading="lazy">' +
        '<span>' + caption + '</span>' +
        '</button>';
    }).join('');
  }

  function local() {
    try { return JSON.parse(localStorage.getItem('as_gallery') || 'null'); } catch (error) { return null; }
  }

  const api = window.ASBackend;
  const remote = api ? api.content().catch(() => null) : Promise.resolve(null);
  remote.then((content) => {
    const server = content && Array.isArray(content.gallery) ? content.gallery : null;
    const source = server && server.length ? server : local();
    if (Array.isArray(source) && source.length) render(source);
  });
})();

/* ---------- gallery lightbox ---------- */
(function () {
  const dialog = document.getElementById('gallery-lightbox');
  const grid = document.querySelector('.gal-grid');
  if (!dialog || !grid) return;
  const preview = dialog.querySelector('img');
  const closeBtn = dialog.querySelector('.gallery-close');
  let opener = null;

  function close() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    document.body.classList.remove('lb-open');
    if (opener) { opener.focus(); opener = null; }
  }

  grid.addEventListener('click', (event) => {
    const item = event.target.closest('.gal-item');
    if (!item) return;
    const thumb = item.querySelector('img');
    const full = item.getAttribute('data-full') || (thumb && thumb.currentSrc);
    if (!full) return;
    opener = item;
    preview.src = full;
    preview.alt = thumb ? thumb.alt : '';
    document.body.classList.add('lb-open');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    closeBtn.focus();
  });

  closeBtn.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
})();

/* ---------- homepage testimonials: admin selection ---------- */
(function () {
  const grid = document.querySelector('.testi-grid[data-testimonials]');
  if (!grid) return;

  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('').toUpperCase();
  const section = grid.closest('section');

  function local() {
    try { return JSON.parse(localStorage.getItem('as_testimonials') || 'null'); } catch (error) { return null; }
  }

  function render(saved) {
    const published = saved.filter((item) => item && item.published && item.name && item.quote);

    if (!published.length) {
      if (section) section.hidden = true;
      return;
    }

    grid.innerHTML = published.map((item) => {
      const meta = [item.product, item.location].filter(Boolean).map(esc).join(' · ');
      return '<article class="testi-card">' +
        '<svg class="icon testi-mark" aria-hidden="true"><use href="#i-quote"></use></svg>' +
        '<p class="testi-quote">“' + esc(item.quote) + '”</p>' +
        '<div class="testi-person"><span class="testi-avatar">' + esc(initials(item.name)) + '</span>' +
        '<span><strong>' + esc(item.name) + '</strong><span>' + meta + '</span></span></div>' +
        '</article>';
    }).join('');
  }

  const api = window.ASBackend;
  const remote = api ? api.content().catch(() => null) : Promise.resolve(null);
  remote.then((content) => {
    const server = content && Array.isArray(content.testimonials) ? content.testimonials : null;
    const source = server && server.length ? server : local();
    if (Array.isArray(source) && source.length) render(source);
  });
})();

/* ---------- homepage testimonials: one-at-a-time carousel on mobile ---------- */
(function () {
  const grid = document.querySelector('.testi-grid[data-testimonials]');
  const prev = document.querySelector('.testi-nav-prev');
  const next = document.querySelector('.testi-nav-next');
  if (!grid || !prev || !next || grid.dataset.carouselReady === '1') return;

  const step = () => Math.max(1, Math.round(grid.clientWidth));
  const scroll = (dir) => grid.scrollBy({ left: dir * step(), behavior: 'smooth' });
  prev.addEventListener('click', () => scroll(-1));
  next.addEventListener('click', () => scroll(1));

  const update = () => {
    const max = grid.scrollWidth - grid.clientWidth;
    const canScroll = max > 4;
    prev.disabled = !canScroll || grid.scrollLeft <= 2;
    next.disabled = !canScroll || grid.scrollLeft >= max - 2;
    document.getElementById('testi-carousel')?.classList.toggle('can-scroll', canScroll);
  };
  grid.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window) { try { new ResizeObserver(update).observe(grid); } catch (e) {} }
  setTimeout(update, 0);
  setTimeout(update, 300);
  window.addEventListener('load', update, { once: true });
  grid.dataset.carouselReady = '1';
})();

/* ---------- calculator amount chips ---------- */
(function () {
  document.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-amount-chip]');
    if (!chip) return;
    const root = chip.closest('[data-calculator]');
    if (!root) return;
    const amount = root.querySelector('[data-calc="amount"]');
    if (!amount) return;
    const val = chip.getAttribute('data-amount-chip');
    amount.value = val;
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelectorAll('[data-amount-chip]').forEach(c => c.classList.toggle('active', c === chip));
  });

  document.querySelectorAll('[data-calculator]').forEach(root => {
    const amount = root.querySelector('[data-calc="amount"]');
    const chips = root.querySelectorAll('[data-amount-chip]');
    if (!amount || !chips.length) return;
    const sync = () => {
      const v = parseFloat(amount.value);
      let best = null, bestDiff = Infinity;
      chips.forEach(c => {
        const d = Math.abs(parseFloat(c.getAttribute('data-amount-chip')) - v);
        if (d < bestDiff) { bestDiff = d; best = c; }
      });
      chips.forEach(c => c.classList.toggle('active', c === best && bestDiff < 1));
    };
    amount.addEventListener('input', sync);
    sync();
  });
})();

/* ---------- homepage product images: admin selection ---------- */
(function () {
  const ALT = {
    'assets/img/poster/home-loan.jpg': 'Modern family home',
    'assets/img/poster/mortgage.jpg': 'House model with keys',
    'assets/img/poster/personal-loan.jpg': 'Smiling couple',
    'assets/img/poster/business-loan.jpg': 'Business professional',
    'assets/img/poster/education-loan.jpg': 'Graduate in gown',
    'assets/img/poster/services-strip.jpg': 'Loan services poster',
    'assets/img/poster/bank-partners.jpg': 'Bank partners poster',
    'assets/img/poster/nbfc-partners.jpg': 'NBFC partners poster',
    'assets/img/home-loan.jpg': 'Family home',
    'assets/img/family.jpg': 'Family outside their home',
    'assets/img/plot.jpg': 'Open land at sunrise',
    'assets/img/car-loan.jpg': 'Car on the road',
    'assets/img/keys.jpg': 'House keys',
    'assets/img/office.jpg': 'AS Financial office in Medipalli',
    'assets/img/advisor.jpg': 'Financial advisor at work',
    'assets/img/hero-house.jpg': 'House exterior',
    'assets/img/gallery/storefront.jpg': 'Our office in Medipalli',
    'assets/img/gallery/banner.jpg': 'AS Financial signboard banner',
    'assets/img/gallery/partner.jpg': 'Loan types poster',
    'assets/img/gallery/services.jpg': 'Services poster',
    'assets/img/gallery/banks.jpg': 'Partner banks poster',
    'assets/img/gallery/dreams.jpg': 'Dreams poster',
    'assets/img/gallery/instant.jpg': 'Instant loan poster'
  };

  const safeSrc = (value) => {
    if (typeof value !== 'string') return false;
    if (/^assets\/img\/[a-z0-9\/._-]+$/i.test(value) && value.indexOf('..') === -1) return true;
    return /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
  };

  function iconHref(card) {
    const use = card.querySelector('.pcard-head use');
    const href = use ? (use.getAttribute('href') || use.getAttribute('xlink:href')) : '';
    return /^#i-[a-z0-9-]+$/.test(href || '') ? href : '';
  }

  function apply(images) {
    if (!images || typeof images !== 'object' || Array.isArray(images)) return;

    document.querySelectorAll('.pcard[data-content-img]').forEach((card) => {
      const key = card.getAttribute('data-content-img');
      if (!Object.prototype.hasOwnProperty.call(images, key)) return;
      const value = images[key];
      const media = card.querySelector('.pcard-media');
      if (!media) return;
      const heading = (card.querySelector('h3') || {}).textContent || 'Loan';

      if (!value || value === 'icon') {
        const href = iconHref(card);
        if (!href) return;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', href);
        svg.appendChild(use);
        media.classList.add('icon-only');
        media.textContent = '';
        media.appendChild(svg);
        return;
      }

      if (!safeSrc(value)) return;
      let img = media.querySelector('img');
      if (!img) {
        media.textContent = '';
        img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        media.appendChild(img);
      }
      media.classList.remove('icon-only');
      img.src = value;
      img.alt = ALT[value] || (heading + ' illustration');
    });
  }

  function local() {
    try { return JSON.parse(localStorage.getItem('as_content_images') || 'null'); } catch (error) { return null; }
  }

  const api = window.ASBackend;
  const remote = api ? api.content().catch(() => null) : Promise.resolve(null);
  remote.then((content) => {
    const server = content && content.images && typeof content.images === 'object' ? content.images : null;
    const images = server && Object.keys(server).length ? server : local();
    apply(images);
  });
})();

/* ---------- homepage offerings: compact popup cards ---------- */
(function () {
  const grid = document.getElementById('products-grid');
  if (!grid) return;
  // Loans page shows concise, always-visible loan facts instead of hover popups.
  if (document.body.classList.contains('page-loans')) return;
  const cards = Array.prototype.slice.call(grid.querySelectorAll('.pcard'));
  if (!cards.length) return;

  cards.forEach((card) => {
    if (card.dataset.enhanced === 'popup') return;
    const body = card.querySelector('.pcard-body');
    if (!body) return;
    const head = body.querySelector('.pcard-head');
    const tag = body.querySelector('.tag');
    const ul = body.querySelector('ul');
    const foot = body.querySelector('.pcard-foot');
    if (!head) return;

    const popup = document.createElement('div');
    popup.className = 'pcard-popup';
    const headClone = head.cloneNode(true);
    headClone.classList.add('pcard-head-popup');
    popup.appendChild(headClone);
    if (tag) popup.appendChild(tag);
    if (ul) popup.appendChild(ul);
    if (foot) popup.appendChild(foot);

    body.innerHTML = '';
    body.appendChild(head);
    card.appendChild(popup);

    function setRevealed(c, on) {
      const pop = c.querySelector('.pcard-popup');
      c.classList.toggle('is-revealed', !!on);
      if (pop) {
        if (on) { pop.style.setProperty('opacity', '1', 'important'); pop.style.setProperty('visibility', 'visible', 'important'); pop.style.setProperty('transform', 'translateY(0)', 'important'); }
        else { pop.style.removeProperty('opacity'); pop.style.removeProperty('visibility'); pop.style.removeProperty('transform'); }
      }
    }

    // Tap/click to reveal popup (desktop + touch)
    card.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input, select, textarea, label')) return;
      const open = card.classList.contains('is-revealed');
      if (!open) {
        e.preventDefault();
        grid.querySelectorAll('.pcard.is-revealed').forEach((c) => { if (c !== card) setRevealed(c, false); });
        setRevealed(card, true);
      } else {
        setRevealed(card, false);
      }
    });

    card._setRevealed = setRevealed;
    card.dataset.enhanced = 'popup';
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#products-grid .pcard')) {
      grid.querySelectorAll('.pcard.is-revealed').forEach((c) => (c._setRevealed ? c._setRevealed(c, false) : c.classList.remove('is-revealed')));
    }
  });
})();

/* ---------- homepage offerings: horizontal scroll arrows ---------- */
(function () {
  const grid = document.getElementById('products-grid');
  if (!grid || grid.dataset.navReady === '1') return;
  const parent = grid.parentNode;
  if (!parent) return;

  const wrap = document.createElement('div');
  wrap.className = 'pgrid-wrap';
  parent.insertBefore(wrap, grid);
  wrap.appendChild(grid);

  const makeBtn = (dir) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pgrid-nav pgrid-nav-' + dir;
    btn.setAttribute('aria-label', dir === 'prev' ? 'Scroll offerings left' : 'Scroll offerings right');
    const path = dir === 'prev' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6';
    btn.innerHTML = '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + path + '"></path></svg>';
    return btn;
  };
  const prev = makeBtn('prev');
  const next = makeBtn('next');
  wrap.appendChild(prev);
  wrap.appendChild(next);

  const cards = Array.from(grid.querySelectorAll('.pcard'));
  const dots = document.createElement('div');
  dots.className = 'pgrid-dots';
  dots.setAttribute('role', 'group');
  dots.setAttribute('aria-label', 'Choose an offering');
  cards.forEach((card, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'pgrid-dot' + (i === 0 ? ' is-active' : '');
    dot.setAttribute('aria-label', 'Go to offering ' + (i + 1));
    if (i === 0) dot.setAttribute('aria-current', 'true');
    dot.addEventListener('click', () => {
      grid.scrollTo({ left: card.offsetLeft - grid.offsetLeft, behavior: 'smooth' });
    });
    dots.appendChild(dot);
  });
  wrap.appendChild(dots);

  const scrollByAmount = (dir) => {
    const firstCard = grid.querySelector('.pcard');
    const gap = parseFloat(getComputedStyle(grid).gap || '0') || 0;
    const isCarouselPage = document.body.classList.contains('page-loans') || document.body.classList.contains('page-home');
    const amount = isCarouselPage && firstCard && window.innerWidth <= 700
      ? Math.round(firstCard.getBoundingClientRect().width + gap)
      : Math.max(240, Math.round(grid.clientWidth * 0.8));
    grid.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };
  prev.addEventListener('click', () => scrollByAmount(-1));
  next.addEventListener('click', () => scrollByAmount(1));

  const update = () => {
    const max = grid.scrollWidth - grid.clientWidth;
    const left = grid.scrollLeft;
    const canScroll = max > 4;
    prev.disabled = !canScroll || left <= 2;
    next.disabled = !canScroll || left >= max - 2;
    wrap.classList.toggle('can-scroll', canScroll);
    const visible = cards.map(card => getComputedStyle(card).display !== 'none');
    let active = -1, best = Infinity;
    cards.forEach((card, i) => {
      if (!visible[i]) return;
      const d = Math.abs(card.offsetLeft - grid.offsetLeft - left);
      if (d < best) { best = d; active = i; }
    });
    if (active < 0) active = visible.indexOf(true);
    Array.from(dots.children).forEach((dot, i) => {
      dot.style.display = visible[i] ? '' : 'none';
      dot.classList.toggle('is-active', i === active);
      if (i === active && visible[i]) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');
    });
  };

  grid.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window) {
    try { new ResizeObserver(update).observe(grid); } catch (e) {}
  }
  setTimeout(update, 0);
  setTimeout(update, 300);
  window.addEventListener('load', update, { once: true });
  grid.dataset.navReady = '1';
})();

/* ---------- homepage offerings: show more ---------- */
(function () {
  const grid = document.getElementById('products-grid');
  const btn = document.querySelector('[data-products-more]');
  if (!grid || !btn) return;

  const LIMIT = 8;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function sync() {
    const total = grid.querySelectorAll('.pcard').length;
    if (total <= LIMIT) {
      grid.classList.remove('is-collapsed');
      btn.hidden = true;
      btn.setAttribute('aria-expanded', 'true');
      return;
    }
    btn.hidden = false;
    const expanded = !grid.classList.contains('is-collapsed');
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.textContent = expanded ? 'Show fewer offerings' : 'Show more offerings (' + (total - LIMIT) + ' more)';
  }

  // Show eight offerings by default; the button reveals the remaining ones.
  if (grid.querySelectorAll('.pcard').length > LIMIT) grid.classList.add('is-collapsed');
  sync();

  btn.addEventListener('click', () => {
    const collapsing = !grid.classList.contains('is-collapsed');
    grid.classList.toggle('is-collapsed', collapsing);
    if (!collapsing) {
      // Cards revealed by the toggle never met the reveal observer.
      grid.querySelectorAll('.pcard:not(.in)').forEach((el) => el.classList.add('in'));
    }
    sync();
    grid.dispatchEvent(new Event('scroll'));
    if (collapsing) {
      const offset = grid.getBoundingClientRect().top + window.scrollY - 130;
      window.scrollTo({ top: Math.max(0, offset), behavior: reduce ? 'auto' : 'smooth' });
    }
  });
})();

/* ---------- process steps: scroll progress + active number ---------- */
(function () {
  const wraps = document.querySelectorAll('.steps');
  if (!wraps.length) return;

  wraps.forEach((wrap) => {
    const steps = Array.prototype.slice.call(wrap.querySelectorAll('.step'));
    if (!steps.length) return;
    wrap.classList.add('is-watching');
    let frame = 0;

    const update = () => {
      frame = 0;
      const vh = window.innerHeight || 800;
      const anchor = vh * 0.62;
      const centers = steps.map((s) => {
        const r = s.getBoundingClientRect();
        return r.top + r.height / 2;
      });
      const start = centers[0];
      const end = centers[centers.length - 1];
      const span = end - start;
      const fill = span > 0
        ? Math.min(1, Math.max(0, (anchor - start) / span))
        : (anchor >= start ? 1 : 0);
      wrap.style.setProperty('--progress', fill.toFixed(4));

      let active = -1;
      centers.forEach((c, i) => { if (c <= anchor) active = i; });

      steps.forEach((step, i) => {
        step.classList.toggle('is-seen', centers[i] < vh * 0.95);
        step.classList.toggle('is-active', i === active);
        step.classList.toggle('is-done', i < active);
      });
    };

    const request = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    window.addEventListener('load', request);
  });
})();
/* ---------- floating quick contact: reveal after scroll ---------- */
(function () {
  const wrap = document.querySelector('.float-actions');
  if (!wrap) return;
  wrap.classList.add('is-deferred');
  const toggle = () => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    const limit = Math.min(260, Math.max(0, room - 40));
    wrap.classList.toggle('is-visible', window.scrollY > limit);
  };
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
})();
/* ---------- back to top ---------- */
(function () {
  if (document.querySelector('.back-to-top')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'back-to-top';
  btn.setAttribute('aria-label', 'Back to top');
  btn.innerHTML = '<svg class="icon" aria-hidden="true" style="transform:rotate(180deg)"><use href="#i-chevron"></use></svg>';
  document.body.appendChild(btn);
  const toggle = () => {
    if (window.scrollY > 420) btn.classList.add('is-visible');
    else btn.classList.remove('is-visible');
  };
  window.addEventListener('scroll', toggle, { passive: true });
  toggle();
  btn.addEventListener('click', () => {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
})();
