/* ==========================================================================
   AS Financial — admin dashboard logic
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const compact = (n) => {
    n = Math.round(Number(n) || 0);
    if (n >= 10000000) return '₹' + (n / 10000000).toFixed(2).replace(/\.00$/, '') + ' Cr';
    if (n >= 100000) return '₹' + (n / 100000).toFixed(2).replace(/\.00$/, '') + ' L';
    return inr(n);
  };
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(10 + (n % 8), 15, 0, 0); return d.toISOString(); };
  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtShort = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  };
  const timeAgo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return Math.max(1, mins) + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return fmtShort(iso);
  };
  const uid = (prefix, digits) => prefix + String(Math.floor(Math.random() * Math.pow(10, digits || 4))).padStart(digits || 4, '0');
  const debounce = (fn, ms) => { let t; return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); }; };
  const amountToNumber = (val) => {
    if (typeof val === 'number') return val;
    if (!val) return 0;
    const s = String(val);
    const map = {
      'Below ₹5 Lakh': 300000, '₹5 – 10 Lakh': 750000, '₹10 – 25 Lakh': 1750000,
      '₹25 – 50 Lakh': 3750000, '₹50 Lakh – 1 Crore': 7500000, 'Above ₹1 Crore': 12500000,
      'Not sure yet': 0
    };
    if (map[s] != null) return map[s];
    const n = Number(s.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  };

  /* ---------------------------------------------------------------- config */
  const DEFAULT_SETTINGS = {
    businessName: 'AS Financial Services and Solutions',
    tagline: 'Your Goals, Our Solutions',
    phone: '+91 91827 03079',
    phoneRaw: '919182703079',
    email: 'asfinancialservicesandsolution@gmail.com',
    address: 'Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098',
    hours: 'Mon – Sat · 9:30 AM – 7:00 PM',
    whatsapp: '919182703079',
    notifications: { leads: true, apps: true, weekly: false, whatsapp: true }
  };

  const STAGES = ['Logged', 'Documents', 'Underwriting', 'Sanctioned', 'Disbursed', 'Rejected'];
  const STAGE_PROGRESS = { Logged: 15, Documents: 35, Underwriting: 60, Sanctioned: 85, Disbursed: 100, Rejected: 0 };
  const STATUSES = ['New', 'Contacted', 'Qualified', 'Documents', 'Sanctioned', 'Disbursed', 'Lost'];

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
      document.dispatchEvent(new CustomEvent('as:store', { detail: { key: key, value: value } }));
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) {} }
  };

  /* ---------------------------------------------------------------- data init (no sample data) */
  const CONTENT_IMAGE_SLOTS = [
    { key: 'home-loan', label: 'Home Loans', fallback: 'assets/img/poster/home-loan.jpg' },
    { key: 'mortgage', label: 'Mortgage Loans', fallback: 'assets/img/poster/mortgage.jpg' },
    { key: 'personal-loan', label: 'Personal Loans', fallback: 'assets/img/poster/personal-loan.jpg' },
    { key: 'business-loan', label: 'Business Loans', fallback: 'assets/img/poster/business-loan.jpg' },
    { key: 'education-loan', label: 'Education Loans', fallback: 'assets/img/poster/education-loan.jpg' },
    { key: 'plot-loan', label: 'Plot Loans', fallback: 'assets/img/plot.jpg' },
    { key: 'car-loan', label: 'Car & Two-Wheeler Loans', fallback: 'icon' },
    { key: 'doctor-loan', label: 'Doctors Loans', fallback: 'icon' },
    { key: 'insurance', label: 'Insurance', fallback: 'icon' }
  ];

  const CONTENT_IMAGE_GROUPS = [
    { label: 'Loan posters', items: [
      { src: 'assets/img/poster/home-loan.jpg', label: 'Home loan — family home' },
      { src: 'assets/img/poster/mortgage.jpg', label: 'Mortgage — house and keys' },
      { src: 'assets/img/poster/personal-loan.jpg', label: 'Personal loan — couple' },
      { src: 'assets/img/poster/business-loan.jpg', label: 'Business loan — professional' },
      { src: 'assets/img/poster/education-loan.jpg', label: 'Education loan — graduate' },
      { src: 'assets/img/poster/services-strip.jpg', label: 'Services strip' },
      { src: 'assets/img/poster/bank-partners.jpg', label: 'Bank partners poster' },
      { src: 'assets/img/poster/nbfc-partners.jpg', label: 'NBFC partners poster' }
    ] },
    { label: 'Photos', items: [
      { src: 'assets/img/home-loan.jpg', label: 'Family home' },
      { src: 'assets/img/family.jpg', label: 'Family' },
      { src: 'assets/img/plot.jpg', label: 'Open land' },
      { src: 'assets/img/car-loan.jpg', label: 'Car' },
      { src: 'assets/img/keys.jpg', label: 'House keys' },
      { src: 'assets/img/office.jpg', label: 'Office' },
      { src: 'assets/img/advisor.jpg', label: 'Advisor' },
      { src: 'assets/img/hero-house.jpg', label: 'House exterior' }
    ] },
    { label: 'Office & gallery', items: [
      { src: 'assets/img/gallery/storefront.jpg', label: 'Our office in Medipalli' },
      { src: 'assets/img/gallery/banner.jpg', label: 'Signboard banner' },
      { src: 'assets/img/gallery/partner.jpg', label: 'Loan types poster' },
      { src: 'assets/img/gallery/services.jpg', label: 'Services poster' },
      { src: 'assets/img/gallery/banks.jpg', label: 'Partner banks' },
      { src: 'assets/img/gallery/dreams.jpg', label: 'Dreams poster' },
      { src: 'assets/img/gallery/instant.jpg', label: 'Instant loan poster' }
    ] }
  ];

  function clearSampleDataOnce() {
    const flag = 'as_admin_samples_cleared_v2';
    try {
      if (localStorage.getItem(flag) !== '1') {
        ['as_leads', 'as_applications', 'as_products', 'as_partners', 'as_testimonials', 'as_posts', 'as_tasks', 'as_gallery', 'as_content_images', 'as_customers', 'as_documents', 'as_notifications'].forEach((key) => {
          store.remove(key);
        });
        localStorage.setItem(flag, '1');
      }
      // one-time: remove all leads (requested)
      const leadsClearedFlag = 'as_admin_leads_cleared_v1';
      if (localStorage.getItem(leadsClearedFlag) !== '1') {
        store.set('as_leads', []);
        localStorage.setItem(leadsClearedFlag, '1');
      }
    } catch (e) {}
  }

  /* ---------------------------------------------------------------- state */
  let leads = [], apps = [], products = [], partners = [], testimonials = [], posts = [], contentImages = {}, gallery = [], tasks = [], customers = [], documents = [], notifications = [], settings = {};
  let leadPage = 1, appPage = 1;
  const PAGE_SIZE = 8;
  const filters = { leadSearch: '', leadProduct: '', leadStatus: '', leadSource: '', appSearch: '', appLender: '', appStage: 'all', partnerType: '' };
  let currentView = 'overview';
  let activeLeadId = null;
  let charts = {};
  let currentUser = null;
  let pendingResetToken = '';

  function loadData() {
    leads = store.get('as_leads', []);
    apps = store.get('as_applications', []);
    products = store.get('as_products', []);
    partners = store.get('as_partners', []);
    testimonials = store.get('as_testimonials', []);
    posts = store.get('as_posts', []);
    contentImages = store.get('as_content_images', {}) || {};
    gallery = store.get('as_gallery', []);
    if (!Array.isArray(gallery)) gallery = [];
    tasks = store.get('as_tasks', []);
    customers = store.get('as_customers', []);
    documents = store.get('as_documents', []);
    notifications = store.get('as_notifications', []);
    settings = Object.assign({}, DEFAULT_SETTINGS, store.get('as_settings', {}));
    settings.notifications = Object.assign({}, DEFAULT_SETTINGS.notifications, settings.notifications || {});
    if (!Array.isArray(leads)) leads = [];
    if (!Array.isArray(customers)) customers = [];
    if (!Array.isArray(documents)) documents = [];
    if (!Array.isArray(notifications)) notifications = [];
  }

  const save = {
    leads: () => store.set('as_leads', leads.filter(l => !l._server)),
    apps: () => store.set('as_applications', apps),
    products: () => store.set('as_products', products),
    partners: () => store.set('as_partners', partners),
    testimonials: () => store.set('as_testimonials', testimonials),
    posts: () => store.set('as_posts', posts),
    contentImages: () => store.set('as_content_images', contentImages),
    gallery: () => store.set('as_gallery', gallery),
    tasks: () => store.set('as_tasks', tasks),
    customers: () => store.set('as_customers', customers),
    documents: () => store.set('as_documents', documents),
    notifications: () => store.set('as_notifications', notifications),
    settings: () => store.set('as_settings', settings)
  };

  /* ------------------------------------------------------------ server enquiries */
  function mapServerEnquiry(e) {
    return {
      id: e.id,
      name: e.name || '',
      phone: e.phone || '',
      email: e.email || '',
      city: e.city || 'Hyderabad',
      product: e.product || 'General enquiry',
      amount: amountToNumber(e.amount) || 0,
      source: e.source || 'Website form',
      employment: e.employment || '',
      status: e.handled ? 'Contacted' : 'New',
      priority: 'Medium',
      owner: 'Admin',
      message: e.message || '',
      createdAt: e.receivedAt || new Date().toISOString(),
      notes: e.note ? [{ at: e.receivedAt || new Date().toISOString(), text: e.note, by: 'Server' }] : [],
      _server: true,
      _handled: !!e.handled
    };
  }

  let syncingEnquiries = false;
  function syncServerEnquiries() {
    const api = window.ASBackend;
    if (!api || syncingEnquiries) return;
    syncingEnquiries = true;
    api.request('api/enquiries')
      .then((data) => {
        const list = (data && Array.isArray(data.enquiries)) ? data.enquiries : [];
        const serverLeads = list.map(mapServerEnquiry);
        const local = leads.filter(l => !l._server);
        leads = serverLeads.concat(local);
        renderAll();
      })
      .catch(() => { /* backend unavailable or not signed in */ })
      .then(() => { syncingEnquiries = false; });
  }

  document.addEventListener('as:sync-enquiries', syncServerEnquiries);

  /* ---------------------------------------------------------------- toast */
  function toast(message, type) {
    const host = $('#toast-host');
    if (!host) return;
    const t = document.createElement('div');
    t.className = 'a-toast' + (type === 'error' ? ' error' : '');
    t.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' + (type === 'error' ? 'alert' : 'check-circle') + '"></use></svg><span>' + esc(message) + '</span>';
    host.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = '.25s'; setTimeout(() => t.remove(), 260); }, 3200);
  }

  /* ---------------------------------------------------------------- charts */
  function setupCanvas(canvas) {
    if (!canvas) return null;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (w < 10 || h < 10) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawLineChart(canvas, labels, seriesA, seriesB) {
    const c = setupCanvas(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const pad = { l: 34, r: 12, t: 16, b: 26 };
    const max = Math.max(...seriesA, ...seriesB, 10) * 1.18;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;

    ctx.font = '10px Manrope, sans-serif';
    ctx.fillStyle = '#94a0ad';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ih / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.strokeStyle = '#f0ece2';
      ctx.lineWidth = 1;
      ctx.stroke();
      const val = Math.round(max - (max / 4) * i);
      ctx.fillText(val, pad.l - 8, y);
    }

    const x = (i) => pad.l + (iw / (labels.length - 1 || 1)) * i;
    const y = (v) => pad.t + ih - (v / max) * ih;

    // area under leads
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(201,162,39,.22)');
    grad.addColorStop(1, 'rgba(201,162,39,0)');
    ctx.beginPath();
    ctx.moveTo(x(0), y(seriesA[0]));
    seriesA.forEach((v, i) => {
      if (i === 0) return;
      const px = x(i - 1), cx = (x(i - 1) + x(i)) / 2;
      ctx.bezierCurveTo(cx, y(seriesA[i - 1]), cx, y(v), x(i), y(v));
    });
    ctx.lineTo(x(seriesA.length - 1), pad.t + ih);
    ctx.lineTo(x(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // lines
    const drawSeries = (data, color, withDots) => {
      ctx.beginPath();
      data.forEach((v, i) => {
        if (i === 0) return;
        const px = x(i - 1), cx = (x(i - 1) + x(i)) / 2;
        ctx.bezierCurveTo(cx, y(data[i - 1]), cx, y(v), x(i), y(v));
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      if (withDots) {
        data.forEach((v, i) => {
          ctx.beginPath();
          ctx.arc(x(i), y(v), 3, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.stroke();
        });
      }
    };
    drawSeries(seriesB, '#0d2b4e', false);
    drawSeries(seriesA, '#c9a227', true);

    ctx.fillStyle = '#94a0ad';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labels.forEach((l, i) => ctx.fillText(l, x(i), pad.t + ih + 9));
  }

  function drawBarChart(canvas, labels, values, color) {
    const c = setupCanvas(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const pad = { l: 34, r: 12, t: 16, b: 26 };
    const max = Math.max(...values, 10) * 1.2;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    ctx.font = '10px Manrope, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (ih / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.strokeStyle = '#f0ece2';
      ctx.stroke();
      ctx.fillStyle = '#94a0ad';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(max - (max / 4) * i), pad.l - 8, yy);
    }
    const slot = iw / values.length;
    const bw = Math.min(30, slot * 0.52);
    values.forEach((v, i) => {
      const bh = (v / max) * ih;
      const bx = pad.l + slot * i + (slot - bw) / 2;
      const by = pad.t + ih - bh;
      const g = ctx.createLinearGradient(0, by, 0, by + bh);
      g.addColorStop(0, color || '#c9a227');
      g.addColorStop(1, 'rgba(201,162,39,.55)');
      ctx.fillStyle = g;
      const r = Math.min(5, bw / 2);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(bx, by, bw, bh, [r, r, 0, 0]);
      } else {
        ctx.rect(bx, by, bw, bh);
      }
      ctx.fill();
      ctx.fillStyle = '#69788a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(labels[i], bx + bw / 2, pad.t + ih + 9);
      ctx.fillStyle = '#0d2b4e';
      ctx.font = '700 9px Manrope, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(Math.round(v), bx + bw / 2, by - 3);
      ctx.font = '10px Manrope, sans-serif';
    });
  }

  function drawDonut(canvas, data) {
    const c = setupCanvas(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 14;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let start = -Math.PI / 2;
    ctx.lineWidth = Math.max(14, r * 0.34);
    data.forEach(d => {
      const angle = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + angle - 0.035);
      ctx.strokeStyle = d.color;
      ctx.lineCap = 'round';
      ctx.stroke();
      start += angle;
    });
    ctx.fillStyle = '#0d2b4e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 ' + Math.max(13, r * 0.26) + 'px Manrope, sans-serif';
    ctx.fillText(compact(total), cx, cy - 4);
    ctx.fillStyle = '#94a0ad';
    ctx.font = '600 9px Manrope, sans-serif';
    ctx.fillText('SANCTIONED', cx, cy + 13);
  }

  const MIX_COLORS = ['#0d2b4e', '#c9a227', '#2b6cb0', '#137a5b', '#6b4fa0', '#b2651c'];
  const SOURCE_COLORS = ['#0d2b4e', '#c9a227', '#2b6cb0', '#137a5b', '#6b4fa0', '#b3423a'];

  function redrawCharts() {
    if (currentView === 'overview') {
      const trend = leadTrend(8);
      drawLineChart(charts.leads, trend.labels, trend.leads, trend.sanctions);
      renderMixChart();
    }
    if (currentView === 'reports') {
      drawBarChart(charts.disb, monthLabels(6), monthlyDisbursements(), '#c9a227');
      renderSourceChart();
    }
  }

  function leadTrend(n) {
    const labels = [], leadCounts = [], sanctionCounts = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      labels.push(start.toLocaleDateString('en-IN', { month: 'short' }));
      leadCounts.push(leads.filter(l => { const d = new Date(l.createdAt); return d >= start && d < end; }).length);
      sanctionCounts.push(apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage) && a.sanctionedAt && new Date(a.sanctionedAt) >= start && new Date(a.sanctionedAt) < end).length);
    }
    return { labels, leads: leadCounts, sanctions: sanctionCounts };
  }

  function monthLabels(n) {
    const out = [];
    const d = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
      out.push(m.toLocaleDateString('en-IN', { month: 'short' }));
    }
    return out;
  }

  function monthlyDisbursements() {
    const out = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const total = apps.filter(a => a.stage === 'Disbursed' && a.sanctionedAt && new Date(a.sanctionedAt) >= m && new Date(a.sanctionedAt) < next)
        .reduce((s, a) => s + Number(a.amount || 0), 0);
      out.push(Math.max(4, Math.round(total / 100000)));
    }
    return out;
  }

  function mixData() {
    const map = {};
    apps.filter(a => a.stage === 'Sanctioned' || a.stage === 'Disbursed').forEach(a => {
      map[a.product] = (map[a.product] || 0) + Number(a.amount || 0);
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return sorted.map(([label, value], i) => ({ label, value, color: MIX_COLORS[i % MIX_COLORS.length] }));
  }

  function renderMixChart() {
    const data = mixData();
    drawDonut(charts.mix, data);
    $('#mix-legend').innerHTML = data.map(d => '<div class="donut-legend-item"><i style="background:' + d.color + '"></i><span>' + esc(d.label) + '</span><b>' + compact(d.value) + '</b></div>').join('');
  }

  function sourceData() {
    const map = {};
    leads.forEach(l => { map[l.source || 'Website form'] = (map[l.source || 'Website form'] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value], i) => ({ label, value, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));
  }

  function renderSourceChart() {
    const data = sourceData();
    drawDonut(charts.source, data);
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    $('#source-legend').innerHTML = data.map(d => '<div class="donut-legend-item"><i style="background:' + d.color + '"></i><span>' + esc(d.label) + '</span><b>' + Math.round(d.value / total * 100) + '%</b></div>').join('');
  }

  /* ---------------------------------------------------------------- auth */
  function showLoginPanel(which) {
    const loginForm = $('#login-form');
    const forgot = $('#forgot-panel');
    const reset = $('#reset-panel');
    if (loginForm) loginForm.classList.toggle('hidden', which !== 'login');
    if (forgot) forgot.classList.toggle('hidden', which !== 'forgot');
    if (reset) reset.classList.toggle('hidden', which !== 'reset');
  }

  function showLogin(message) {
    $('#login-screen').classList.remove('hidden');
    $('#admin-app').classList.add('hidden');
    document.body.style.overflow = '';
    showLoginPanel(pendingResetToken ? 'reset' : 'login');
    const err = $('#login-error');
    if (err) {
      if (message) { err.textContent = message; err.classList.add('show'); }
      else err.classList.remove('show');
    }
    try { sessionStorage.removeItem('as_admin_ui'); localStorage.removeItem('as_admin_ui'); } catch (e) {}
  }

  function roleLabel(role) {
    const map = { super_admin: 'Super admin', admin: 'Admin', staff: 'Staff', advisor: 'Advisor' };
    return map[role] || role || 'User';
  }

  function renderAccount() {
    const user = currentUser || {};
    const email = user.email || '';
    const displayName = user.name || (email.indexOf('@') > 0 ? email.split('@')[0] : 'Admin');
    const niceName = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : 'Admin';
    const av = $('#account-avatar'); if (av) av.textContent = initials(niceName || email || 'A');
    const nm = $('#account-name'); if (nm) nm.textContent = niceName || email || 'Administrator';
    const em = $('#account-email'); if (em) em.textContent = email || 'Signed in';
    const rl = $('#account-role'); if (rl) rl.textContent = roleLabel(user.role);
    const isAdmin = user.role === 'super_admin' || user.role === 'admin';
    const um = $('#user-management-card'); if (um) um.style.display = isAdmin ? '' : 'none';
    const ac = $('#audit-log-card'); if (ac) ac.style.display = isAdmin ? '' : 'none';
  }

  function isAllowedAdminRole(user) {
    return !!(user && (user.role === 'admin' || user.role === 'super_admin'));
  }

  function denyAccess(message) {
    const api = window.ASBackend;
    if (api && api.logout) { api.logout().catch(() => {}); }
    currentUser = null;
    try { sessionStorage.removeItem('as_admin_ui'); localStorage.removeItem('as_admin_ui'); } catch (e) {}
    showLogin(message || 'Administrator access only.');
  }

  function enterApp(user, remember) {
    if (!isAllowedAdminRole(user)) {
      denyAccess('Administrator access only.');
      return;
    }
    currentUser = user || null;
    const email = (user && user.email) || 'admin';
    const rawName = (user && user.name) || (email.indexOf('@') > 0 ? email.split('@')[0] : 'Admin');
    const display = rawName ? rawName.charAt(0).toUpperCase() + rawName.slice(1) : 'Admin';
    $('#login-screen').classList.add('hidden');
    $('#admin-app').classList.remove('hidden');
    $('#login-error').classList.remove('show');
    $('#sidebar-user-name').textContent = display;
    $('#topbar-user').textContent = display;
    $('#sidebar-avatar').textContent = initials(display);
    $('#topbar-avatar').textContent = initials(display);
    $('#greeting-name').textContent = display;
    const d = new Date();
    const hour = d.getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const greetingEl = $('#greeting-text');
    if (greetingEl) greetingEl.textContent = greeting;
    $('#topbar-date').textContent = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('#last-signin').textContent = 'Today, ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    renderAccount();
    try {
      if (remember) localStorage.setItem('as_admin_ui', email);
      else localStorage.removeItem('as_admin_ui');
      sessionStorage.setItem('as_admin_ui', email);
    } catch (e) {}
    loadData();
    renderAll();
    syncServerEnquiries();
    setView('overview', true);
    loadSessions();
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) { loadUsers(); loadAudit(); }
    document.dispatchEvent(new Event('as:auth-ready'));
  }

  function logout() {
    const finish = () => {
      currentUser = null;
      try { sessionStorage.removeItem('as_admin_ui'); localStorage.removeItem('as_admin_ui'); } catch (e) {}
      showLogin();
      toast('You have been signed out.');
    };
    if (window.ASBackend && window.ASBackend.logout) {
      window.ASBackend.logout().then(finish).catch(finish);
    } else {
      finish();
    }
  }

  function showMsg(el, text, tone) {
    if (!el) return;
    el.textContent = text || '';
    el.style.display = text ? '' : 'none';
    el.dataset.tone = tone || 'info';
  }

  async function loadUsers() {
    const api = window.ASBackend;
    if (!api || !currentUser || (currentUser.role !== 'super_admin' && currentUser.role !== 'admin')) return;
    try {
      const data = await api.request('api/users');
      renderUsers((data && data.users) || []);
    } catch (e) {
      renderUsers([], e && e.message ? e.message : 'Could not load users.');
    }
  }

  function renderUsers(users, error) {
    const tbody = $('#users-table-body');
    if (!tbody) return;
    if (error) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">' + esc(error) + '</td></tr>'; return; }
    if (!users || !users.length) { tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No users found.</td></tr>'; return; }
    const canManage = currentUser && currentUser.role === 'super_admin';
    tbody.innerHTML = users.map(u => {
      const status = u.active === false ? '<span class="badge">Inactive</span>' : '<span class="badge badge-active">Active</span>';
      const actions = canManage
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="a-btn a-btn-light a-btn-sm" data-user-action="toggle" data-id="' + esc(u.id) + '" data-active="' + (u.active === false ? '0' : '1') + '">' + (u.active === false ? 'Activate' : 'Deactivate') + '</button>' +
            '<button class="a-btn a-btn-light a-btn-sm" data-user-action="reset-token" data-id="' + esc(u.id) + '">Reset link</button>' +
          '</div>'
        : '<span style="color:var(--muted);font-size:.75rem">View only</span>';
      return '<tr><td>' + esc(u.name || '—') + '</td><td>' + esc(u.email || '') + '</td><td>' + esc(roleLabel(u.role)) + '</td><td>' + status + '</td><td>' + actions + '</td></tr>';
    }).join('');
  }

  async function loadAudit() {
    const api = window.ASBackend;
    if (!api || !currentUser || (currentUser.role !== 'super_admin' && currentUser.role !== 'admin')) return;
    try {
      const data = await api.request('api/audit?limit=50');
      renderAudit((data && data.entries) || []);
    } catch (e) {
      renderAudit([], e && e.message ? e.message : 'Could not load audit log.');
    }
  }

  function renderAudit(entries, error) {
    const tbody = $('#audit-table-body');
    if (!tbody) return;
    if (error) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">' + esc(error) + '</td></tr>'; return; }
    if (!entries || !entries.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No audit entries yet.</td></tr>'; return; }
    tbody.innerHTML = entries.map(e => {
      const when = e.at ? new Date(e.at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      const actor = (e.actorEmail || '—') + (e.actorRole ? ' (' + esc(roleLabel(e.actorRole)) + ')' : '');
      const details = (e.summary || '') + (e.targetId ? ' [' + esc(e.targetId) + ']' : '');
      return '<tr><td>' + esc(when) + '</td><td>' + esc(e.type || 'event') + '</td><td>' + actor + '</td><td>' + esc(details || '—') + '</td></tr>';
    }).join('');
  }

  async function loadSessions() {
    const api = window.ASBackend;
    if (!api || !currentUser) return;
    try {
      const data = await api.request('api/sessions');
      renderSessions((data && data.sessions) || []);
    } catch (e) {
      renderSessions([], e && e.message ? e.message : 'Could not load sessions.');
    }
  }

  function renderSessions(list, error) {
    const tbody = $('#sessions-table-body');
    if (!tbody) return;
    if (error) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">' + esc(error) + '</td></tr>'; return; }
    if (!list || !list.length) { tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No active sessions.</td></tr>'; return; }
    tbody.innerHTML = list.map(s => {
      const when = s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
      const ua = String(s.userAgent || '').replace(/\s+/g, ' ').trim();
      const device = (ua ? ua.slice(0, 60) + (ua.length > 60 ? '…' : '') : 'Unknown device') + (s.ip ? ' · ' + esc(s.ip) : '');
      const status = s.current ? '<span class="badge badge-active">Current</span>' : '<span class="badge">Active</span>';
      const action = s.current ? '<span style="color:var(--muted);font-size:.75rem">This session</span>' : '<button class="a-btn a-btn-light a-btn-sm" data-session-revoke="' + esc(s.id || '') + '">Sign out</button>';
      return '<tr><td>' + esc(when) + '</td><td title="' + esc(s.userAgent || '') + '">' + device + '</td><td>' + status + '</td><td>' + action + '</td></tr>';
    }).join('');
  }

  /* ---------------------------------------------------------------- navigation */
  const VIEW_TITLES = {
    overview: 'Overview', leads: 'Leads', applications: 'Applications', customers: 'Customers', documents: 'Documents', notifications: 'Notifications', reports: 'Reports',
    products: 'Loan products', partners: 'Bank partners', content: 'Website content', settings: 'Settings'
  };

  function setView(view, skipHash) {
    if (!VIEW_TITLES[view]) view = 'overview';
    currentView = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.sidebar-link[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('#topbar-title').textContent = VIEW_TITLES[view];
    if (!skipHash) history.replaceState(null, '', '#' + view);
    closeSidebar();
    renderView(view);
  }

  function syncChartRefs() {
    charts.leads = document.getElementById('chart-leads');
    charts.mix = document.getElementById('chart-mix');
    charts.disb = document.getElementById('chart-disbursement');
    charts.source = document.getElementById('chart-source');
  }

  function renderView(view) {
    if (view === 'overview') renderOverview();
    else if (view === 'leads') renderLeads();
    else if (view === 'applications') renderApplications();
    else if (view === 'customers') renderCustomers();
    else if (view === 'documents') renderDocuments();
    else if (view === 'notifications') renderNotifications();
    else if (view === 'reports') renderReports();
    else if (view === 'products') renderProducts();
    else if (view === 'partners') renderPartners();
    else if (view === 'content') renderContent();
    else if (view === 'settings') renderSettings();
    syncChartRefs();
    requestAnimationFrame(() => requestAnimationFrame(redrawCharts));
  }

  function renderAll() {
    updateCounts();
    renderView(currentView);
    populateFilters();
  }

  function updateCounts() {
    const open = leads.filter(l => !['Sanctioned', 'Disbursed', 'Lost'].includes(l.status)).length;
    const el = $('#nav-lead-count');
    if (el) el.textContent = open;
    const unread = Array.isArray(notifications) ? notifications.filter(n => n && !n.read).length : 0;
    const nel = $('#nav-notif-count');
    if (nel) { nel.textContent = unread; nel.style.display = unread ? '' : 'none'; }
  }

  function populateFilters() {
    const prodSel = $('#leads-product-filter');
    if (prodSel) {
      const names = products.map(p => p.name);
      const current = prodSel.value;
      prodSel.innerHTML = '<option value="">All products</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('');
      prodSel.value = current;
    }
    const lenderSel = $('#apps-lender-filter');
    if (lenderSel) {
      const current = lenderSel.value;
      const names = [...new Set(partners.map(p => p.name))].sort();
      lenderSel.innerHTML = '<option value="">All lenders</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('');
      lenderSel.value = current;
    }
  }

  /* ---------------------------------------------------------------- overview */
  function renderOverview() {
    const now = new Date();
    const thisMonth = leads.filter(l => { const d = new Date(l.createdAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).length;
    const activeApps = apps.filter(a => ['Logged', 'Documents', 'Underwriting'].includes(a.stage)).length;
    const sanctioned = apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage));
    const sanctionedThisMonth = sanctioned.filter(a => { const d = new Date(a.sanctionedAt || a.appliedAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
    const sanctionedAmt = sanctioned.reduce((s, a) => s + Number(a.amount || 0), 0);
    const disbursedAmt = apps.filter(a => a.stage === 'Disbursed').reduce((s, a) => s + Number(a.amount || 0), 0);

    $('#kpi-new-leads').textContent = thisMonth;
    $('#kpi-total-leads').textContent = leads.length;
    $('#kpi-active-apps').textContent = activeApps;
    $('#kpi-sanctioned-count').textContent = sanctionedThisMonth.length;
    $('#kpi-sanctioned-amt').textContent = compact(sanctionedThisMonth.reduce((s, a) => s + Number(a.amount || 0), 0));
    $('#kpi-disbursed-amt').textContent = compact(disbursedAmt);
    $('#kpi-leads-chip').textContent = thisMonth > 4 ? '↑ 12.5%' : '→ steady';

    // pipeline
    const stageMap = [
      ['New', leads.filter(l => l.status === 'New').length, '#2b6cb0'],
      ['Contacted / Qualified', leads.filter(l => ['Contacted', 'Qualified'].includes(l.status)).length, '#c9a227'],
      ['Documents in progress', leads.filter(l => l.status === 'Documents').length, '#2b6cb0'],
      ['Sanctioned / Disbursed', leads.filter(l => ['Sanctioned', 'Disbursed'].includes(l.status)).length, '#137a5b']
    ];
    const maxStage = Math.max(...stageMap.map(s => s[1]), 1);
    $('#pipeline-list').innerHTML = stageMap.map(([label, count]) =>
      '<div class="pipeline-row"><div class="p-top"><span>' + label + '</span><b>' + count + ' leads</b></div><div class="pipeline-track"><span style="width:' + Math.round(count / maxStage * 100) + '%"></span></div></div>'
    ).join('');

    // recent leads
    $('#recent-leads-body').innerHTML = leads.slice(0, 5).map(l =>
      '<tr>' +
      '<td><div class="cust"><span class="cust-avatar">' + initials(l.name) + '</span><span><b>' + esc(l.name) + '</b><span>' + esc(l.phone) + '</span></span></div></td>' +
      '<td>' + esc(l.product) + '</td>' +
      '<td class="num">' + compact(amountToNumber(l.amount)) + '</td>' +
      '<td><span class="badge badge-inactive">' + esc(l.source || 'Website') + '</span></td>' +
      '<td><span class="badge badge-' + String(l.status).toLowerCase() + '">' + esc(l.status) + '</span></td>' +
      '<td title="' + fmtDate(l.createdAt) + '">' + timeAgo(l.createdAt) + '</td>' +
      '<td><button class="a-btn-icon" data-action="view-lead" data-id="' + esc(l.id) + '" aria-label="View lead"><svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg></button></td>' +
      '</tr>'
    ).join('') || '<tr><td colspan="7" class="table-empty">No enquiries yet.</td></tr>';

    // product performance
    const perProduct = products.filter(p => p.visible).slice(0, 5).map(p => {
      const pl = leads.filter(l => l.product === p.name);
      const pApps = apps.filter(a => a.product === p.name && (a.stage === 'Sanctioned' || a.stage === 'Disbursed'));
      const amt = pApps.reduce((s, a) => s + Number(a.amount || 0), 0);
      const conv = pl.length ? Math.round(pApps.length / pl.length * 100) : 0;
      return { name: p.name, leads: pl.length, amt, conv, avg: pApps.length ? amt / pApps.length : 0 };
    });
    $('#product-perf-body').innerHTML = perProduct.map(p =>
      '<tr><td><div class="product-cell"><span class="p-ic"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-' + (products.find(x => x.name === p.name) || { icon: 'doc' }).icon + '"></use></svg></span><b>' + esc(p.name) + '</b></div></td>' +
      '<td>' + p.leads + '</td><td class="num">' + compact(p.amt) + '</td><td><span class="badge badge-' + (p.conv >= 40 ? 'active' : 'inactive') + '">' + p.conv + '%</span></td><td>' + (p.avg ? compact(p.avg) : '—') + '</td>' +
      '<td><span class="stars">' + (p.conv >= 40 ? '↑ growing' : '→ steady') + '</span></td></tr>'
    ).join('');

    renderTasks();
  }

  function renderTasks() {
    const host = $('#task-list');
    if (!host) return;
    if (!tasks.length) {
      host.innerHTML = '<div class="empty-state" style="padding:26px"><h3>All clear</h3><p>No follow-ups for today.</p></div>';
      return;
    }
    host.innerHTML = tasks.map(t =>
      '<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #f2eee4;cursor:pointer">' +
      '<input type="checkbox" data-task="' + esc(t.id) + '" ' + (t.done ? 'checked' : '') + ' style="margin-top:3px;accent-color:#c9a227;width:15px;height:15px;flex:none">' +
      '<span style="flex:1"><b style="font-size:.78rem;color:' + (t.done ? '#5b6b7e' : '#0d2b4e') + ';text-decoration:' + (t.done ? 'line-through' : 'none') + ';font-weight:600;display:block">' + esc(t.text) + '</b><span style="font-size:.66rem;color:#5b6b7e">' + esc(t.due) + '</span></span>' +
      '</label>'
    ).join('');
  }

  /* ---------------------------------------------------------------- leads */
  function filteredLeads() {
    const q = filters.leadSearch.toLowerCase();
    return leads.filter(l => {
      if (q && !(l.name + ' ' + l.phone + ' ' + l.email + ' ' + l.id).toLowerCase().includes(q)) return false;
      if (filters.leadProduct && l.product !== filters.leadProduct) return false;
      if (filters.leadStatus && l.status !== filters.leadStatus) return false;
      if (filters.leadSource && l.source !== filters.leadSource) return false;
      return true;
    }).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function renderLeads() {
    const list = filteredLeads();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (leadPage > totalPages) leadPage = totalPages;
    const start = (leadPage - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    $('#leads-count-label').textContent = list.length;
    $('#leads-open').textContent = leads.filter(l => !['Sanctioned', 'Disbursed', 'Lost'].includes(l.status)).length;
    $('#leads-converted').textContent = apps.length;
    $('#leads-value').textContent = compact(leads.reduce((s, l) => s + amountToNumber(l.amount), 0));

    $('#leads-body').innerHTML = pageItems.length ? pageItems.map(l =>
      '<tr>' +
      '<td><div class="cust"><span class="cust-avatar">' + initials(l.name) + '</span><span><b>' + esc(l.name) + '</b><span>' + esc(l.phone) + ' · ' + esc(l.id) + '</span></span></div></td>' +
      '<td>' + esc(l.product) + '<div style="font-size:.66rem;color:#5b6b7e">' + esc(l.city || 'Hyderabad') + '</div></td>' +
      '<td class="num">' + compact(amountToNumber(l.amount)) + '</td>' +
      '<td><span class="badge badge-inactive">' + esc(l.source || 'Website') + '</span></td>' +
      '<td><span class="badge badge-' + String(l.status).toLowerCase() + '">' + esc(l.status) + '</span></td>' +
      '<td><span class="badge badge-' + String(l.priority || 'medium').toLowerCase() + '">' + esc(l.priority || 'Medium') + '</span></td>' +
      '<td title="' + fmtDate(l.createdAt) + '">' + fmtShort(l.createdAt) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="a-btn-icon" data-action="view-lead" data-id="' + esc(l.id) + '" title="View"><svg class="icon" aria-hidden="true"><use href="#i-eye"></use></svg></button>' +
        '<button class="a-btn-icon" data-action="edit-lead" data-id="' + esc(l.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
        '<button class="a-btn-icon danger" data-action="delete-lead" data-id="' + esc(l.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>'
    ).join('') : '<tr><td colspan="8" class="table-empty"><svg class="icon" aria-hidden="true"><use href="#i-users"></use></svg><br>No leads match these filters.<br><button class="a-btn a-btn-light a-btn-sm" style="margin-top:10px" data-action="clear-filters">Clear filters</button></td></tr>';

    renderPagination('#leads-pagination', list.length, leadPage, (p) => { leadPage = p; renderLeads(); }, PAGE_SIZE);
    updateCounts();
  }

  function renderPagination(sel, total, page, onChange, pageSize) {
    const host = $(sel);
    if (!host) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (total === 0) { host.innerHTML = '<span>0 results</span>'; return; }
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, total);
    let btns = '';
    const maxBtns = 5;
    let startP = Math.max(1, page - 2);
    let endP = Math.min(pages, startP + maxBtns - 1);
    if (endP - startP < maxBtns - 1) startP = Math.max(1, endP - maxBtns + 1);
    for (let p = startP; p <= endP; p++) btns += '<button class="' + (p === page ? 'active' : '') + '" data-page="' + p + '">' + p + '</button>';
    host.innerHTML = '<span>Showing ' + from + '–' + to + ' of ' + total + '</span><div class="pages">' +
      '<button data-page="' + (page - 1) + '" ' + (page === 1 ? 'disabled' : '') + '>‹</button>' + btns +
      '<button data-page="' + (page + 1) + '" ' + (page === pages ? 'disabled' : '') + '>›</button></div>';
    $$('button[data-page]', host).forEach(b => b.addEventListener('click', () => {
      const p = Number(b.dataset.page);
      if (p >= 1 && p <= pages && p !== page) onChange(p);
    }));
  }

  function leadModal(id) {
    const lead = id ? leads.find(l => l.id === id) : null;
    const productOpts = products.map(p => '<option ' + (lead && lead.product === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const statusOpts = STATUSES.map(s => '<option ' + (lead && lead.status === s ? 'selected' : '') + '>' + s + '</option>').join('');
    const sourceOpts = ['Website form', 'Homepage popup', 'Phone call', 'WhatsApp', 'Walk-in', 'Referral'].map(s => '<option ' + (lead && lead.source === s ? 'selected' : '') + '>' + s + '</option>').join('');
    const priorityOpts = ['High', 'Medium', 'Low'].map(p => '<option ' + (lead && lead.priority === p ? 'selected' : '') + '>' + p + '</option>').join('');
    openModal({
      title: lead ? 'Edit lead' : 'Add a new lead',
      sub: lead ? 'Update the enquiry details for ' + lead.id : 'Log an enquiry taken over the phone, WhatsApp or in person.',
      body:
        '<div class="form-row"><div class="a-field"><label>Full name <span class="req">*</span></label><input name="name" required value="' + esc(lead ? lead.name : '') + '" placeholder="e.g. Ramesh Kumar"></div>' +
        '<div class="a-field"><label>Mobile <span class="req">*</span></label><input name="phone" required value="' + esc(lead ? lead.phone : '') + '" placeholder="10-digit number"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Email</label><input name="email" type="email" value="' + esc(lead ? lead.email : '') + '" placeholder="name@example.com"></div>' +
        '<div class="a-field"><label>City / area</label><input name="city" value="' + esc(lead ? lead.city : 'Hyderabad') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Loan product</label><select name="product">' + productOpts + '</select></div>' +
        '<div class="a-field"><label>Loan amount (₹)</label><input name="amount" type="number" min="0" step="10000" value="' + esc(lead ? lead.amount : '') + '" placeholder="e.g. 2500000"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Source</label><select name="source">' + sourceOpts + '</select></div>' +
        '<div class="a-field"><label>Employment</label><select name="employment"><option ' + (lead && lead.employment === 'Salaried' ? 'selected' : '') + '>Salaried</option><option ' + (lead && lead.employment === 'Self-employed' ? 'selected' : '') + '>Self-employed</option><option ' + (lead && lead.employment === 'Business owner' ? 'selected' : '') + '>Business owner</option><option ' + (lead && lead.employment === 'NRI' ? 'selected' : '') + '>NRI</option></select></div></div>' +
        '<div class="form-row three"><div class="a-field"><label>Status</label><select name="status">' + statusOpts + '</select></div>' +
        '<div class="a-field"><label>Priority</label><select name="priority">' + priorityOpts + '</select></div>' +
        '<div class="a-field"><label>Owner</label><input name="owner" value="' + esc(lead ? lead.owner : 'Admin') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Enquiry notes</label><textarea name="message" placeholder="What is the customer looking for?">' + esc(lead ? lead.message : '') + '</textarea></div></div>',
      submitLabel: lead ? 'Save changes' : 'Add lead',
      onSubmit: (data) => {
        const name = String(data.get('name') || '').trim();
        const phone = String(data.get('phone') || '').trim();
        if (!name || !phone) { toast('Name and mobile number are required.', 'error'); return false; }
        const payload = {
          name, phone,
          email: String(data.get('email') || '').trim(),
          city: String(data.get('city') || '').trim(),
          product: data.get('product'),
          amount: Number(data.get('amount')) || 0,
          source: data.get('source'),
          employment: data.get('employment'),
          status: data.get('status'),
          priority: data.get('priority'),
          owner: String(data.get('owner') || 'Admin'),
          message: String(data.get('message') || '')
        };
        if (lead) {
          Object.assign(lead, payload);
          toast('Lead updated.');
        } else {
          leads.unshift(Object.assign({ id: uid('ASL-'), createdAt: new Date().toISOString(), notes: [] }, payload));
          toast('Lead added to the pipeline.');
        }
        save.leads();
        renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- drawer */
  function openDrawer(id) {
    const lead = leads.find(l => l.id === id);
    if (!lead) return;
    activeLeadId = id;
    renderDrawer();
    $('#drawer-overlay').classList.add('open');
    $('#lead-drawer').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    $('#drawer-overlay').classList.remove('open');
    $('#lead-drawer').classList.remove('open');
    document.body.style.overflow = '';
    activeLeadId = null;
  }

  function renderDrawer() {
    const lead = leads.find(l => l.id === activeLeadId);
    if (!lead) return;
    $('#drawer-title').textContent = lead.name;
    $('#drawer-sub').textContent = lead.id + ' · Added ' + fmtDate(lead.createdAt);
    const statusOptions = STATUSES.map(s => '<option ' + (lead.status === s ? 'selected' : '') + '>' + s + '</option>').join('');
    $('#drawer-body').innerHTML =
      '<div class="detail-grid-2">' +
        '<div class="detail-box"><small>Loan type</small><b>' + esc(lead.product) + '</b></div>' +
        '<div class="detail-box"><small>Amount</small><b>' + compact(amountToNumber(lead.amount)) + '</b></div>' +
        '<div class="detail-box"><small>Phone</small><b>' + esc(lead.phone) + '</b></div>' +
        '<div class="detail-box"><small>Source</small><b>' + esc(lead.source || 'Website') + '</b></div>' +
        '<div class="detail-box"><small>City</small><b>' + esc(lead.city || 'Hyderabad') + '</b></div>' +
        '<div class="detail-box"><small>Employment</small><b>' + esc(lead.employment || '—') + '</b></div>' +
      '</div>' +
      '<div class="drawer-section"><h3>Update status</h3><select id="drawer-status" style="width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;font-size:.8rem">' + statusOptions + '</select></div>' +
      '<div class="drawer-section"><h3>Contact</h3>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<a class="a-btn a-btn-light a-btn-sm" href="tel:' + esc(lead.phone) + '"><svg class="icon" aria-hidden="true"><use href="#i-phone"></use></svg> Call</a>' +
          '<a class="a-btn a-btn-light a-btn-sm" target="_blank" rel="noopener" href="https://wa.me/91' + esc(String(lead.phone).replace(/\D/g, '').slice(-10)) + '"><svg class="icon" aria-hidden="true"><use href="#i-whatsapp"></use></svg> WhatsApp</a>' +
          (lead.email ? '<a class="a-btn a-btn-light a-btn-sm" href="mailto:' + esc(lead.email) + '"><svg class="icon" aria-hidden="true"><use href="#i-mail"></use></svg> Email</a>' : '') +
        '</div>' +
        (lead.email ? '<p style="font-size:.74rem;color:var(--muted);margin:10px 0 0">' + esc(lead.email) + '</p>' : '') +
      '</div>' +
      (lead.message ? '<div class="drawer-section"><h3>Enquiry</h3><div class="note-item" style="background:#fbf8f1">' + esc(lead.message) + '</div></div>' : '') +
      '<div class="drawer-section"><h3>Notes</h3><div class="note-list" id="drawer-notes">' +
        (lead.notes && lead.notes.length ? lead.notes.map(n => '<div class="note-item">' + esc(n.text) + '<time>' + fmtDate(n.at) + '</time></div>').join('') : '<div class="note-item" style="color:#5b6b7e">No notes yet.</div>') +
      '</div>' +
      '<form class="note-add" id="note-form"><input type="text" id="note-input" placeholder="Add a note…" autocomplete="off"><button class="a-btn-icon" type="submit" aria-label="Save note" style="background:var(--navy);color:#fff"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-plus"></use></svg></button></form></div>' +
      '<div class="drawer-section"><h3>Meta</h3><div class="detail-grid-2"><div class="detail-box"><small>Priority</small><b>' + esc(lead.priority || 'Medium') + '</b></div><div class="detail-box"><small>Owner</small><b>' + esc(lead.owner || 'Admin') + '</b></div></div></div>';

    $('#drawer-foot').innerHTML =
      '<button class="a-btn a-btn-light" id="drawer-edit" style="flex:1"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg> Edit lead</button>' +
      '<button class="a-btn a-btn-danger" id="drawer-delete" aria-label="Delete lead"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>';

    $('#drawer-status').addEventListener('change', (e) => {
      lead.status = e.target.value;
      if (lead._server && window.ASBackend && window.ASBackend.request) {
        var handled = ['Contacted', 'Qualified', 'Documents', 'Sanctioned', 'Disbursed', 'Lost'].indexOf(lead.status) !== -1;
        lead._handled = handled;
        window.ASBackend.request('api/enquiries/' + lead.id, { method: 'PATCH', body: { handled: handled } }).catch(function () {});
      }
      save.leads();
      toast('Status updated to ' + lead.status + '.');
      renderAll();
      renderDrawer();
    });
    $('#note-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#note-input');
      const text = input.value.trim();
      if (!text) return;
      lead.notes = lead.notes || [];
      lead.notes.unshift({ text, at: new Date().toISOString() });
      if (lead._server && window.ASBackend && window.ASBackend.request) {
        window.ASBackend.request('api/enquiries/' + lead.id, { method: 'PATCH', body: { note: text } }).catch(function () {});
      }
      save.leads();
      input.value = '';
      toast('Note added.');
      renderAll();
      renderDrawer();
    });
    $('#drawer-edit').addEventListener('click', () => { closeDrawer(); leadModal(lead.id); });
    $('#drawer-delete').addEventListener('click', () => {
      confirmDialog('Delete this lead?', 'This will permanently remove ' + lead.name + ' from the pipeline.', () => {
        leads = leads.filter(l => l.id !== lead.id);
        save.leads();
        closeDrawer();
        renderAll();
        toast('Lead deleted.');
      });
    });
  }

  /* ---------------------------------------------------------------- applications */
  function filteredApps() {
    const q = filters.appSearch.toLowerCase();
    return apps.filter(a => {
      if (filters.appStage !== 'all' && a.stage !== filters.appStage) return false;
      if (filters.appLender && a.lender !== filters.appLender) return false;
      if (q && !(a.customer + ' ' + a.id + ' ' + a.lender + ' ' + a.product).toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => new Date(b.appliedAt) - new Date(a.appliedAt));
  }

  function renderApplications() {
    const list = filteredApps();
    const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (appPage > totalPages) appPage = totalPages;
    const start = (appPage - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);
    const count = (stage) => apps.filter(a => a.stage === stage).length;

    $('#app-total').textContent = apps.length;
    $('#app-processing').textContent = apps.filter(a => ['Logged', 'Documents', 'Underwriting'].includes(a.stage)).length;
    $('#app-sanctioned').textContent = apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage)).length;
    $('#app-value').textContent = compact(apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage)).reduce((s, a) => s + Number(a.amount || 0), 0));

    $('#stage-all-count').textContent = apps.length;
    $('#stage-logged-count').textContent = count('Logged');
    $('#stage-docs-count').textContent = count('Documents');
    $('#stage-uw-count').textContent = count('Underwriting');
    $('#stage-sanctioned-count').textContent = count('Sanctioned');
    $('#stage-disbursed-count').textContent = count('Disbursed');
    $('#stage-rejected-count').textContent = count('Rejected');

    $('#apps-body').innerHTML = pageItems.length ? pageItems.map(a =>
      '<tr>' +
      '<td><b style="color:var(--navy);font-size:.78rem">' + esc(a.id) + '</b><div style="font-size:.65rem;color:var(--muted-2)">' + fmtShort(a.appliedAt) + '</div></td>' +
      '<td><div class="cust"><span class="cust-avatar">' + initials(a.customer) + '</span><span><b>' + esc(a.customer) + '</b><span>' + esc(a.phone) + '</span></span></div></td>' +
      '<td><b style="color:var(--navy);font-size:.78rem">' + esc(a.product) + '</b><div style="font-size:.66rem;color:var(--muted-2)">' + compact(a.amount) + '</div></td>' +
      '<td>' + esc(a.lender) + '</td>' +
      '<td><span class="badge badge-' + String(a.stage).toLowerCase() + '">' + esc(a.stage) + '</span></td>' +
      '<td><div class="progress"><div class="progress-track"><span style="width:' + (STAGE_PROGRESS[a.stage] || 0) + '%;background:' + (a.stage === 'Rejected' ? '#b3423a' : '#137a5b') + '"></span></div><b>' + (STAGE_PROGRESS[a.stage] || 0) + '%</b></div></td>' +
      '<td><div class="row-actions">' +
        (a.stage !== 'Disbursed' && a.stage !== 'Rejected' ? '<button class="a-btn-icon" data-action="advance-app" data-id="' + esc(a.id) + '" title="Advance stage"><svg class="icon" aria-hidden="true"><use href="#i-arrow-right"></use></svg></button>' : '') +
        '<button class="a-btn-icon" data-action="edit-app" data-id="' + esc(a.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
        '<button class="a-btn-icon danger" data-action="delete-app" data-id="' + esc(a.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>'
    ).join('') : '<tr><td colspan="7" class="table-empty"><svg class="icon" aria-hidden="true"><use href="#i-folder"></use></svg><br>No applications match these filters.</td></tr>';

    renderPagination('#apps-pagination', list.length, appPage, (p) => { appPage = p; renderApplications(); }, PAGE_SIZE);
  }

  function appModal(id) {
    const app = id ? apps.find(a => a.id === id) : null;
    const productOpts = products.map(p => '<option ' + (app && app.product === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const lenderOpts = partners.filter(p => p.active).map(p => '<option ' + (app && app.lender === p.name ? 'selected' : '') + '>' + esc(p.name) + '</option>').join('');
    const stageOpts = STAGES.map(s => '<option ' + (app && app.stage === s ? 'selected' : '') + '>' + s + '</option>').join('');
    openModal({
      title: app ? 'Edit application' : 'New application',
      sub: app ? 'Update the file for ' + app.id : 'Log a sanction or move a lead into processing.',
      body:
        '<div class="form-row"><div class="a-field"><label>Customer name <span class="req">*</span></label><input name="customer" required value="' + esc(app ? app.customer : '') + '"></div>' +
        '<div class="a-field"><label>Mobile <span class="req">*</span></label><input name="phone" required value="' + esc(app ? app.phone : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Loan product</label><select name="product">' + productOpts + '</select></div>' +
        '<div class="a-field"><label>Loan amount (₹)</label><input name="amount" type="number" min="0" step="10000" value="' + esc(app ? app.amount : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Lender</label><select name="lender">' + lenderOpts + '</select></div>' +
        '<div class="a-field"><label>Interest rate (%)</label><input name="rate" type="number" step="0.05" min="0" max="30" value="' + esc(app ? app.rate : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Stage</label><select name="stage">' + stageOpts + '</select></div>' +
        '<div class="a-field"><label>Applied on</label><input name="appliedAt" type="date" value="' + (app ? String(app.appliedAt).slice(0, 10) : new Date().toISOString().slice(0, 10)) + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Internal notes</label><textarea name="notes">' + esc(app ? app.notes : '') + '</textarea></div></div>',
      submitLabel: app ? 'Save changes' : 'Create application',
      onSubmit: (data) => {
        const customer = String(data.get('customer') || '').trim();
        const phone = String(data.get('phone') || '').trim();
        if (!customer || !phone) { toast('Customer name and mobile are required.', 'error'); return false; }
        const stage = data.get('stage');
        const payload = {
          customer, phone,
          product: data.get('product'),
          amount: Number(data.get('amount')) || 0,
          lender: data.get('lender'),
          rate: Number(data.get('rate')) || 0,
          stage,
          appliedAt: data.get('appliedAt') ? new Date(data.get('appliedAt')).toISOString() : new Date().toISOString(),
          sanctionedAt: (stage === 'Sanctioned' || stage === 'Disbursed') ? (app && app.sanctionedAt ? app.sanctionedAt : new Date().toISOString()) : '',
          notes: String(data.get('notes') || '')
        };
        if (app) { Object.assign(app, payload); toast('Application updated.'); }
        else { apps.unshift(Object.assign({ id: uid('ASF-'), owner: 'Admin' }, payload)); toast('Application created.'); }
        save.apps();
        renderAll();
      }
    });
  }

  function advanceApp(id) {
    const app = apps.find(a => a.id === id);
    if (!app) return;
    const order = ['Logged', 'Documents', 'Underwriting', 'Sanctioned', 'Disbursed'];
    const idx = order.indexOf(app.stage);
    if (idx === -1 || idx === order.length - 1) { toast('This application is already complete.', 'error'); return; }
    app.stage = order[idx + 1];
    if (app.stage === 'Sanctioned' || app.stage === 'Disbursed') app.sanctionedAt = new Date().toISOString();
    save.apps();
    renderAll();
    toast(app.customer + ' moved to ' + app.stage + '.');
  }

  /* ---------------------------------------------------------------- products */
  function renderProducts() {
    $('#products-body').innerHTML = products.map(p => {
      const leadCount = leads.filter(l => l.product === p.name).length;
      return '<tr>' +
        '<td><div class="product-cell"><span class="p-ic"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-' + esc(p.icon || 'doc') + '"></use></svg></span><span><b>' + esc(p.name) + '</b><span>' + esc(p.category) + '</span></span></div></td>' +
        '<td class="num">' + (p.rate ? p.rate.toFixed(2) + '%' : '—') + '</td>' +
        '<td>' + (p.maxAmount ? compact(p.maxAmount) : '—') + '</td>' +
        '<td>' + esc(p.tenure) + '</td>' +
        '<td>' + leadCount + '</td>' +
        '<td><label class="switch"><input type="checkbox" data-toggle="product" data-id="' + esc(p.id) + '" ' + (p.visible ? 'checked' : '') + '><span></span></label></td>' +
        '<td><div class="row-actions">' +
          '<button class="a-btn-icon" data-action="edit-product" data-id="' + esc(p.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
          '<button class="a-btn-icon danger" data-action="delete-product" data-id="' + esc(p.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
        '</div></td></tr>';
    }).join('');
    renderContentImages();
  }

  function productModal(id) {
    const p = id ? products.find(x => x.id === id) : null;
    const iconOpts = ['home', 'user', 'briefcase', 'key', 'graduation', 'plot', 'car', 'stethoscope', 'transfer', 'shield', 'wallet', 'globe'].map(i => '<option ' + (p && p.icon === i ? 'selected' : '') + '>' + i + '</option>').join('');
    openModal({
      title: p ? 'Edit product' : 'Add loan product',
      sub: 'These details feed the public loan listing and calculator defaults.',
      body:
        '<div class="form-row"><div class="a-field"><label>Product name <span class="req">*</span></label><input name="name" required value="' + esc(p ? p.name : '') + '" placeholder="e.g. Home Loan"></div>' +
        '<div class="a-field"><label>Category</label><select name="category">' + ['Property', 'Retail', 'Business', 'Protection'].map(c => '<option ' + (p && p.category === c ? 'selected' : '') + '>' + c + '</option>').join('') + '</select></div></div>' +
        '<div class="form-row three"><div class="a-field"><label>Interest rate (%)</label><input name="rate" type="number" step="0.05" min="0" value="' + esc(p ? p.rate : '') + '"></div>' +
        '<div class="a-field"><label>Max amount (₹)</label><input name="maxAmount" type="number" min="0" step="100000" value="' + esc(p ? p.maxAmount : '') + '"></div>' +
        '<div class="a-field"><label>Max tenure</label><input name="tenure" value="' + esc(p ? p.tenure : '30 years') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Icon</label><select name="icon">' + iconOpts + '</select></div>' +
        '<div class="a-field"><label>Visibility</label><select name="visible"><option value="true" ' + (!p || p.visible ? 'selected' : '') + '>Visible on website</option><option value="false" ' + (p && !p.visible ? 'selected' : '') + '>Hidden</option></select></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Short description</label><textarea name="description">' + esc(p ? p.description : '') + '</textarea></div></div>',
      submitLabel: p ? 'Save changes' : 'Add product',
      onSubmit: (data) => {
        const name = String(data.get('name') || '').trim();
        if (!name) { toast('Product name is required.', 'error'); return false; }
        const payload = {
          name,
          category: data.get('category'),
          rate: Number(data.get('rate')) || 0,
          maxAmount: Number(data.get('maxAmount')) || 0,
          tenure: String(data.get('tenure') || ''),
          icon: data.get('icon'),
          visible: data.get('visible') === 'true',
          description: String(data.get('description') || '')
        };
        if (p) { Object.assign(p, payload); toast('Product updated.'); }
        else { products.push(Object.assign({ id: uid('PRD-', 2) }, payload)); toast('Product added.'); }
        save.products();
        renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- partners */
  function enrichPartnersFromWebsiteLenders() {
    if (!Array.isArray(contentLendersCache) || !contentLendersCache.length) return false;
    const norm = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&]+/g, ' ').trim().replace(/\s+/g, ' ');
    const byName = {};
    contentLendersCache.forEach(l => {
      const n = norm(l && (l.name || l.n));
      if (n && !byName[n]) byName[n] = l;
    });
    let changed = false;
    partners = (partners || []).map(p => {
      if (!p || typeof p !== 'object') return p;
      const key = norm(p.name);
      const src = byName[key];
      if (!src) return p;
      const next = Object.assign({}, p);
      if (!next.interestRate && (src.rate || src.r)) { next.interestRate = String(src.rate || src.r); changed = true; }
      if (!next.tenure && (src.tenure || src.t)) { next.tenure = String(src.tenure || src.t); changed = true; }
      if (!next.amount && (src.amount || src.amt)) { next.amount = String(src.amount || src.amt); changed = true; }
      if (!next.fee && src.fee) { next.fee = String(src.fee); changed = true; }
      if ((!Array.isArray(next.benefits) || !next.benefits.length) && (Array.isArray(src.benefits) ? src.benefits.length : Array.isArray(src.b) ? src.b.length : 0)) {
        next.benefits = Array.isArray(src.benefits) ? src.benefits.slice() : (Array.isArray(src.b) ? src.b.slice() : []);
        changed = true;
      }
      if ((!Array.isArray(next.products) || !next.products.length) && (Array.isArray(src.products) ? src.products.length : Array.isArray(src.p) ? src.p.length : 0)) {
        next.products = Array.isArray(src.products) ? src.products.slice() : (Array.isArray(src.p) ? src.p.slice() : []);
        changed = true;
      }
      if (!next.logo && (src.logo || src.image)) { next.logo = src.logo || src.image; changed = true; }
      return next;
    });
    if (changed) save.partners();
    return changed;
  }

  function ensurePartnerLogos() {
    let changed = false;
    partners = (partners || []).map(p => {
      if (!p || typeof p !== 'object') return p;
      if (p.logo) return p;
      const logo = autoLogoForLenderName(p.name || '');
      if (logo) { changed = true; return Object.assign({}, p, { logo }); }
      return p;
    });
    if (changed) save.partners();
  }

  function renderPartners() {
    ensurePartnerLogos();
    enrichPartnersFromWebsiteLenders();
    if (!Array.isArray(contentLendersCache) && !contentLendersLoading) {
      // best-effort load to enrich partners with website lender details
      loadContentLenders().then(() => { if (enrichPartnersFromWebsiteLenders()) renderPartners(); }).catch(() => {});
    }
    const list = partners.filter(p => !filters.partnerType || p.type === filters.partnerType);
    const host = $('#partners-grid');
    if (!list.length) {
      host.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>No partners found</h3><p>Add a bank or NBFC to your panel.</p></div>';
      return;
    }
    host.innerHTML = list.map(p => {
      const logo = p.logo || '';
      const logoHtml = logo
        ? '<span class="partner-logo" style="width:46px;height:46px;border-radius:12px;overflow:hidden;border:1px solid #e6edf6;background:#fff;display:grid;place-items:center;flex:none;padding:4px"><img src="' + esc(logo) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain"></span>'
        : '<span class="partner-logo" style="width:46px;height:46px;border-radius:12px;overflow:hidden;border:1px dashed #d7e0ec;background:#f3f6fb;display:grid;place-items:center;flex:none"></span>';
      const rateNum = Number(p.rate);
      const hasRate = Number.isFinite(rateNum) && rateNum > 0;
      const interest = String(p.interestRate || '').trim() || (hasRate ? rateNum.toFixed(2) + '% p.a. onwards' : '—');
      const tenure = p.tenure || '—';
      const amount = p.amount || '—';
      const fee = p.fee || '—';
      const benefits = Array.isArray(p.benefits) ? p.benefits.filter(Boolean) : String(p.benefits || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const products = Array.isArray(p.products) ? p.products.filter(Boolean) : String(p.products || '').split(',').map(s=>s.trim()).filter(Boolean);
      const benHtml = benefits.length ? '<ul style="margin:8px 0 0;padding-left:16px;font-size:.72rem;color:var(--muted);line-height:1.5">' + benefits.slice(0,3).map(b => '<li>' + esc(b) + '</li>').join('') + '</ul>' : '';
      const prodHtml = products.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">' + products.slice(0,6).map(pr => '<span style="font-size:.64rem;padding:3px 8px;border-radius:999px;background:#f3f6fb;border:1px solid #e6edf6;color:var(--navy)">' + esc(pr) + '</span>').join('') + '</div>' : '';
      const detail = p.interestDetails ? '<div style="font-size:.68rem;color:var(--muted);margin-top:6px;line-height:1.45">' + esc(p.interestDetails) + '</div>' : '';
      const crm = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:.66rem;color:var(--muted)">' +
        (p.applications ? '<span>' + esc(p.applications) + ' apps</span>' : '') +
        (p.sanctioned ? '<span>' + esc(p.sanctioned) + ' sanctioned</span>' : '') +
        (p.approval ? '<span>' + esc(p.approval) + '% approval</span>' : '') +
      '</div>';
      return '<div class="partner-tile-admin" style="gap:6px">' +
        '<div class="tile-actions">' +
          '<button class="a-btn-icon" data-action="edit-partner" data-id="' + esc(p.id) + '" title="Edit"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
          '<button class="a-btn-icon danger" data-action="delete-partner" data-id="' + esc(p.id) + '" title="Delete"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
        '</div>' +
        '<div style="display:flex;gap:10px;align-items:center;padding-right:44px">' + logoHtml +
          '<div style="min-width:0"><b style="display:block;font-size:.9rem">' + esc(p.name) + '</b><span>' + esc(p.type || '') + '</span></div>' +
        '</div>' +
        '<div class="partner-facts" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">' +
          '<div><small style="display:block;color:var(--muted);font-size:.62rem">Interest rate</small><b style="font-size:.74rem;color:var(--navy)">' + esc(interest) + '</b></div>' +
          '<div><small style="display:block;color:var(--muted);font-size:.62rem">Tenure</small><b style="font-size:.74rem;color:var(--navy)">' + esc(tenure) + '</b></div>' +
          '<div><small style="display:block;color:var(--muted);font-size:.62rem">Loan amount</small><b style="font-size:.72rem;color:var(--navy)">' + esc(amount) + '</b></div>' +
          '<div><small style="display:block;color:var(--muted);font-size:.62rem">Processing/charges</small><b style="font-size:.72rem;color:var(--navy)">' + esc(fee) + '</b></div>' +
        '</div>' +
        detail + benHtml + prodHtml + crm +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
          '<span class="badge badge-' + (p.active ? 'active' : 'inactive') + '">' + (p.active ? 'Active' : 'Paused') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function partnerModal(id) {
    const p = id ? partners.find(x => x.id === id) : null;
    const logoVal = esc(p && p.logo ? p.logo : '');
    const previewInner = (p && p.logo)
      ? '<img src="' + logoVal + '" alt="" style="width:100%;height:100%;object-fit:contain">'
      : '<span style="display:block;width:100%;height:100%;background:#f3f6fb"></span>';
    const benefitsText = Array.isArray(p && p.benefits) ? p.benefits.join('\n') : String((p && p.benefits) || '');
    const productsText = Array.isArray(p && p.products) ? p.products.join(', ') : String((p && p.products) || '');
    openModal({
      title: p ? 'Edit partner' : 'Add lending partner',
      sub: 'Manage lender details shown in admin (aligned with website lender info). Logo is auto-assigned.',
      body:
        '<div class="form-row"><div class="a-field"><label>Partner name <span class="req">*</span></label><input name="name" required value="' + esc(p ? p.name : '') + '" placeholder="e.g. HDFC Bank"></div>' +
        '<div class="a-field"><label>Type</label><select name="type">' + ['Public sector', 'Private bank', 'NBFC / HFC'].map(t => '<option ' + (p && p.type === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></div></div>' +
        '<div class="a-field"><label>Logo</label>' +
          '<div style="display:flex;gap:12px;align-items:center">' +
            '<div id="partner-logo-preview" style="width:64px;height:64px;border-radius:12px;border:1px solid #e6edf6;background:#fff;display:grid;place-items:center;overflow:hidden;flex:none">' + previewInner + '</div>' +
            '<small style="color:var(--muted);font-size:.72rem;line-height:1.5">Logo is assigned automatically (no manual upload).</small>' +
          '</div>' +
          '<input type="hidden" name="logo" id="partner-logo-value" value="' + logoVal + '">' +
        '</div>' +
        '<div class="form-row"><div class="a-field"><label>Starting rate (%)</label><input name="rate" type="number" step="0.05" min="0" value="' + esc(p && Number(p.rate) > 0 ? p.rate : '') + '" placeholder="e.g. 8.50"></div>' +
        '<div class="a-field"><label>Interest rate / range (display)</label><input name="interestRate" value="' + esc(p ? (p.interestRate || '') : '') + '" placeholder="e.g. 8.50% p.a. onwards"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Tenure</label><input name="tenure" value="' + esc(p ? (p.tenure || '') : '') + '" placeholder="e.g. Up to 30 years"></div>' +
        '<div class="a-field"><label>Loan amount</label><input name="amount" value="' + esc(p ? (p.amount || '') : '') + '" placeholder="e.g. ₹5 L – ₹10 Cr+"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Processing / charges</label><input name="fee" value="' + esc(p ? (p.fee || '') : '') + '" placeholder="e.g. As per lender schedule"></div>' +
        '<div class="a-field"><label>Status</label><select name="active"><option value="true" ' + (!p || p.active ? 'selected' : '') + '>Active</option><option value="false" ' + (p && !p.active ? 'selected' : '') + '>Paused</option></select></div></div>' +
        '<div class="a-field"><label>Interest details / notes</label><textarea name="interestDetails" rows="2" placeholder="e.g. Rate varies by profile, product, tenure, CIBIL, and lender policy.">' + esc(p ? (p.interestDetails || '') : '') + '</textarea></div>' +
        '<div class="a-field"><label>Benefits (one per line)</label><textarea name="benefits" rows="3" placeholder="Key benefit 1&#10;Key benefit 2">' + esc(benefitsText) + '</textarea></div>' +
        '<div class="a-field"><label>Products (comma separated)</label><input name="products" value="' + esc(productsText) + '" placeholder="e.g. home, lap, personal, business"></div>' +
        '<div class="form-row three"><div class="a-field"><label>Applications</label><input name="applications" type="number" min="0" value="' + esc(p ? p.applications : 0) + '"></div>' +
        '<div class="a-field"><label>Sanctioned</label><input name="sanctioned" type="number" min="0" value="' + esc(p ? p.sanctioned : 0) + '"></div>' +
        '<div class="a-field"><label>Approval rate (%)</label><input name="approval" type="number" min="0" max="100" value="' + esc(p ? p.approval : 0) + '"></div></div>',
      submitLabel: p ? 'Save changes' : 'Add partner',
      onSubmit: async (data) => {
        const name = String(data.get('name') || '').trim();
        if (!name) { toast('Partner name is required.', 'error'); return false; }
        const products = String(data.get('products') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12);
        const benefits = String(data.get('benefits') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 8);
        const payload = {
          name,
          type: data.get('type'),
          logo: String(data.get('logo') || ''),
          rate: Number(data.get('rate')) || 0,
          interestRate: String(data.get('interestRate') || '').trim(),
          interestDetails: String(data.get('interestDetails') || '').trim(),
          tenure: String(data.get('tenure') || '').trim(),
          amount: String(data.get('amount') || '').trim(),
          fee: String(data.get('fee') || '').trim(),
          benefits,
          products,
          active: data.get('active') === 'true',
          applications: Number(data.get('applications')) || 0,
          sanctioned: Number(data.get('sanctioned')) || 0,
          approval: Number(data.get('approval')) || 0
        };
        if (!payload.logo) {
          payload.logo = await resolveLogoForBank(name);
        }
        if (p) { Object.assign(p, payload); toast(payload.logo ? 'Partner updated (logo auto-assigned).' : 'Partner updated.'); }
        else { partners.push(Object.assign({ id: uid('BNK-', 2) }, payload)); toast(payload.logo ? 'Partner added (logo auto-assigned).' : 'Partner added.'); }
        save.partners();
        renderAll();
        // Best-effort: keep public website lender directory in sync when a partner logo is set/changed.
        if (payload.logo) {
          try { await syncPartnerLogoToWebsiteLenders(payload.name, payload.logo); } catch (e) {}
        }
      }
    });

    const logoHidden = $('#partner-logo-value');
    const logoPreview = $('#partner-logo-preview');
    if (logoPreview && logoHidden && logoHidden.value) {
      logoPreview.innerHTML = '<img src="' + esc(logoHidden.value) + '" alt="" style="width:100%;height:100%;object-fit:contain">';
    } else if (logoPreview) {
      logoPreview.innerHTML = '<span style="display:block;width:100%;height:100%;background:#f3f6fb"></span>';
    }
  }

  /* ---------------------------------------------------------------- content */
  function readImageFileAsDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//i.test(file.type)) { reject(new Error('not-image')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read-failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('load-failed'));
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width;
            let h = img.naturalHeight || img.height;
            const limit = maxDim || 1200;
            if (w > limit || h > limit) {
              const scale = Math.min(limit / w, limit / h);
              w = Math.max(1, Math.round(w * scale));
              h = Math.max(1, Math.round(h * scale));
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, w, h);
            const type = file.type === 'image/png' ? 'image/png' : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
            const q = type === 'image/png' ? undefined : (quality || 0.82);
            resolve(canvas.toDataURL(type, q));
          } catch (err) { reject(err); }
        };
        img.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  let contentLendersCache = null;
  let contentLendersLoading = false;

  const KNOWN_LENDER_LOGOS = {
    'sbi':'assets/img/lenders/sbi.svg','state bank of india':'assets/img/lenders/sbi.svg','hdfc bank':'assets/img/lenders/hdfc-bank.svg',
    'icici bank':'assets/img/lenders/icici-bank.svg','axis bank':'assets/img/lenders/axis-bank.svg','kotak mahindra bank':'assets/img/lenders/kotak-mahindra-bank.svg',
    'bank of baroda':'assets/img/lenders/bank-of-baroda.svg','canara bank':'assets/img/lenders/canara-bank.svg','union bank of india':'assets/img/lenders/union-bank-of-india.svg',
    'punjab national bank':'assets/img/lenders/punjab-national-bank.svg','indian bank':'assets/img/lenders/indian-bank.svg','idfc first bank':'assets/img/lenders/idfc-first-bank.svg',
    'yes bank':'assets/img/lenders/yes-bank.svg','federal bank':'assets/img/lenders/federal-bank.svg','indusind bank':'assets/img/lenders/indusind-bank.svg',
    'bandhan bank':'assets/img/lenders/bandhan-bank.svg','uco bank':'assets/img/lenders/uco-bank.svg','central bank of india':'assets/img/lenders/central-bank-of-india.svg',
    'indian overseas bank':'assets/img/lenders/indian-overseas-bank.svg','bank of india':'assets/img/lenders/bank-of-india.svg','idbi bank':'assets/img/lenders/idbi-bank.svg',
    'bajaj finserv':'assets/img/lenders/bajaj-finserv.svg','bajaj housing finance':'assets/img/lenders/bajaj-finserv.svg','bajaj finance':'assets/img/lenders/bajaj-finserv.svg',
    'tata capital':'assets/img/lenders/tata-capital.svg','hdb financial services':'assets/img/lenders/hdb-financial-services.svg',
    'l&t finance':'assets/img/lenders/lt-finance.svg','lic housing finance':'assets/img/lenders/lic-housing-finance.png','muthoot finance':'assets/img/lenders/muthoot-finance.png',
    'shriram finance':'assets/img/lenders/shriram-finance.png','cholamandalam':'assets/img/lenders/cholamandalam.svg','edelweiss':'assets/img/lenders/edelweiss.png',
    'iifl finance':'assets/img/lenders/iifl-finance.png','sundaram finance':'assets/img/lenders/sundaram-finance.png','mahindra finance':'assets/img/lenders/mahindra-finance.png',
    'hero fincorp':'assets/img/lenders/hero-fincorp.png','shriram city':'assets/img/lenders/shriram-city.png','creditaccess grameen':'assets/img/lenders/creditaccess-grameen.png',
    'tata motors finance':'assets/img/lenders/tata-motors-finance.svg','reliance home finance':'assets/img/lenders/reliance-home-finance.png'
  };

  function autoLogoForLenderName(name) {
    const n = String(name || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&]+/g, ' ').trim().replace(/\s+/g, ' ');
    if (!n) return '';
    if (KNOWN_LENDER_LOGOS[n]) return KNOWN_LENDER_LOGOS[n];
    // try partial/contains matches for common cases
    const keys = Object.keys(KNOWN_LENDER_LOGOS);
    for (let i = 0; i < keys.length; i++) {
      if (n === keys[i] || n.indexOf(keys[i]) > -1 || keys[i].indexOf(n) > -1) return KNOWN_LENDER_LOGOS[keys[i]];
    }
    return '';
  }

  function lenderDirKey(l, idx) {
    return String((l && (l.id || l.name || l.n)) || ('idx-' + idx));
  }

  async function loadContentLenders(force) {
    if (contentLendersLoading) return Array.isArray(contentLendersCache) ? contentLendersCache : null;
    const host = $('#lenders-content-list');
    const summary = $('#lenders-content-summary');
    contentLendersLoading = true;
    if (summary) summary.textContent = 'Loading lenders from server…';
    try {
      const api = window.ASBackend;
      if (!api || !api.request) throw new Error('Backend API not available.');
      const data = await api.content ? api.content('admin') : api.request('api/content?scope=admin');
      contentLendersCache = Array.isArray(data && data.lenders) ? data.lenders.slice() : [];
      if (host || summary) renderLendersContentAdmin();
      return contentLendersCache;
    } catch (err) {
      contentLendersCache = Array.isArray(contentLendersCache) ? contentLendersCache : [];
      if (host) host.innerHTML = '<div class="empty-state"><p>Could not load lenders. ' + esc(err && err.message ? err.message : 'Sign in to the backend and try again.') + '</p></div>';
      if (summary) summary.textContent = 'Lenders not loaded. Backend sign-in may be required.';
      return contentLendersCache;
    } finally {
      contentLendersLoading = false;
    }
  }

  function renderLendersContentAdmin() {
    const host = $('#lenders-content-list');
    const summary = $('#lenders-content-summary');
    if (!host || !summary) return;
    const lenders = Array.isArray(contentLendersCache) ? contentLendersCache : [];
    if (!lenders.length) {
      host.innerHTML = '<div class="empty-state"><p>No lender directory entries found in website content.</p></div>';
      summary.textContent = '0 lenders in website content.';
      return;
    }
    host.innerHTML = lenders.map((l, idx) => {
      const key = lenderDirKey(l, idx);
      const name = l.name || l.n || 'Lender';
      const cat = String(l.category || l.c || 'nbfc').toLowerCase();
      const catLabel = cat === 'psu' ? 'Public sector bank' : (cat === 'private' ? 'Private bank' : 'NBFC / HFC');
      const logo = l.logo || l.image || l.logoUrl || l.img || '';
      const mono = (l.monogram || l.i || String(name).slice(0, 2)).toUpperCase();
      const color = l.color || l.k || '#163968';
      const preview = logo
        ? '<img src="' + esc(logo) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:contain">'
        : '<span style="display:block;width:100%;height:100%;background:#f3f6fb"></span>';
      const meta = [catLabel, (l.rate || l.r || ''), (l.tenure || l.t || '')].filter(Boolean).join(' · ');
      return '<div class="content-item lender-content-item" data-lender-key="' + esc(key) + '">' +
        '<span class="img-preview" style="width:56px;height:56px;border-radius:12px;overflow:hidden;border:1px solid #e6edf6;background:#fff;flex:none;display:grid;place-items:center">' + preview + '</span>' +
        '<div class="ci-main">' +
          '<b>' + esc(name) + '</b>' +
          '<p>' + esc(meta || 'Lender directory entry') + '</p>' +
          '<div class="ci-meta"><span class="badge badge-' + ((l.active !== false && l.published !== false) ? 'active' : 'inactive') + '">' + ((l.active !== false && l.published !== false) ? 'Visible' : 'Hidden') + '</span>' + (logo ? '<span>Logo auto-assigned</span>' : '<span>No logo</span>') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    const withLogo = lenders.filter(l => l && (l.logo || l.image || l.logoUrl || l.img)).length;
    summary.textContent = lenders.length + ' lenders in website content. ' + withLogo + ' with logo. Logos are auto-assigned when banks are added and shown on the public homepage lender cards.';
  }

  async function saveContentLenders(next, successMsg) {
    const api = window.ASBackend;
    if (!api) { toast('Backend API not available.', 'error'); return false; }
    try {
      await api.publish ? api.publish('lenders', next) : api.request('api/content/lenders', { method: 'PUT', body: next });
      contentLendersCache = Array.isArray(next) ? next.slice() : [];
      renderLendersContentAdmin();
      toast(successMsg || 'Lender directory saved to website content.', 'success');
      return true;
    } catch (err) {
      toast('Could not save lenders: ' + (err && err.message ? err.message : 'request failed'), 'error');
      return false;
    }
  }

  async function resolveLogoForBank(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    // Prefer local known assets for speed and reliability
    const local = autoLogoForLenderName(n);
    if (local) return local;
    const api = window.ASBackend;
    if (api && api.request) {
      try {
        const res = await api.request('api/admin/resolve-logo', { method: 'POST', body: { name: n } });
        if (res && res.logo) return String(res.logo);
      } catch (e) { /* fall through */ }
    }
    return '';
  }

  function addLenderContentModal() {
    const lenders = Array.isArray(contentLendersCache) ? contentLendersCache : [];
    const order = lenders.reduce((m, l) => Math.max(m, Number(l && l.order) || 0), 0) + 1;
    openModal({
      title: 'Add lender to website directory',
      sub: 'Add a bank/lender to the homepage partners section. Its logo is automatically assigned from available sources when the lender is added.',
      body:
        '<div class="form-row"><div class="a-field"><label>Bank / lender name <span class="req">*</span></label><input name="name" required placeholder="e.g. State Bank of India"></div>' +
        '<div class="a-field"><label>Category</label><select name="category"><option value="psu">Public sector bank</option><option value="private">Private bank</option><option value="nbfc" selected>NBFC / HFC</option></select></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Interest rate / range</label><input name="rate" placeholder="e.g. 8.50% p.a. onwards"></div>' +
        '<div class="a-field"><label>Tenure</label><input name="tenure" placeholder="e.g. Up to 30 years"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Loan amount</label><input name="amount" placeholder="e.g. As per profile & product"></div>' +
        '<div class="a-field"><label>Processing / charges</label><input name="fee" placeholder="e.g. As per lender schedule"></div></div>' +
        '<div class="a-field"><label>Products (comma separated keys/labels)</label><input name="products" placeholder="e.g. home, lap, personal, business"></div>' +
        '<div class="a-field"><label>Benefits (one per line)</label><textarea name="benefits" rows="3" placeholder="Key benefit 1&#10;Key benefit 2"></textarea></div>' +
        '<div class="form-row"><div class="a-field"><label>Status</label><select name="active"><option value="true" selected>Visible (active)</option><option value="false">Hidden</option></select></div>' +
        '<div class="a-field"><label>Order</label><input name="order" type="number" min="0" value="' + esc(order) + '"></div></div>' +
        '<div class="a-field"><small style="display:block;color:var(--muted);font-size:.72rem">Logo is assigned automatically (no manual upload). If no logo can be found, the lender will be added without one.</small></div>',
      submitLabel: 'Add lender',
      onSubmit: async (data) => {
        const name = String(data.get('name') || '').trim();
        if (!name) { toast('Lender name is required.', 'error'); return false; }
        const category = String(data.get('category') || 'nbfc').toLowerCase();
        const products = String(data.get('products') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 12);
        const benefits = String(data.get('benefits') || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).slice(0, 8);
        const logo = await resolveLogoForBank(name);
        const lender = {
          id: uid('LND-', 2),
          name,
          category: (category === 'psu' || category === 'private' || category === 'nbfc') ? category : 'nbfc',
          monogram: name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'LN',
          color: '#163968',
          logo: logo || '',
          rate: String(data.get('rate') || '').trim(),
          emi: '',
          tenure: String(data.get('tenure') || '').trim(),
          amount: String(data.get('amount') || '').trim(),
          fee: String(data.get('fee') || '').trim(),
          benefits,
          products,
          active: data.get('active') !== 'false',
          published: data.get('active') !== 'false',
          order: Number.isFinite(Number(data.get('order'))) ? Math.max(0, Math.floor(Number(data.get('order')))) : order
        };
        const next = (Array.isArray(contentLendersCache) ? contentLendersCache.slice() : []).concat([lender]);
        const ok = await saveContentLenders(next, logo ? 'Lender added and logo auto-assigned.' : 'Lender added (logo not found automatically).');
        return ok;
      }
    });
  }

  async function syncPartnerLogoToWebsiteLenders(partnerName, logo) {
    if (!partnerName || !logo) return false;
    try {
      if (!Array.isArray(contentLendersCache)) {
        // try to load website lenders; ignore failure (e.g. not signed in to backend)
        await loadContentLenders();
      }
      if (!Array.isArray(contentLendersCache) || !contentLendersCache.length) return false;
      const norm = (s) => String(s || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9&]+/g, ' ').trim().replace(/\s+/g, ' ');
      const target = norm(partnerName);
      let changed = false;
      const next = contentLendersCache.map(l => {
        const name = norm(l && (l.name || l.n));
        if (!name || !target) return l;
        const match = name === target || name.indexOf(target) > -1 || target.indexOf(name) > -1;
        if (match && (l.logo || '') !== logo) { changed = true; return Object.assign({}, l, { logo }); }
        return l;
      });
      if (changed) {
        await saveContentLenders(next, 'Partner logo synced to website lender directory.');
        return true;
      }
    } catch (e) { /* best effort */ }
    return false;
  }

  function bindLendersContentAdmin() {
    const list = $('#lenders-content-list');
    const refresh = $('#refresh-lenders-content-btn');
    const addBtn = $('#add-lender-content-btn');
    if (refresh && !refresh._bound) {
      refresh._bound = true;
      refresh.addEventListener('click', () => loadContentLenders(true));
    }
    if (addBtn && !addBtn._bound) {
      addBtn._bound = true;
      addBtn.addEventListener('click', () => addLenderContentModal());
    }
    if (!list || list._bound) return;
    list._bound = true;
  }

  function renderContent() {
    const tList = $('#testimonials-list');
    const pList = $('#posts-list');

    if (tList) {
      tList.innerHTML = testimonials.length ? testimonials.map(t =>
        '<div class="content-item">' +
          '<div class="ci-main"><b>' + esc(t.name) + '</b>' +
          '<p>' + esc(t.quote) + '</p>' +
          '<div class="ci-meta"><span>' + esc(t.product) + '</span><span>' + esc(t.location) + '</span><span>' + fmtShort(t.date) + '</span><span class="badge badge-' + (t.published ? 'active' : 'inactive') + '">' + (t.published ? 'Published' : 'Hidden') + '</span></div></div>' +
          '<div class="ci-actions">' +
            '<label class="switch" title="Show this review on the homepage"><input type="checkbox" data-toggle="testimonial" data-id="' + esc(t.id) + '" aria-label="Show review from ' + esc(t.name) + ' on the homepage" ' + (t.published ? 'checked' : '') + '><span></span></label>' +
            '<button class="a-btn-icon" data-action="edit-testimonial" data-id="' + esc(t.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
            '<button class="a-btn-icon danger" data-action="delete-testimonial" data-id="' + esc(t.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
          '</div></div>'
      ).join('') : '<div class="empty-state"><h4>No testimonials yet</h4><p>Add client reviews to build trust on the homepage.</p></div>';
    }

    const summary = $('#testimonials-summary');
    if (summary) {
      if (!testimonials.length) {
        summary.textContent = 'No testimonials added yet.';
      } else {
        const publishedCount = testimonials.filter(t => t.published).length;
        summary.textContent = publishedCount + ' of ' + testimonials.length + ' published · Homepage shows published reviews in this order';
      }
    }

    if (pList) {
      pList.innerHTML = posts.length ? posts.map(p =>
        '<div class="content-item">' +
          '<div class="ci-main"><b>' + esc(p.title) + '</b><p>' + esc(p.excerpt) + '</p>' +
          '<div class="ci-meta"><span>' + esc(p.category) + '</span><span>' + esc(p.readTime) + ' read</span><span>' + fmtShort(p.date) + '</span><span class="badge badge-' + (p.published ? 'active' : 'inactive') + '">' + (p.published ? 'Published' : 'Draft') + '</span></div></div>' +
          '<div class="ci-actions">' +
            '<label class="switch" title="Publish this article on the website"><input type="checkbox" data-toggle="post" data-id="' + esc(p.id) + '" aria-label="Publish article: ' + esc(p.title) + '" ' + (p.published ? 'checked' : '') + '><span></span></label>' +
            '<button class="a-btn-icon" data-action="edit-post" data-id="' + esc(p.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
            '<button class="a-btn-icon danger" data-action="delete-post" data-id="' + esc(p.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
          '</div></div>'
      ).join('') : '<div class="empty-state"><h4>No articles yet</h4><p>Add guides and articles to help visitors make informed decisions.</p></div>';
    }

    const postsSummary = $('#posts-summary');
    if (postsSummary) {
      if (!posts.length) {
        postsSummary.textContent = 'No guides or articles added yet.';
      } else {
        const publishedCount = posts.filter(p => p.published).length;
        postsSummary.textContent = publishedCount + ' of ' + posts.length + ' published · Drafts stay hidden from the website';
      }
    }

    renderGalleryAdmin();
  }

  function renderGalleryAdmin() {
    const host = $('#gallery-admin-list');
    if (!host) return;
    if (!gallery.length) {
      host.innerHTML = '<div class="empty-state"><p>No posters yet. Add a poster to show it in the homepage gallery.</p></div>';
    } else {
      host.innerHTML = gallery.map(item => {
        const src = item.src || '';
        const isUpload = src.indexOf('data:image/') === 0;
        return '<div class="content-item gallery-admin-item" data-gallery-id="' + esc(item.id) + '">' +
          '<span class="img-preview gallery-admin-preview">' + (src
            ? '<img src="' + esc(src) + '" alt="" loading="lazy">'
            : '<svg class="icon" aria-hidden="true"><use href="#i-image"></use></svg>') + '</span>' +
          '<div class="ci-main">' +
            '<label class="sr-only" for="gal-cap-' + esc(item.id) + '">Poster caption</label>' +
            '<input id="gal-cap-' + esc(item.id) + '" class="gallery-caption-input" type="text" value="' + esc(item.caption || '') + '" placeholder="Poster caption" data-gallery-caption="' + esc(item.id) + '">' +
            '<p class="image-status">' + (isUpload ? 'Uploaded photo (this browser).' : 'Using image file.') + '</p>' +
            '<div class="image-upload-row">' +
              '<label class="a-btn a-btn-light a-btn-sm image-upload-btn"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-image"></use></svg> Change image<input type="file" accept="image/*" data-gallery-upload="' + esc(item.id) + '" class="image-upload-input"></label>' +
              '<button type="button" class="a-btn a-btn-ghost a-btn-sm" data-gallery-action="delete" data-id="' + esc(item.id) + '">Remove</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    const summary = $('#gallery-summary');
    if (summary) {
      const uploads = gallery.filter(g => typeof g.src === 'string' && g.src.indexOf('data:image/') === 0).length;
      let text = gallery.length + ' poster' + (gallery.length === 1 ? '' : 's') + ' in the homepage gallery. Changes show on the homepage in this browser only.';
      if (uploads) text += ' Uploaded photos are stored only in this browser.';
      summary.textContent = text;
    }
  }

  function renderContentImages() {
    const imagesHost = $('#content-images-list');
    if (!imagesHost) return;
    imagesHost.innerHTML = CONTENT_IMAGE_SLOTS.map(slot => {
      const selected = contentImages[slot.key] || slot.fallback;
      const isIcon = selected === 'icon';
      const isUpload = typeof selected === 'string' && selected.indexOf('data:image/') === 0;
      const isCustom = !!contentImages[slot.key] && contentImages[slot.key] !== slot.fallback;
      const previewSrc = isIcon ? '' : selected;
      let note = 'Using default image.';
      if (isIcon) note = slot.fallback === 'icon' ? 'Using default icon.' : 'Using icon only.';
      if (isUpload) note = 'Uploaded photo saved in this browser.';

      return '<div class="content-item image-item">' +
        '<span class="img-preview">' + (isIcon
          ? '<svg class="icon" aria-hidden="true"><use href="#i-image"></use></svg>'
          : '<img src="' + esc(previewSrc) + '" alt="" loading="lazy">') + '</span>' +
        '<div class="ci-main"><b>' + esc(slot.label) + '</b>' +
          '<p class="image-status">' + esc(note) + '</p>' +
          '<div class="image-upload-row">' +
            '<label class="a-btn a-btn-light a-btn-sm image-upload-btn"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-plus"></use></svg> Upload from device<input type="file" accept="image/*" data-upload-image="' + esc(slot.key) + '" class="image-upload-input"></label>' +
            '<button type="button" class="a-btn a-btn-ghost a-btn-sm" data-image-action="icon" data-key="' + esc(slot.key) + '"' + (isIcon ? ' disabled' : '') + '>Icon only</button>' +
            (isCustom ? '<button type="button" class="a-btn a-btn-ghost a-btn-sm" data-image-action="default" data-key="' + esc(slot.key) + '">Use default</button>' : '') +
          '</div>' +
        '</div></div>';
    }).join('');

    const imagesSummary = $('#content-images-summary');
    if (imagesSummary) {
      const customCount = CONTENT_IMAGE_SLOTS.filter(slot => contentImages[slot.key] && contentImages[slot.key] !== slot.fallback).length;
      const uploadCount = CONTENT_IMAGE_SLOTS.filter(slot => typeof contentImages[slot.key] === 'string' && contentImages[slot.key].indexOf('data:image/') === 0).length;
      let text = customCount
        ? customCount + ' of ' + CONTENT_IMAGE_SLOTS.length + ' cards customised. Changes show on the homepage in this browser only.'
        : 'All cards use their default look. Upload a photo or choose icon only for any card.';
      if (uploadCount) text += ' Uploaded photos are stored only in this browser.';
      imagesSummary.textContent = text;
    }
  }

  function testimonialModal(id) {
    const t = id ? testimonials.find(x => x.id === id) : null;
    openModal({
      title: t ? 'Edit testimonial' : 'Add testimonial',
      sub: 'Published reviews appear on the homepage in this browser.',
      body:
        '<div class="form-row"><div class="a-field"><label>Client name <span class="req">*</span></label><input name="name" required value="' + esc(t ? t.name : '') + '"></div>' +
        '<div class="a-field"><label>Location</label><input name="location" value="' + esc(t ? t.location : 'Hyderabad') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Loan product</label><input name="product" value="' + esc(t ? t.product : 'Home loan') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Quote</label><textarea name="quote" required>' + esc(t ? t.quote : '') + '</textarea></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Visibility</label><select name="published"><option value="true" ' + (!t || t.published ? 'selected' : '') + '>Published</option><option value="false" ' + (t && !t.published ? 'selected' : '') + '>Hidden</option></select></div></div>',
      submitLabel: t ? 'Save changes' : 'Add testimonial',
      onSubmit: (data) => {
        const name = String(data.get('name') || '').trim();
        const quote = String(data.get('quote') || '').trim();
        if (!name || !quote) { toast('Name and quote are required.', 'error'); return false; }
        const payload = { name, location: String(data.get('location') || ''), product: String(data.get('product') || ''), quote, published: data.get('published') === 'true', date: t ? t.date : new Date().toISOString() };
        if (t) { Object.assign(t, payload); toast('Testimonial updated.'); }
        else { testimonials.unshift(Object.assign({ id: uid('TST-', 2) }, payload)); toast('Testimonial added.'); }
        save.testimonials();
        renderAll();
      }
    });
  }

  function postModal(id) {
    const p = id ? posts.find(x => x.id === id) : null;
    openModal({
      title: p ? 'Edit article' : 'Add article',
      sub: 'Guides and insights for prospective borrowers.',
      body:
        '<div class="form-row one"><div class="a-field"><label>Title <span class="req">*</span></label><input name="title" required value="' + esc(p ? p.title : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Category</label><input name="category" value="' + esc(p ? p.category : 'Home loans') + '"></div>' +
        '<div class="a-field"><label>Read time</label><input name="readTime" value="' + esc(p ? p.readTime : '5 min') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Excerpt</label><textarea name="excerpt">' + esc(p ? p.excerpt : '') + '</textarea></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Status</label><select name="published"><option value="true" ' + (!p || p.published ? 'selected' : '') + '>Published</option><option value="false" ' + (p && !p.published ? 'selected' : '') + '>Draft</option></select></div></div>',
      submitLabel: p ? 'Save changes' : 'Add article',
      onSubmit: (data) => {
        const title = String(data.get('title') || '').trim();
        if (!title) { toast('Title is required.', 'error'); return false; }
        const payload = { title, category: String(data.get('category') || ''), readTime: String(data.get('readTime') || '5 min'), excerpt: String(data.get('excerpt') || ''), published: data.get('published') === 'true', date: p ? p.date : new Date().toISOString() };
        if (p) { Object.assign(p, payload); toast('Article updated.'); }
        else { posts.unshift(Object.assign({ id: uid('BLG-', 2) }, payload)); toast('Article added.'); }
        save.posts();
        renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- customers */
  function renderCustomers() {
    const body = $('#customers-body');
    if (!body) return;
    if (!customers.length) {
      body.innerHTML = '<tr><td colspan="7" class="table-empty"><svg class="icon" aria-hidden="true"><use href="#i-users"></use></svg><br>No customers yet.<br><button class="a-btn a-btn-light a-btn-sm" style="margin-top:10px" id="add-customer-inline">Add customer</button></td></tr>';
      const inline = $('#add-customer-inline');
      if (inline) inline.addEventListener('click', () => customerModal());
      return;
    }
    const rows = customers.slice().sort((a,b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    body.innerHTML = rows.map(c =>
      '<tr>' +
      '<td><div class="cust"><span class="cust-avatar">' + initials(c.name || '?') + '</span><span><b>' + esc(c.name || 'Unnamed') + '</b><span>' + esc(c.id || '') + '</span></span></div></td>' +
      '<td>' + esc(c.phone || '—') + '</td>' +
      '<td>' + esc(c.email || '—') + '</td>' +
      '<td>' + esc(c.product || c.interest || '—') + '</td>' +
      '<td><span class="badge badge-' + String(c.status || 'new').toLowerCase().replace(/[^a-z]/g,'') + '">' + esc(c.status || 'New') + '</span></td>' +
      '<td>' + esc(c.city || '—') + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="a-btn-icon" data-action="edit-customer" data-id="' + esc(c.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
        '<button class="a-btn-icon danger" data-action="delete-customer" data-id="' + esc(c.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>'
    ).join('');
  }

  function customerModal(id) {
    const c = id ? customers.find(x => x.id === id) : null;
    const statusOpts = ['New', 'Contacted', 'Qualified', 'Documents', 'Sanctioned', 'Disbursed', 'Inactive'].map(s => '<option ' + ((c ? c.status : 'New') === s ? 'selected' : '') + '>' + s + '</option>').join('');
    openModal({
      title: c ? 'Edit customer' : 'Add customer',
      sub: 'Customer profile and relationship details.',
      body:
        '<div class="form-row"><div class="a-field"><label>Full name <span class="req">*</span></label><input name="name" required value="' + esc(c ? c.name : '') + '"></div>' +
        '<div class="a-field"><label>Phone</label><input name="phone" value="' + esc(c ? c.phone : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Email</label><input name="email" type="email" value="' + esc(c ? c.email : '') + '"></div>' +
        '<div class="a-field"><label>City</label><input name="city" value="' + esc(c ? c.city : '') + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Product interest</label><input name="product" value="' + esc(c ? (c.product || c.interest || '') : '') + '" placeholder="e.g. Home Loan"></div>' +
        '<div class="a-field"><label>Status</label><select name="status">' + statusOpts + '</select></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Assigned to</label><input name="owner" value="' + esc(c ? (c.owner || '') : '') + '"></div>' +
        '<div class="a-field"><label>Source</label><input name="source" value="' + esc(c ? (c.source || '') : '') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Notes</label><textarea name="notes">' + esc(c ? (c.notes || '') : '') + '</textarea></div></div>',
      submitLabel: c ? 'Save changes' : 'Add customer',
      onSubmit: (data) => {
        const name = String(data.get('name') || '').trim();
        if (!name) { toast('Customer name is required.', 'error'); return false; }
        const now = new Date().toISOString();
        const payload = {
          name,
          phone: String(data.get('phone') || '').trim(),
          email: String(data.get('email') || '').trim(),
          city: String(data.get('city') || '').trim(),
          product: String(data.get('product') || '').trim(),
          status: String(data.get('status') || 'New'),
          owner: String(data.get('owner') || '').trim(),
          source: String(data.get('source') || '').trim(),
          notes: String(data.get('notes') || '').trim(),
          updatedAt: now
        };
        if (c) { Object.assign(c, payload); toast('Customer updated.'); }
        else { customers.unshift(Object.assign({ id: uid('CUS-', 4), createdAt: now }, payload)); toast('Customer added.'); }
        save.customers();
        renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- documents */
  function renderDocuments() {
    const body = $('#documents-body');
    if (!body) return;
    if (!documents.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty"><svg class="icon" aria-hidden="true"><use href="#i-doc"></use></svg><br>No document records yet.<br><button class="a-btn a-btn-light a-btn-sm" style="margin-top:10px" id="add-document-inline">Add document</button></td></tr>';
      const inline = $('#add-document-inline');
      if (inline) inline.addEventListener('click', () => documentModal());
      return;
    }
    const rows = documents.slice().sort((a,b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
    body.innerHTML = rows.map(d =>
      '<tr>' +
      '<td><b>' + esc(d.title || 'Untitled') + '</b><div style="font-size:.66rem;color:#5b6b7e">' + esc(d.id || '') + '</div></td>' +
      '<td>' + esc(d.type || d.docType || '—') + '</td>' +
      '<td>' + esc(d.linkedTo || d.customer || d.applicationId || '—') + '</td>' +
      '<td><span class="badge badge-' + String(d.status || 'pending').toLowerCase().replace(/[^a-z]/g,'') + '">' + esc(d.status || 'Pending') + '</span></td>' +
      '<td title="' + fmtDate(d.updatedAt || d.createdAt) + '">' + fmtShort(d.updatedAt || d.createdAt) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="a-btn-icon" data-action="edit-document" data-id="' + esc(d.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
        '<button class="a-btn-icon danger" data-action="delete-document" data-id="' + esc(d.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>'
    ).join('');
  }

  function documentModal(id) {
    const d = id ? documents.find(x => x.id === id) : null;
    const statusOpts = ['Pending', 'Requested', 'Received', 'Verified', 'Rejected'].map(s => '<option ' + ((d ? d.status : 'Pending') === s ? 'selected' : '') + '>' + s + '</option>').join('');
    openModal({
      title: d ? 'Edit document record' : 'Add document record',
      sub: 'Track document metadata and status (file uploads can be integrated separately).',
      body:
        '<div class="form-row"><div class="a-field"><label>Title <span class="req">*</span></label><input name="title" required value="' + esc(d ? d.title : '') + '" placeholder="e.g. PAN card"></div>' +
        '<div class="a-field"><label>Type</label><input name="type" value="' + esc(d ? (d.type || d.docType || '') : '') + '" placeholder="KYC / Income / Property"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Customer/Application</label><input name="linkedTo" value="' + esc(d ? (d.linkedTo || d.customer || d.applicationId || '') : '') + '"></div>' +
        '<div class="a-field"><label>Status</label><select name="status">' + statusOpts + '</select></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Reference/Link (optional)</label><input name="url" value="' + esc(d ? (d.url || '') : '') + '" placeholder="https://... or reference"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Notes</label><textarea name="notes">' + esc(d ? (d.notes || '') : '') + '</textarea></div></div>',
      submitLabel: d ? 'Save changes' : 'Add document',
      onSubmit: (data) => {
        const title = String(data.get('title') || '').trim();
        if (!title) { toast('Document title is required.', 'error'); return false; }
        const now = new Date().toISOString();
        const payload = {
          title,
          type: String(data.get('type') || '').trim(),
          linkedTo: String(data.get('linkedTo') || '').trim(),
          status: String(data.get('status') || 'Pending'),
          url: String(data.get('url') || '').trim(),
          notes: String(data.get('notes') || '').trim(),
          updatedAt: now
        };
        if (d) { Object.assign(d, payload); toast('Document updated.'); }
        else { documents.unshift(Object.assign({ id: uid('DOC-', 4), createdAt: now }, payload)); toast('Document added.'); }
        save.documents();
        renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- notifications */
  function renderNotifications() {
    const host = $('#notifications-list');
    if (!host) return;
    const items = Array.isArray(notifications) ? notifications.slice().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) : [];
    if (!items.length) {
      host.innerHTML = '<div class="empty-state" style="padding:24px"><svg class="icon" aria-hidden="true"><use href="#i-bell"></use></svg><h3>No notifications</h3><p>New website enquiries will appear here automatically.</p></div>';
      return;
    }
    host.innerHTML = items.map(n => {
      const unread = !n.read;
      const when = n.createdAt ? (fmtShort(n.createdAt) + ' · ' + timeAgo(n.createdAt)) : '';
      return '<div class="notif-row" style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid #f2eee4;' + (unread ? 'background:rgba(201,162,39,.06);margin:0 -8px;padding-left:8px;padding-right:8px;border-radius:10px;' : '') + '">' +
        '<span class="n-icon" style="width:32px;height:32px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none;background:var(--blue-soft);color:var(--blue)"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-bell"></use></svg></span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><b style="font-size:.82rem;color:var(--navy);display:block">' + esc(n.title || 'Notification') + '</b>' +
            '<span style="font-size:.68rem;color:var(--muted);white-space:nowrap">' + esc(when) + '</span></div>' +
          '<div style="font-size:.76rem;color:var(--muted);margin-top:2px;line-height:1.45">' + esc(n.message || '') + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
            '<button class="a-btn a-btn-light a-btn-sm" data-action="toggle-notification" data-id="' + esc(n.id) + '">' + (unread ? 'Mark read' : 'Mark unread') + '</button>' +
            '<button class="a-btn a-btn-ghost a-btn-sm danger" data-action="delete-notification" data-id="' + esc(n.id) + '">Dismiss</button>' +
          '</div>' +
        '</div></div>';
    }).join('');
  }

  /* ---------------------------------------------------------------- reports */
  function renderReports() {
    const sanctioned = apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage));
    const disb = apps.filter(a => a.stage === 'Disbursed');
    const sanctionedTotal = sanctioned.reduce((s, a) => s + Number(a.amount || 0), 0);
    const total = disb.reduce((s, a) => s + Number(a.amount || 0), 0);
    const conversion = leads.length ? Math.round(sanctioned.length / leads.length * 100) : 0;
    const avg = sanctioned.length ? sanctionedTotal / sanctioned.length : 0;
    const activePartners = partners.filter(p => p.active).length;

    $('#report-disbursed').textContent = compact(total);
    $('#report-conversion').textContent = conversion + '%';
    $('#report-ticket').textContent = compact(avg);
    $('#report-lenders').textContent = activePartners;

    // funnel from actual counts
    const funnel = [
      ['Enquiries received', leads.length],
      ['Contacted / qualified', leads.filter(l => !['New', 'Lost'].includes(l.status)).length],
      ['Documents submitted', apps.filter(a => a.stage !== 'Logged').length],
      ['Sanctioned', sanctioned.length],
      ['Disbursed', disb.length]
    ];
    const maxF = Math.max(...funnel.map(f => f[1]), 1);
    $('#funnel-list').innerHTML = funnel.map(([label, count]) =>
      '<div class="pipeline-row"><div class="p-top"><span>' + label + '</span><b>' + count + (funnel[0][1] ? ' · ' + Math.round(count / funnel[0][1] * 100) + '%' : '') + '</b></div><div class="pipeline-track"><span style="width:' + Math.max(4, Math.round(count / maxF * 100)) + '%"></span></div></div>'
    ).join('');

    // lender performance
    const lenderMap = {};
    apps.forEach(a => {
      if (!lenderMap[a.lender]) lenderMap[a.lender] = { count: 0, sanctioned: 0, rates: [], approved: 0 };
      const x = lenderMap[a.lender];
      x.count++;
      x.rates.push(Number(a.rate) || 0);
      if (['Sanctioned', 'Disbursed'].includes(a.stage)) { x.approved++; x.sanctioned += Number(a.amount || 0); }
    });
    const lenderRows = Object.entries(lenderMap).sort((a, b) => b[1].sanctioned - a[1].sanctioned).slice(0, 8);
    $('#lender-body').innerHTML = lenderRows.length ? lenderRows.map(([name, d]) => {
      const partner = partners.find(p => p.name === name);
      const avgRate = d.rates.length ? d.rates.reduce((s, r) => s + r, 0) / d.rates.length : 0;
      return '<tr><td><div class="cust"><span class="cust-avatar" style="background:var(--cream-2)">' + initials(name) + '</span><b style="font-weight:700">' + esc(name) + '</b></div></td>' +
        '<td>' + esc(partner ? partner.type : '—') + '</td><td>' + d.count + '</td><td class="num">' + compact(d.sanctioned) + '</td><td>' + avgRate.toFixed(2) + '%</td>' +
        '<td><span class="badge badge-' + (d.count && d.approved / d.count >= 0.7 ? 'active' : 'inactive') + '">' + (d.count ? Math.round(d.approved / d.count * 100) : 0) + '%</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">No lender activity yet.</td></tr>';
  }

  /* ---------------------------------------------------------------- settings */
  function renderSettings() {
    const map = {
      'set-name': settings.businessName, 'set-tagline': settings.tagline, 'set-phone': settings.phone,
      'set-phoneRaw': settings.phoneRaw, 'set-email': settings.email, 'set-address': settings.address,
      'set-hours': settings.hours, 'set-whatsapp': settings.whatsapp
    };
    Object.entries(map).forEach(([id, val]) => { const el = $('#' + id); if (el) el.value = val || ''; });
    const n = settings.notifications || {};
    const toggles = { 'notif-leads': n.leads, 'notif-apps': n.apps, 'notif-weekly': n.weekly, 'notif-whatsapp': n.whatsapp };
    Object.entries(toggles).forEach(([id, val]) => { const el = $('#' + id); if (el) el.checked = !!val; });
    renderAccount();
    loadSessions();
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) { loadUsers(); loadAudit(); }
  }

  /* ---------------------------------------------------------------- modal */
  let modalSubmitHandler = null;

  function openModal(opts) {
    $('#modal-title').textContent = opts.title || '';
    $('#modal-sub').textContent = opts.sub || '';
    $('#modal-body').innerHTML = '<form id="modal-form">' + (opts.body || '') + '<button type="submit" class="sr-only">Save</button></form>';
    $('#modal-foot').innerHTML =
      '<button class="a-btn a-btn-light" id="modal-cancel">Cancel</button>' +
      '<button class="a-btn a-btn-primary" type="submit" form="modal-form">' + esc(opts.submitLabel || 'Save') + '</button>';
    modalSubmitHandler = opts.onSubmit || null;
    $('#modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    const form = $('#modal-form');
    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      if (!modalSubmitHandler) return closeModal();
      const submitBtn = $('#modal-foot button[type="submit"]') || $('#modal-foot .a-btn-primary');
      const prevLabel = submitBtn ? submitBtn.textContent : '';
      try {
        submitting = true;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }
        const result = await Promise.resolve(modalSubmitHandler(new FormData(form)));
        if (result !== false) closeModal();
      } finally {
        submitting = false;
        if (submitBtn && document.body.contains(submitBtn)) { submitBtn.disabled = false; submitBtn.textContent = prevLabel; }
      }
    });
    $('#modal-cancel').addEventListener('click', closeModal);
    setTimeout(() => { const f = form.querySelector('input,select,textarea'); if (f) f.focus(); }, 60);
  }

  function closeModal() {
    $('#modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
    modalSubmitHandler = null;
  }

  function confirmDialog(title, message, onConfirm) {
    $('#modal-title').textContent = title;
    $('#modal-sub').textContent = 'This action cannot be undone.';
    $('#modal-body').innerHTML = '<div style="display:flex;gap:12px;align-items:flex-start"><span style="width:38px;height:38px;border-radius:10px;background:var(--red-soft);color:var(--red);display:grid;place-items:center;flex:none"><svg class="icon" aria-hidden="true"><use href="#i-alert"></use></svg></span><p style="margin:0;font-size:.84rem;color:var(--muted);line-height:1.6">' + esc(message) + '</p></div>';
    $('#modal-foot').innerHTML = '<button class="a-btn a-btn-light" id="modal-cancel">Cancel</button><button class="a-btn a-btn-danger" id="modal-confirm">Delete</button>';
    $('#modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    $('#modal-cancel').addEventListener('click', closeModal);
    $('#modal-confirm').addEventListener('click', () => { closeModal(); onConfirm(); });
  }

  function taskModal() {
    openModal({
      title: 'Add a follow-up',
      sub: 'Keep the next action visible for the whole team.',
      body: '<div class="form-row one"><div class="a-field"><label>Task <span class="req">*</span></label><input name="text" required placeholder="e.g. Call the client with the sanction update"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Due</label><input name="due" placeholder="e.g. Today, 4:00 PM"></div></div>',
      submitLabel: 'Add task',
      onSubmit: (data) => {
        const text = String(data.get('text') || '').trim();
        if (!text) return false;
        tasks.unshift({ id: uid('TSK-', 2), text, due: String(data.get('due') || 'Today'), done: false });
        save.tasks();
        renderTasks();
        toast('Follow-up added.');
      }
    });
  }

  /* ---------------------------------------------------------------- CSV */
  function downloadCSV(filename, rows) {
    const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function exportLeads() {
    downloadCSV('as-financial-leads.csv', [
      ['ID', 'Name', 'Phone', 'Email', 'Product', 'Amount', 'Source', 'Status', 'Priority', 'City', 'Created'],
      ...filteredLeads().map(l => [l.id, l.name, l.phone, l.email, l.product, amountToNumber(l.amount), l.source, l.status, l.priority, l.city, fmtDate(l.createdAt)])
    ]);
    toast('Leads exported as CSV.');
  }

  function exportApps() {
    downloadCSV('as-financial-applications.csv', [
      ['Application', 'Customer', 'Phone', 'Product', 'Amount', 'Lender', 'Stage', 'Rate', 'Applied'],
      ...apps.map(a => [a.id, a.customer, a.phone, a.product, a.amount, a.lender, a.stage, a.rate, fmtDate(a.appliedAt)])
    ]);
    toast('Applications exported as CSV.');
  }

  function exportSummary() {
    const sanctioned = apps.filter(a => ['Sanctioned', 'Disbursed'].includes(a.stage));
    downloadCSV('as-financial-performance.csv', [
      ['Metric', 'Value'],
      ['Total leads', leads.length],
      ['Open leads', leads.filter(l => !['Sanctioned', 'Disbursed', 'Lost'].includes(l.status)).length],
      ['Total applications', apps.length],
      ['Sanctioned applications', sanctioned.length],
      ['Sanctioned value', sanctioned.reduce((s, a) => s + Number(a.amount || 0), 0)],
      ['Disbursed value', apps.filter(a => a.stage === 'Disbursed').reduce((s, a) => s + Number(a.amount || 0), 0)],
      ['Active partners', partners.filter(p => p.active).length],
      ['Report generated', new Date().toLocaleString('en-IN')]
    ]);
    toast('Performance report exported.');
  }

  /* ---------------------------------------------------------------- sidebar */
  function openSidebar() {
    $('#admin-sidebar').classList.add('open');
    $('#sidebar-scrim').classList.add('open');
  }
  function closeSidebar() {
    $('#admin-sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('open');
  }

  /* ---------------------------------------------------------------- events */
  function bindEvents() {
    // login (backend-authenticated)
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#login-email').value.trim().toLowerCase();
      const pass = $('#login-password').value;
      const submitBtn = $('#login-form button[type="submit"]');
      const err = $('#login-error');
      const api = window.ASBackend;
      if (!api) {
        err.textContent = 'Backend client unavailable. Please reload the page.';
        err.classList.add('show');
        return;
      }
      if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }
      err.classList.remove('show');
      api.available().then((ok) => {
        if (!ok) throw Object.assign(new Error('Backend is unavailable. Start the server and try again.'), { status: 503 });
        return api.login(email, pass);
      }).then((result) => {
        if (result && !isAllowedAdminRole(result)) {
          denyAccess('Administrator access only.');
          return;
        }
        enterApp(result || { email: email }, true);
      }).catch((error) => {
        err.textContent = (error && error.message) || 'Sign in failed. Check your details and try again.';
        err.classList.add('show');
      }).then(() => {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
      });
    });

    // logout
    ['logout-btn', 'sidebar-logout'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('click', logout);
    });

    // forgot / reset password
    const forgotBtn = $('#forgot-password-btn');
    if (forgotBtn) forgotBtn.addEventListener('click', () => { showLoginPanel('forgot'); const e = $('#login-error'); if (e) e.classList.remove('show'); });
    const forgotBack = $('#forgot-back-btn');
    if (forgotBack) forgotBack.addEventListener('click', () => showLoginPanel('login'));
    const resetBack = $('#reset-back-btn');
    if (resetBack) resetBack.addEventListener('click', () => { pendingResetToken = ''; history.replaceState(null, '', location.pathname + location.hash); showLoginPanel('login'); });
    const forgotForm = $('#forgot-form');
    if (forgotForm) forgotForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const api = window.ASBackend;
      const resultEl = $('#forgot-result');
      const email = ($('#forgot-email') && $('#forgot-email').value || '').trim().toLowerCase();
      if (!api || !email) return;
      showMsg(resultEl, 'Requesting reset…', 'info');
      api.request('api/forgot-password', { method: 'POST', body: { email } }).then((res) => {
        let msg = (res && res.message) || 'If an account exists for that email, reset instructions have been prepared.';
        if (res && res.devResetUrl) {
          msg += ' Development reset link: ' + location.origin + res.devResetUrl;
          if (res.devResetToken) { pendingResetToken = res.devResetToken; }
        }
        showMsg(resultEl, msg, 'ok');
        if (res && res.devResetToken) { showLoginPanel('reset'); }
      }).catch((err) => showMsg(resultEl, (err && err.message) || 'Could not request password reset.', 'error'));
    });
    const resetForm = $('#reset-form');
    if (resetForm) resetForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const api = window.ASBackend;
      const resultEl = $('#reset-result');
      const pw = ($('#reset-password') && $('#reset-password').value) || '';
      const confirm = ($('#reset-password-confirm') && $('#reset-password-confirm').value) || '';
      if (!pendingResetToken) { showMsg(resultEl, 'Reset link is missing or invalid. Please request a new one.', 'error'); return; }
      if (pw.length < 6) { showMsg(resultEl, 'Password must be at least 6 characters.', 'error'); return; }
      if (pw !== confirm) { showMsg(resultEl, 'Passwords do not match.', 'error'); return; }
      showMsg(resultEl, 'Updating password…', 'info');
      api.request('api/reset-password', { method: 'POST', body: { token: pendingResetToken, newPassword: pw } }).then((res) => {
        showMsg(resultEl, (res && res.message) || 'Password updated. You can now sign in.', 'ok');
        pendingResetToken = '';
        history.replaceState(null, '', location.pathname + location.hash);
        if ($('#reset-password')) $('#reset-password').value = '';
        if ($('#reset-password-confirm')) $('#reset-password-confirm').value = '';
        setTimeout(() => showLoginPanel('login'), 800);
      }).catch((err) => showMsg(resultEl, (err && err.message) || 'Could not reset password.', 'error'));
    });

    // change password (settings)
    const cpForm = $('#change-password-form');
    if (cpForm) cpForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const api = window.ASBackend;
      const msg = $('#change-password-msg');
      const currentPassword = ($('#cp-current') && $('#cp-current').value) || '';
      const newPassword = ($('#cp-new') && $('#cp-new').value) || '';
      const confirm = ($('#cp-confirm') && $('#cp-confirm').value) || '';
      if (newPassword.length < 6) { showMsg(msg, 'New password must be at least 6 characters.', 'error'); return; }
      if (newPassword !== confirm) { showMsg(msg, 'New passwords do not match.', 'error'); return; }
      showMsg(msg, 'Updating password…', 'info');
      api.request('api/change-password', { method: 'POST', body: { currentPassword, newPassword } }).then((res) => {
        showMsg(msg, 'Password updated. Other sessions were signed out.', 'ok');
        if (res) currentUser = Object.assign({}, currentUser || {}, res);
        if ($('#cp-current')) $('#cp-current').value = '';
        if ($('#cp-new')) $('#cp-new').value = '';
        if ($('#cp-confirm')) $('#cp-confirm').value = '';
        renderAccount();
        toast('Password updated.');
      }).catch((err) => showMsg(msg, (err && err.message) || 'Could not change password.', 'error'));
    });

    // user management
    const refreshUsersBtn = $('#refresh-users-btn');
    if (refreshUsersBtn) refreshUsersBtn.addEventListener('click', () => loadUsers());
    const refreshAuditBtn = $('#refresh-audit-btn');
    if (refreshAuditBtn) refreshAuditBtn.addEventListener('click', () => loadAudit());
    const refreshSessionsBtn = $('#refresh-sessions-btn');
    if (refreshSessionsBtn) refreshSessionsBtn.addEventListener('click', () => loadSessions());
    const revokeOthersBtn = $('#revoke-other-sessions-btn');
    if (revokeOthersBtn) revokeOthersBtn.addEventListener('click', () => {
      const api = window.ASBackend; const msg = $('#sessions-msg');
      if (!api) return;
      showMsg(msg, 'Signing out other sessions…', 'info');
      api.request('api/sessions/revoke-others', { method: 'POST', body: {} }).then((res) => {
        showMsg(msg, 'Signed out ' + ((res && res.revoked) || 0) + ' other session(s).', 'ok');
        loadSessions();
      }).catch((err) => showMsg(msg, (err && err.message) || 'Could not sign out other sessions.', 'error'));
    });
    const sessionsTbody = $('#sessions-table-body');
    if (sessionsTbody) sessionsTbody.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-session-revoke]') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-session-revoke');
      const api = window.ASBackend; const msg = $('#sessions-msg');
      if (!id || !api) return;
      showMsg(msg, 'Signing out session…', 'info');
      api.request('api/sessions/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => {
        showMsg(msg, 'Session signed out.', 'ok');
        loadSessions();
      }).catch((err) => showMsg(msg, (err && err.message) || 'Could not sign out session.', 'error'));
    });
    const createUserForm = $('#create-user-form');
    if (createUserForm) createUserForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!currentUser || currentUser.role !== 'super_admin') return;
      const api = window.ASBackend;
      const msg = $('#users-msg');
      const body = {
        name: ($('#nu-name') && $('#nu-name').value || '').trim(),
        email: ($('#nu-email') && $('#nu-email').value || '').trim().toLowerCase(),
        role: ($('#nu-role') && $('#nu-role').value) || 'advisor',
        password: ($('#nu-password') && $('#nu-password').value) || ''
      };
      showMsg(msg, 'Creating user…', 'info');
      api.request('api/users', { method: 'POST', body }).then((res) => {
        showMsg(msg, 'User created: ' + ((res && res.user && res.user.email) || body.email), 'ok');
        createUserForm.reset();
        loadUsers();
      }).catch((err) => showMsg(msg, (err && err.message) || 'Could not create user.', 'error'));
    });
    const usersTbody = $('#users-table-body');
    if (usersTbody) usersTbody.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-user-action]') : null;
      if (!btn || !currentUser || currentUser.role !== 'super_admin') return;
      const action = btn.getAttribute('data-user-action');
      const id = btn.getAttribute('data-id');
      const api = window.ASBackend;
      const msg = $('#users-msg');
      if (action === 'toggle') {
        const isActive = btn.getAttribute('data-active') === '1';
        showMsg(msg, (isActive ? 'Deactivating…' : 'Activating…'), 'info');
        api.request('api/users/' + encodeURIComponent(id), { method: 'PATCH', body: { active: !isActive } }).then(() => {
          showMsg(msg, isActive ? 'User deactivated.' : 'User activated.', 'ok');
          loadUsers();
        }).catch((err) => showMsg(msg, (err && err.message) || 'Could not update user.', 'error'));
      } else if (action === 'reset-token') {
        showMsg(msg, 'Generating reset link…', 'info');
        api.request('api/users/' + encodeURIComponent(id) + '/reset-token', { method: 'POST', body: {} }).then((res) => {
          const url = res && res.resetUrl ? (location.origin + res.resetUrl) : '';
          showMsg(msg, 'Reset link generated' + (url ? ': ' + url : '.') + (res && res.expiresAt ? ' (expires ' + new Date(res.expiresAt).toLocaleString() + ')' : ''), 'ok');
        }).catch((err) => showMsg(msg, (err && err.message) || 'Could not generate reset link.', 'error'));
      }
    });

    // nav
    $$('.sidebar-link[data-view]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    $$('[data-view-link]').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.viewLink)));

    // mobile sidebar
    $('#admin-burger').addEventListener('click', openSidebar);
    $('#sidebar-close').addEventListener('click', closeSidebar);
    $('#sidebar-scrim').addEventListener('click', closeSidebar);

    // add lead buttons
    $$('[data-add-lead]').forEach(b => b.addEventListener('click', () => leadModal()));
    const addCustomerBtn = $('#add-customer-btn');
    if (addCustomerBtn) addCustomerBtn.addEventListener('click', () => customerModal());
    const addDocumentBtn = $('#add-document-btn');
    if (addDocumentBtn) addDocumentBtn.addEventListener('click', () => documentModal());

    // lead filters
    $('#leads-search').addEventListener('input', debounce((e) => { filters.leadSearch = e.target.value; leadPage = 1; renderLeads(); }, 180));
    $('#leads-product-filter').addEventListener('change', (e) => { filters.leadProduct = e.target.value; leadPage = 1; renderLeads(); });
    $('#leads-status-filter').addEventListener('change', (e) => { filters.leadStatus = e.target.value; leadPage = 1; renderLeads(); });
    $('#leads-source-filter').addEventListener('change', (e) => { filters.leadSource = e.target.value; leadPage = 1; renderLeads(); });
    $('#clear-lead-filters').addEventListener('click', () => {
      filters.leadSearch = filters.leadProduct = filters.leadStatus = filters.leadSource = '';
      $('#leads-search').value = '';
      $('#leads-product-filter').value = '';
      $('#leads-status-filter').value = '';
      $('#leads-source-filter').value = '';
      leadPage = 1; renderLeads();
    });

    // apps
    $('#add-app-btn').addEventListener('click', () => appModal());
    $('#apps-search').addEventListener('input', debounce((e) => { filters.appSearch = e.target.value; appPage = 1; renderApplications(); }, 180));
    $('#apps-lender-filter').addEventListener('change', (e) => { filters.appLender = e.target.value; appPage = 1; renderApplications(); });
    $('#clear-app-filters').addEventListener('click', () => {
      filters.appSearch = filters.appLender = ''; filters.appStage = 'all';
      $('#apps-search').value = ''; $('#apps-lender-filter').value = '';
      $$('.stage-tab').forEach(t => t.classList.toggle('active', t.dataset.stage === 'all'));
      appPage = 1; renderApplications();
    });
    $$('#app-stage-tabs .stage-tab').forEach(tab => tab.addEventListener('click', () => {
      filters.appStage = tab.dataset.stage;
      $$('.stage-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      appPage = 1; renderApplications();
    }));

    // products / partners / content
    $('#add-product-btn').addEventListener('click', () => productModal());
    $('#add-partner-btn').addEventListener('click', () => partnerModal());
    $('#partner-filter').addEventListener('change', (e) => { filters.partnerType = e.target.value; renderPartners(); });
    $('#add-testimonial-btn').addEventListener('click', () => testimonialModal());
    $('#add-post-btn').addEventListener('click', () => postModal());
    const addGalleryBtn = $('#add-gallery-btn');
    if (addGalleryBtn) addGalleryBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        readImageFileAsDataUrl(file, 1600, 0.84).then((dataUrl) => {
          gallery.push({ id: uid('GAL-', 2), src: dataUrl, caption: 'New poster', alt: 'Poster' });
          try { save.gallery(); } catch (err) { gallery.pop(); toast('Image is too large to save in this browser. Try a smaller photo.', 'error'); renderGalleryAdmin(); return; }
          renderGalleryAdmin();
          toast('Poster added to the gallery.');
        }).catch(() => toast('Could not read that image. Please choose a different file.', 'error'));
      };
      input.click();
    });
    $('#reset-content-images-btn').addEventListener('click', () => {
      contentImages = {};
      save.contentImages();
      renderContentImages();
      toast('Homepage images reset to defaults.');
    });
    $('#add-task-btn').addEventListener('click', taskModal);

    const markAllNotifsBtn = $('#mark-all-notifs-read');
    if (markAllNotifsBtn) markAllNotifsBtn.addEventListener('click', () => {
      let changed = false;
      notifications.forEach(n => { if (n && !n.read) { n.read = true; changed = true; } });
      if (changed) { save.notifications(); renderAll(); toast('All notifications marked as read.'); }
      else toast('No unread notifications.');
    });
    const clearNotifsBtn = $('#clear-notifs-btn');
    if (clearNotifsBtn) clearNotifsBtn.addEventListener('click', () => {
      if (!notifications.length) { toast('No notifications to clear.'); return; }
      confirmDialog('Clear all notifications?', 'This will remove all in-app notifications.', () => {
        notifications = [];
        save.notifications();
        renderAll();
        toast('Notifications cleared.');
      });
    });

    // exports
    $('#export-leads-btn').addEventListener('click', exportLeads);
    $('#export-apps-btn').addEventListener('click', exportApps);
    $('#download-report-btn').addEventListener('click', exportSummary);
    $('#print-report-btn').addEventListener('click', exportSummary);

    // settings
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      ['businessName', 'tagline', 'phone', 'phoneRaw', 'email', 'address', 'hours', 'whatsapp'].forEach(k => {
        if (data.get(k) != null) settings[k] = String(data.get(k)).trim();
      });
      settings.notifications = {
        leads: $('#notif-leads').checked, apps: $('#notif-apps').checked,
        weekly: $('#notif-weekly').checked, whatsapp: $('#notif-whatsapp').checked
      };
      save.settings();
      toast('Settings saved. The public website will reflect these details.');
    });
    $('#settings-reset').addEventListener('click', renderSettings);
    ['notif-leads', 'notif-apps', 'notif-weekly', 'notif-whatsapp'].forEach(id => {
      $('#' + id).addEventListener('change', () => {
        settings.notifications = {
          leads: $('#notif-leads').checked, apps: $('#notif-apps').checked,
          weekly: $('#notif-weekly').checked, whatsapp: $('#notif-whatsapp').checked
        };
        save.settings();
      });
    });

    const resetDataBtn = $('#reset-data-btn');
    if (resetDataBtn) {
      resetDataBtn.addEventListener('click', () => {});
    }

    // global search
    $('#global-search').addEventListener('input', debounce((e) => {
      const v = e.target.value.trim();
      if (!v) return;
      filters.leadSearch = v;
      $('#leads-search').value = v;
      setView('leads');
    }, 300));

    // lead drawer
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#drawer-overlay').addEventListener('click', closeDrawer);

    // dropdowns
    $('#notif-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#notif-menu').classList.toggle('open'); $('#profile-menu').classList.remove('open'); });
    $('#profile-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#profile-menu').classList.toggle('open'); $('#notif-menu').classList.remove('open'); });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notif-menu') && !e.target.closest('#notif-btn')) $('#notif-menu').classList.remove('open');
      if (!e.target.closest('#profile-menu') && !e.target.closest('#profile-btn')) $('#profile-menu').classList.remove('open');
    });

    // task checkboxes
    document.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.matches('[data-task]')) {
        const t = tasks.find(x => x.id === cb.dataset.task);
        if (t) { t.done = cb.checked; save.tasks(); renderTasks(); renderOverview(); }
      }
      if (cb.dataset.toggle === 'product') {
        const p = products.find(x => x.id === cb.dataset.id);
        if (p) { p.visible = cb.checked; save.products(); toast(p.name + (p.visible ? ' shown' : ' hidden') + ' on the website.'); }
      }
      if (cb.dataset.toggle === 'testimonial') {
        const t = testimonials.find(x => x.id === cb.dataset.id);
        if (t) { t.published = cb.checked; save.testimonials(); renderContent(); toast('Testimonial ' + (t.published ? 'published' : 'hidden') + '.'); }
      }
      if (cb.dataset.toggle === 'post') {
        const p = posts.find(x => x.id === cb.dataset.id);
        if (p) { p.published = cb.checked; save.posts(); renderContent(); toast('Article ' + (p.published ? 'published' : 'moved to draft') + '.'); }
      }

      if (cb.matches('[data-upload-image]')) {
        const key = cb.dataset.uploadImage;
        const slot = CONTENT_IMAGE_SLOTS.find(s => s.key === key);
        const file = cb.files && cb.files[0];
        if (!slot || !file) return;
        readImageFileAsDataUrl(file, 1200, 0.82).then((dataUrl) => {
          contentImages[key] = dataUrl;
          try {
            save.contentImages();
          } catch (err) {
            delete contentImages[key];
            toast('Image is too large to save in this browser. Try a smaller photo.', 'error');
            renderContentImages();
            return;
          }
          renderContentImages();
          toast('Uploaded photo saved for ' + slot.label + '.');
        }).catch(() => {
          toast('Could not read that image. Please choose a different file.', 'error');
          cb.value = '';
        });
      }
      if (cb.matches('[data-gallery-upload]')) {
        const id = cb.dataset.galleryUpload;
        const item = gallery.find(g => g.id === id);
        const file = cb.files && cb.files[0];
        if (!item || !file) return;
        readImageFileAsDataUrl(file, 1600, 0.84).then((dataUrl) => {
          item.src = dataUrl;
          try { save.gallery(); } catch (err) { toast('Image is too large to save in this browser. Try a smaller photo.', 'error'); renderGalleryAdmin(); return; }
          renderGalleryAdmin();
          toast('Poster image updated.');
        }).catch(() => {
          toast('Could not read that image. Please choose a different file.', 'error');
          cb.value = '';
        });
      }
      if (cb.matches('[data-gallery-caption]')) {
        const id = cb.dataset.galleryCaption;
        const item = gallery.find(g => g.id === id);
        if (!item) return;
        const val = String(cb.value || '').trim() || 'Poster';
        item.caption = val;
        item.alt = val;
        try { save.gallery(); } catch (err) { return; }
      }
    });

    // delegated row actions
    document.addEventListener('click', (e) => {
      const imgBtn = e.target.closest('[data-image-action]');
      if (imgBtn) {
        const key = imgBtn.dataset.key;
        const slot = CONTENT_IMAGE_SLOTS.find(s => s.key === key);
        if (!slot) return;
        if (imgBtn.dataset.imageAction === 'icon') {
          if (slot.fallback === 'icon') delete contentImages[key]; else contentImages[key] = 'icon';
        }
        if (imgBtn.dataset.imageAction === 'default') {
          delete contentImages[key];
        }
        try { save.contentImages(); } catch (err) { toast('Could not save image selection.', 'error'); return; }
        renderContentImages();
        toast(imgBtn.dataset.imageAction === 'icon' ? 'Card set to icon only.' : 'Card restored to default.');
        return;
      }
      const galBtn = e.target.closest('[data-gallery-action]');
      if (galBtn) {
        const id = galBtn.dataset.id;
        const idx = gallery.findIndex(g => g.id === id);
        if (idx < 0) return;
        if (galBtn.dataset.galleryAction === 'delete') {
          confirmDialog('Remove this poster?', 'It will be removed from the homepage gallery in this browser.', () => {
            gallery.splice(idx, 1);
            save.gallery();
            renderGalleryAdmin();
            toast('Poster removed.');
          });
        }
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'view-lead') openDrawer(id);
      if (action === 'edit-lead') leadModal(id);
      if (action === 'delete-lead') {
        const l = leads.find(x => x.id === id);
        if (l) confirmDialog('Delete this lead?', l.name + ' will be removed from the pipeline permanently.', () => {
          const done = () => { leads = leads.filter(x => x.id !== id); save.leads(); renderAll(); toast('Lead deleted.'); };
          if (l._server && window.ASBackend && window.ASBackend.request) {
            window.ASBackend.request('api/enquiries/' + id, { method: 'DELETE' }).catch(() => {}).then(done);
          } else {
            done();
          }
        });
      }
      if (action === 'clear-filters') {
        filters.leadSearch = filters.leadProduct = filters.leadStatus = filters.leadSource = '';
        $('#leads-search').value = ''; $('#leads-product-filter').value = ''; $('#leads-status-filter').value = ''; $('#leads-source-filter').value = '';
        leadPage = 1; renderLeads();
      }
      if (action === 'edit-customer') customerModal(id);
      if (action === 'delete-customer') {
        const c = customers.find(x => x.id === id);
        if (c) confirmDialog('Delete this customer?', (c.name || 'This customer') + ' will be removed.', () => {
          customers = customers.filter(x => x.id !== id);
          save.customers();
          renderAll();
          toast('Customer deleted.');
        });
      }
      if (action === 'edit-document') documentModal(id);
      if (action === 'delete-document') {
        const d = documents.find(x => x.id === id);
        if (d) confirmDialog('Delete this document record?', (d.title || 'This document') + ' will be removed.', () => {
          documents = documents.filter(x => x.id !== id);
          save.documents();
          renderAll();
          toast('Document deleted.');
        });
      }
      if (action === 'toggle-notification') {
        const n = notifications.find(x => x.id === id);
        if (n) { n.read = !n.read; save.notifications(); renderAll(); }
      }
      if (action === 'delete-notification') {
        notifications = notifications.filter(x => x.id !== id);
        save.notifications();
        renderAll();
      }
      if (action === 'advance-app') advanceApp(id);
      if (action === 'edit-app') appModal(id);
      if (action === 'delete-app') {
        const a = apps.find(x => x.id === id);
        if (a) confirmDialog('Delete this application?', 'The file for ' + a.customer + ' will be permanently removed.', () => {
          apps = apps.filter(x => x.id !== id); save.apps(); renderAll(); toast('Application deleted.');
        });
      }
      if (action === 'edit-product') productModal(id);
      if (action === 'delete-product') {
        const p = products.find(x => x.id === id);
        if (p) confirmDialog('Delete this product?', p.name + ' will be removed from the catalogue.', () => {
          products = products.filter(x => x.id !== id); save.products(); renderAll(); toast('Product deleted.');
        });
      }
      if (action === 'edit-partner') partnerModal(id);
      if (action === 'delete-partner') {
        const p = partners.find(x => x.id === id);
        if (p) confirmDialog('Remove this partner?', p.name + ' will be removed from your lender panel.', () => {
          partners = partners.filter(x => x.id !== id); save.partners(); renderAll(); toast('Partner removed.');
        });
      }
      if (action === 'edit-testimonial') testimonialModal(id);
      if (action === 'delete-testimonial') {
        confirmDialog('Delete this testimonial?', 'The review will be permanently removed.', () => {
          testimonials = testimonials.filter(x => x.id !== id); save.testimonials(); renderAll(); toast('Testimonial deleted.');
        });
      }
      if (action === 'edit-post') postModal(id);
      if (action === 'delete-post') {
        confirmDialog('Delete this article?', 'The article will be permanently removed.', () => {
          posts = posts.filter(x => x.id !== id); save.posts(); renderAll(); toast('Article deleted.');
        });
      }
    });

    // modal close
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-overlay').addEventListener('click', (e) => { if (e.target === $('#modal-overlay')) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        closeDrawer();
        $('#notif-menu').classList.remove('open');
        $('#profile-menu').classList.remove('open');
        closeSidebar();
      }
    });

    // hash routing
    window.addEventListener('hashchange', () => {
      const v = location.hash.replace('#', '');
      if (VIEW_TITLES[v] && v !== currentView) setView(v, true);
    });

    // resize charts
    window.addEventListener('resize', debounce(() => {
      renderTasks();
      redrawCharts();
    }, 200));

    window.addEventListener('load', redrawCharts);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redrawCharts());

    // live sync with the public website (other tabs)
    window.addEventListener('storage', (e) => {
      if (!e.key || e.key.indexOf('as_') !== 0) return;
      loadData();
      populateFilters();
      renderAll();
      toast('Dashboard refreshed with website changes.');
    });
  }

  /* ---------------------------------------------------------------- init */
  function init() {
    clearSampleDataOnce();
    loadData();
    bindEvents();
    $('#login-year').textContent = new Date().getFullYear();
    try {
      pendingResetToken = (new URLSearchParams(location.search).get('reset') || '').trim();
    } catch (e) { pendingResetToken = ''; }
    showLogin();

    const api = window.ASBackend;
    if (!api) return;

    api.available().then((ok) => {
      if (!ok) return; // backend unavailable: stay on login screen
      return api.session().then((user) => {
        if (user && user.email) {
          if (!isAllowedAdminRole(user)) {
            denyAccess('Administrator access only.');
            return;
          }
          enterApp(user, false);
          const hash = location.hash.replace('#', '');
          if (VIEW_TITLES[hash]) setView(hash, true);
        }
      }).catch(() => {
        // No active session: stay on login screen.
      });
    }).catch(() => {});
  }

  init();
})();
