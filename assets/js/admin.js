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
  const STATUSES = ['New', 'Contacted', 'Accepted', 'Declined'];

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
        ['as_leads', 'as_applications', 'as_products', 'as_partners', 'as_testimonials', 'as_posts', 'as_tasks', 'as_gallery', 'as_content_images', 'as_customers', 'as_notifications'].forEach((key) => {
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
  let leads = [], applications = [], products = [], partners = [], testimonials = [], posts = [], contentImages = {}, gallery = [], tasks = [], customers = [], notifications = [], settings = {};
  let analyticsData = null;
  let apps = applications; // backward compat alias
  let leadPage = 1;
  const PAGE_SIZE = 8;
  const filters = { leadSearch: '', leadProduct: '', leadStatus: '', partnerType: '' };
  let currentView = 'overview';
  let activeLeadId = null;
  let charts = {};
  let currentUser = null;
  let pendingResetToken = '';

  function loadData() {
    leads = store.get('as_leads', []);
    products = store.get('as_products', []);
    partners = store.get('as_partners', []);
    testimonials = store.get('as_testimonials', []);
    posts = store.get('as_posts', []);
    contentImages = store.get('as_content_images', {}) || {};
    gallery = store.get('as_gallery', []);
    if (!Array.isArray(gallery)) gallery = [];
    tasks = store.get('as_tasks', []);
    customers = store.get('as_customers', []);
    notifications = store.get('as_notifications', []);
    applications = store.get('as_applications', []);
    settings = Object.assign({}, DEFAULT_SETTINGS, store.get('as_settings', {}));
    settings.notifications = Object.assign({}, DEFAULT_SETTINGS.notifications, settings.notifications || {});
    if (!Array.isArray(leads)) leads = [];
    if (!Array.isArray(customers)) customers = [];
    if (!Array.isArray(notifications)) notifications = [];
    if (!Array.isArray(applications)) applications = [];
    apps = applications;
  }

  const save = {
    leads: () => store.set('as_leads', leads.filter(l => !l._server)),
    products: () => store.set('as_products', products),
    partners: () => store.set('as_partners', partners),
    testimonials: () => store.set('as_testimonials', testimonials),
    posts: () => store.set('as_posts', posts),
    contentImages: () => store.set('as_content_images', contentImages),
    gallery: () => store.set('as_gallery', gallery),
    tasks: () => store.set('as_tasks', tasks),
    customers: () => store.set('as_customers', customers),
    notifications: () => store.set('as_notifications', notifications),
    applications: () => store.set('as_applications', applications),
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
      status: (['New','Contacted','Accepted','Qualified','Documents','Sanctioned','Disbursed','Declined','Lost'].indexOf(e.status) !== -1) ? e.status : (e.handled ? 'Contacted' : 'New'),
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

  function drawLineChart(canvas, labels, seriesA, seriesB, seriesC) {
    const c = setupCanvas(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const pad = { l: 38, r: 18, t: 18, b: 28 };
    const all = [seriesA || [], seriesB || [], seriesC || []].filter(Array.isArray);
    const max = Math.max(10, ...all.reduce((a, arr) => a.concat(arr.map(v => Number(v) || 0)), [])) * 1.22;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const x = (i) => pad.l + (iw / (labels.length - 1 || 1)) * i;
    const y = (v) => pad.t + ih - ((Number(v) || 0) / max) * ih;

    // soft plot background
    const bg = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    bg.addColorStop(0, 'rgba(16,41,75,.035)');
    bg.addColorStop(1, 'rgba(16,41,75,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(pad.l, pad.t, iw, ih);

    ctx.font = '10px Manrope, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (ih / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.strokeStyle = i === 4 ? '#dfe5ec' : '#eef1f5';
      ctx.lineWidth = 1;
      ctx.setLineDash(i === 4 ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#94a0ad';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(max - (max / 4) * i), pad.l - 8, yy);
    }
    // vertical guides
    labels.forEach((_, i) => {
      ctx.beginPath();
      ctx.moveTo(x(i), pad.t);
      ctx.lineTo(x(i), pad.t + ih);
      ctx.strokeStyle = 'rgba(16,41,75,.045)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    const series = [
      { data: seriesA || [], color: '#10294B', rgb: '16,41,75', fill: .20 },
      { data: seriesB || [], color: '#D6A329', rgb: '214,163,41', fill: .14 },
      { data: seriesC || [], color: '#2B8C89', rgb: '43,140,137', fill: .10 }
    ].filter(s => s.data.length);

    const path = (data) => {
      ctx.beginPath();
      data.forEach((v, i) => {
        if (i === 0) { ctx.moveTo(x(0), y(v)); return; }
        const px = x(i - 1), cx = (px + x(i)) / 2;
        ctx.bezierCurveTo(cx, y(data[i - 1]), cx, y(v), x(i), y(v));
      });
    };

    series.forEach((s) => {
      // area
      const g = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
      g.addColorStop(0, 'rgba(' + s.rgb + ',' + s.fill + ')');
      g.addColorStop(1, 'rgba(' + s.rgb + ',0)');
      path(s.data);
      ctx.lineTo(x(s.data.length - 1), pad.t + ih);
      ctx.lineTo(x(0), pad.t + ih);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    });

    series.forEach((s) => {
      ctx.save();
      ctx.shadowColor = 'rgba(' + s.rgb + ',.35)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 3;
      path(s.data);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();

      s.data.forEach((v, i) => {
        const last = i === s.data.length - 1;
        ctx.beginPath();
        ctx.arc(x(i), y(v), last ? 4.5 : 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.lineWidth = last ? 2.6 : 2;
        ctx.strokeStyle = s.color;
        ctx.stroke();
        if (last) {
          ctx.beginPath();
          ctx.arc(x(i), y(v), 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(' + s.rgb + ',.25)';
          ctx.lineWidth = 2;
          ctx.stroke();
          const val = Math.round(Number(v) || 0);
          ctx.font = '700 10px Manrope, sans-serif';
          ctx.fillStyle = s.color;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText(val, Math.min(x(i) + 8, w - pad.r), Math.max(y(v) - 10, pad.t + 10));
          ctx.font = '10px Manrope, sans-serif';
        }
      });
    });

    ctx.fillStyle = '#94a0ad';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labels.forEach((l, i) => {
      ctx.font = (i === labels.length - 1 ? '700 10px' : '10px') + ' Manrope, sans-serif';
      ctx.fillStyle = i === labels.length - 1 ? '#10294B' : '#94a0ad';
      ctx.fillText(l, x(i), pad.t + ih + 9);
    });
  }

  function drawBarChart(canvas, labels, values, color) {
    const c = setupCanvas(canvas);
    if (!c) return;
    const { ctx, w, h } = c;
    const pad = { l: 38, r: 14, t: 22, b: 30 };
    const max = Math.max(...values, 10) * 1.2;
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const palette = ['#10294B', '#D6A329', '#2B8C89', '#6C5CE7', '#E17055', '#0984E3', '#00B894', '#F39C12'];

    ctx.font = '10px Manrope, sans-serif';
    for (let i = 0; i <= 4; i++) {
      const yy = pad.t + (ih / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.l, yy);
      ctx.lineTo(w - pad.r, yy);
      ctx.strokeStyle = i === 4 ? '#dfe5ec' : '#eef1f5';
      ctx.setLineDash(i === 4 ? [] : [4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#94a0ad';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(max - (max / 4) * i), pad.l - 8, yy);
    }

    const slot = iw / values.length;
    const bw = Math.min(38, slot * 0.56);
    values.forEach((v, i) => {
      const bh = Math.max(2, (v / max) * ih);
      const bx = pad.l + slot * i + (slot - bw) / 2;
      const by = pad.t + ih - bh;
      const base = color || palette[i % palette.length];
      const g = ctx.createLinearGradient(0, by, 0, by + bh);
      g.addColorStop(0, base);
      g.addColorStop(1, hexToRgba(base, .35));
      ctx.save();
      ctx.shadowColor = hexToRgba(base, .30);
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = g;
      const r = Math.min(7, bw / 2);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, [r, r, 0, 0]);
      else ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#69788a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '10px Manrope, sans-serif';
      ctx.fillText(labels[i], bx + bw / 2, pad.t + ih + 10);
      ctx.fillStyle = base;
      ctx.font = '700 10px Manrope, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(Math.round(v), bx + bw / 2, by - 4);
      ctx.font = '10px Manrope, sans-serif';
    });
  }

  function hexToRgba(hex, alpha) {
    const s = String(hex || '#10294B').replace('#', '');
    const full = s.length === 3 ? s.split('').map(ch => ch + ch).join('') : s;
    const n = parseInt(full, 16);
    if (!Number.isFinite(n)) return 'rgba(16,41,75,' + alpha + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  function drawDonut(canvas, data, centerLabel) {
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
    ctx.fillText(String(centerLabel || 'TOTAL').toUpperCase(), cx, cy + 13);
  }

  const MIX_COLORS = ['#0d2b4e', '#c9a227', '#2b6cb0', '#137a5b', '#6b4fa0', '#b2651c'];
  const SOURCE_COLORS = ['#0d2b4e', '#c9a227', '#2b6cb0', '#137a5b', '#6b4fa0', '#b3423a'];

  function redrawCharts() {
    if (currentView === 'overview') {
      const trend = leadTrend(8);
      if (charts.leads) drawLineChart(charts.leads, trend.labels, trend.leads, trend.sanctions);
      if (charts.mix) renderMixChart();
    }
    if (currentView === 'reports') {
      drawBarChart(charts.disb, monthLabels(6), monthlyDisbursements(), '#c9a227');
      renderSourceChart();
    }
    if (currentView === 'analytics' && analyticsData) {
      const d = analyticsData || {};
      const s = d.summary || {};
      analyticsDonut('#anly-sources-chart', '#anly-sources-legend', d.trafficSources, 'source', 'count', 'Views');
      analyticsDonut('#anly-devices-chart', '#anly-devices-legend', d.devices, 'device', 'count', 'Views');
      analyticsBars('#anly-landings-chart', d.topLandingPages, 'page', 'entries');
      analyticsBars('#anly-utms-chart', d.utmCampaigns, 'campaign', 'count');
      const engCanvas = $('#anly-engagement-chart');
      if (engCanvas && typeof drawBarChart === 'function') {
        drawBarChart(engCanvas, ['CTA', 'Phone', 'WhatsApp', 'Email'], [Number(s.ctaClicks||0), Number(s.phoneClicks||0), Number(s.whatsappClicks||0), Number(s.emailClicks||0)]);
      }
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
    const r = role === 'super_admin' ? 'admin' : (role === 'advisor' ? 'staff' : role);
    const map = { admin: 'Admin', staff: 'Staff' };
    return map[r] || 'Staff';
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
    const un = $('#users-access-note'); if (un) un.style.display = isAdmin ? 'none' : '';
  }

  function isAllowedAdminRole(user) {
    return !!(user && (user.role === 'admin' || user.role === 'super_admin' || user.role === 'staff'));
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
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) { loadUsers(); }
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
      const self = currentUser && String(currentUser.id || '') === String(u.id);
      const actions = canManage
        ? '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<button class="a-btn a-btn-light a-btn-sm" data-user-action="reset-token" data-id="' + esc(u.id) + '">Reset link</button>' +
            (self ? '<span style="color:var(--muted);font-size:.72rem;align-self:center">You</span>' : '<button class="a-btn a-btn-ghost a-btn-sm danger" data-user-action="delete" data-id="' + esc(u.id) + '">Delete</button>') +
          '</div>'
        : '<span style="color:var(--muted);font-size:.75rem">View only</span>';
      return '<tr><td>' + esc(u.name || '—') + '</td><td>' + esc(u.email || '') + '</td><td>' + esc(roleLabel(u.role)) + '</td><td>' + status + '</td><td>' + actions + '</td></tr>';
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
    overview: 'Overview', analytics: 'Website Analytics', funnel: 'Enquiry Funnel', recovery: 'Lead Recovery Centre',
    leads: 'Enquiries', customers: 'Customers', applications: 'Loan Applications',
    followups: 'Follow-ups & Reminders', notifications: 'Notifications', marketing: 'Marketing & Campaigns',
    growth: 'Business Growth', partners: 'Bank partners', reports: 'Reports',
    health: 'Website Health', audit: 'Admin Activity & Security', content: 'Reviews & Products',
    products: 'Loan products', settings: 'Settings'
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
    else if (view === 'customers') renderCustomers();
    else if (view === 'applications') renderApplications();
    else if (view === 'notifications') renderNotifications();
    else if (view === 'reports') renderReports();
    else if (view === 'products') renderProducts();
    else if (view === 'partners') renderPartners();
    else if (view === 'content') renderContent();
    else if (view === 'settings') renderSettings();
    else if (view === 'analytics') renderAnalytics();
    else if (view === 'funnel') renderFunnel();
    else if (view === 'marketing') renderMarketing();
    else if (view === 'growth') renderGrowth();
    else if (view === 'recovery') renderRecovery();
    else if (view === 'followups') renderFollowups();
    else if (view === 'health') renderHealth();
    else if (view === 'audit') renderAudit();
    syncChartRefs();
    requestAnimationFrame(() => requestAnimationFrame(redrawCharts));
  }

  function syncSlaNotifications() {
    const now = Date.now();
    const dismissed = (() => { try { return new Set(JSON.parse(localStorage.getItem('as_sla_dismissed')||'[]')); } catch(e){ return new Set(); }})();
    const existing = new Set((notifications||[]).map(n => String(n && n.id || '')));
    let changed = false;
    (leads||[]).forEach(lead => {
      if (!lead || !lead.id) return;
      const status = String(lead.status || 'New');
      if (!['New','Contacted'].includes(status)) return;
      const created = new Date(lead.createdAt || lead.receivedAt || 0).getTime();
      if (!created) return;
      const ageHrs = (now - created) / 36e5;
      const followUpDue = lead.followUpDate ? (new Date(lead.followUpDate + 'T23:59:59').getTime() < now) : false;
      const rules = [];
      if (status === 'New' && ageHrs >= 24) rules.push({ rule:'new-24h', title:'SLA reminder: New lead not contacted', message:[lead.name,lead.phone,lead.product].filter(Boolean).join(' • ').slice(0,220)+' has been waiting over 24 hours.' });
      if (status === 'Contacted' && ageHrs >= 72) rules.push({ rule:'contacted-72h', title:'SLA reminder: Follow-up needed', message:[lead.name,lead.phone,lead.product].filter(Boolean).join(' • ').slice(0,220)+' needs follow-up (72+ hours).' });
      if (followUpDue) rules.push({ rule:'followup-due', title:'Follow-up due', message:[lead.name,lead.phone,lead.product].filter(Boolean).join(' • ').slice(0,220)+' has a past-due follow-up date ('+lead.followUpDate+').' });
      rules.forEach(r => {
        const id = 'NTF-SLA-' + r.rule + '-' + String(lead.id);
        if (existing.has(id) || dismissed.has(id)) return;
        notifications.unshift({ id, type:'lead.sla', title: r.title, message: r.message, targetType:'lead', targetId:String(lead.id), read:false, createdAt:new Date().toISOString(), meta:{ rule:r.rule, leadStatus:status } });
        existing.add(id);
        changed = true;
      });
    });
    if (changed) { if (notifications.length > 500) notifications.length = 500; save.notifications(); }
  }

  function renderAll() {
    syncSlaNotifications();
    updateCounts();
    renderView(currentView);
    populateFilters();
    renderNotifications();
  }

  function updateCounts() {
    const open = leads.filter(l => !['Sanctioned', 'Disbursed', 'Lost'].includes(l.status)).length;
    const el = $('#nav-lead-count');
    if (el) el.textContent = open;
    const unread = Array.isArray(notifications) ? notifications.filter(n => n && !n.read).length : 0;
    const nel = $('#nav-notif-count');
    if (nel) { nel.textContent = unread; nel.style.display = unread ? '' : 'none'; }
    const dot = document.querySelector('#notif-btn .notif-dot');
    if (dot) dot.style.display = unread ? '' : 'none';
    const menuCount = $('#notif-menu-count');
    if (menuCount) menuCount.textContent = unread ? (unread + ' unread') : 'No new alerts';
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
  function renderOverviewLeads() {
    const setText = (id, val) => { const el = $('#' + id); if (el) el.textContent = val; };
    const badge = (status) => {
      const s2 = String(status || 'New');
      const cls = ({ New: 'b-blue', Contacted: 'b-amber', Accepted: 'b-green', Declined: 'b-red' })[s2] || 'b-gray';
      return '<span class="badge ' + cls + '">' + esc(s2) + '</span>';
    };
    const openStatuses = ['New', 'Contacted'];
    const openLeads = leads.filter(l => openStatuses.includes(l.status)).length;
    const acceptedLeads = leads.filter(l => l.status === 'Accepted').length;
    const declinedLeads = leads.filter(l => l.status === 'Declined').length;
    const newLeads = leads.filter(l => l.status === 'New').length;
    const pipelineValue = leads.reduce((sum, l) => sum + (typeof amountToNumber === 'function' ? amountToNumber(l.amount) : 0), 0);
    setText('ov-open-leads', openLeads);
    setText('ov-accepted-leads', acceptedLeads);
    setText('ov-pipeline-value', typeof compact === 'function' ? compact(pipelineValue) : String(pipelineValue));

    const pipelineHost = $('#ov-lead-pipeline');
    if (pipelineHost) {
      const total = Math.max(leads.length, 1);
      const rows = [
        { label: 'New', count: newLeads, color: '#2b6cb0' },
        { label: 'Contacted', count: leads.filter(l => l.status === 'Contacted').length, color: '#c9a227' },
        { label: 'Accepted', count: acceptedLeads, color: '#137a5b' },
        { label: 'Declined', count: declinedLeads, color: '#b3423a' }
      ];
      pipelineHost.innerHTML = leads.length ? rows.map(r =>
        '<div class="pipeline-row"><div class="p-top"><span>' + esc(r.label) + '</span><b>' + r.count + '</b></div><div class="pipeline-track"><span style="width:' + Math.round((r.count / total) * 100) + '%;background:' + r.color + '"></span></div></div>'
      ).join('') : '<div class="empty-state" style="padding:18px"><p>No enquiry data yet.</p><button type="button" class="a-btn a-btn-light a-btn-sm" data-view-link="leads">Go to enquiries</button></div>';
    }

    const urgentHost = $('#ov-urgent-list');
    if (urgentHost) {
      const now = Date.now();
      const urgent = [];
      leads.forEach(l => {
        const ageHrs = (now - new Date(l.createdAt || 0).getTime()) / 36e5;
        if (l.status === 'New') urgent.push({ level: ageHrs > 24 ? 'high' : 'medium', title: 'New enquiry needs contact', detail: (l.name || 'Unknown') + ' · ' + (l.product || 'Enquiry'), time: l.createdAt, id: l.id });
        else if (l.status === 'Contacted' && ageHrs > 72) urgent.push({ level: 'medium', title: 'Follow-up overdue', detail: (l.name || 'Unknown') + ' · contacted ' + Math.floor(ageHrs/24) + 'd ago', time: l.createdAt, id: l.id });
      });
      urgent.sort((a,b)=> (a.level==='high'?0:1)-(b.level==='high'?0:1) || new Date(b.time)-new Date(a.time));
      const top = urgent.slice(0,6);
      urgentHost.innerHTML = top.length ? top.map(u =>
        '<div class="alert-item ' + (u.level==='high'?'alert-high':'alert-medium') + '" style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--line-soft)">' +
        '<span style="width:10px;height:10px;border-radius:50%;margin-top:6px;flex:none;background:' + (u.level==='high'?'#b3423a':'#c9a227') + '"></span>' +
        '<div style="flex:1;min-width:0"><b style="display:block;font-size:.875rem;color:var(--navy)">' + esc(u.title) + '</b><div style="font-size:.8125rem;color:var(--muted)">' + esc(u.detail) + '</div></div>' +
        '<span style="font-size:.75rem;color:var(--muted);white-space:nowrap">' + esc(timeAgo(u.time)) + '</span></div>'
      ).join('') : '<div class="empty-state" style="padding:18px"><p>No urgent reminders right now.</p></div>';
    }
  }

  async function renderOverview() {
    const api = window.ASBackend;
    const setText = (id, val) => { const el = $('#' + id); if (el) el.textContent = val; };
    renderOverviewLeads();
    if (!api) return;
    try {
      const data = await api.request('api/admin/analytics');
      analyticsData = data;
      const s = (data && data.summary) || {};
      const views = Number(s.totalPageViews || 0);
      const visitors = Number(s.uniqueVisitors || 0);
      const starts = Number(s.formStarts || 0);
      const submits = Number(s.formSubmits || 0);
      const startedNotSubmitted = Math.max(0, starts - submits);
      setText('an-total-views', views);
      setText('an-views-7d', Number(s.last7PageViews || 0));
      setText('an-unique-visitors', visitors);
      setText('an-visitors-7d', Number(s.last7UniqueVisitors || 0));
      setText('an-form-starts', starts);
      setText('ov-form-starts', starts);
      setText('ov-form-starts-7d', Number(s.last7FormStarts || 0));
      setText('an-form-submits', submits);
      setText('an-started-not-submitted', startedNotSubmitted);
      setText('an-form-success', Number(s.formSubmitSuccess || 0));
      const rate = starts > 0 ? Math.round((submits / starts) * 100) : 0;
      setText('ov-conversion-rate', rate + '%');

      const daily = Array.isArray(data.daily) ? data.daily : [];
      const labels = daily.map(d => { try { return new Date(d.date).toLocaleDateString('en-IN', { day:'2-digit', month:'short' }); } catch(e){ return String(d.date||''); } });
      const viewSeries = daily.map(d => Number(d.pageViews || 0));
      const startSeries = daily.map(d => Number(d.formStarts || 0));
      const submitSeries = daily.map(d => Number(d.formSubmits || 0));
      const trendCanvas = $('#ov-trend-chart');
      if (trendCanvas && typeof drawLineChart === 'function') drawLineChart(trendCanvas, labels.length ? labels : ['-'], viewSeries.length ? viewSeries : [0], startSeries.length ? startSeries : [0], submitSeries.length ? submitSeries : [0]);

      const funnelCanvas = $('#ov-funnel-chart');
      if (funnelCanvas && typeof drawBarChart === 'function') {
        const fLabels = ['Page views', 'Form starts', 'Submitted', 'Not submitted'];
        const fValues = [views, starts, submits, startedNotSubmitted];
        drawBarChart(funnelCanvas, fLabels, fValues, '#0d2b4e');
      }
      const funnelNote = $('#ov-funnel-note');
      if (funnelNote) {
        funnelNote.textContent = starts > 0
          ? ('Conversion: ' + rate + '% from form start to submit. ' + startedNotSubmitted + ' enquiry form(s) started but not submitted.')
          : 'No funnel data yet.';
      }

      const top = Array.isArray(data.topPages) ? data.topPages : [];
      const maxViews = Math.max(...top.map(p => Number(p.views || 0)), 1);
      const topHost = $('#an-top-pages');
      if (topHost) topHost.innerHTML = top.length ? top.map(p =>
        '<div class="pipeline-row"><div class="p-top"><span>' + esc(p.page || '/') + '</span><b>' + Number(p.views || 0) + ' views</b></div><div class="pipeline-track"><span style="width:' + Math.round((Number(p.views || 0) / maxViews) * 100) + '%"></span></div></div>'
      ).join('') : '<div class="empty-state" style="padding:18px"><p>No page view data yet.</p></div>';

      const recent = Array.isArray(data.recent) ? data.recent : [];
      const recentBody = $('#an-recent-body');
      if (recentBody) recentBody.innerHTML = recent.length ? recent.map(e => {
        const eventLabel = String(e.type || '').replace(/_/g, ' ');
        const rawVisitor = String(e.visitorId || '').trim();
        const visitor = rawVisitor ? 'Visitor ' + esc(rawVisitor.slice(-6).toUpperCase()) : 'Unknown visitor';
        const page = esc(e.page || '/');
        const badgeCls = eventLabel.includes('page view') ? 'b-blue' : eventLabel.includes('success') ? 'b-green' : eventLabel.includes('fail') ? 'b-red' : 'b-amber';
        return '<tr><td title="' + esc(fmtDate(e.at)) + '">' + esc(timeAgo(e.at)) + '</td><td title="' + esc(rawVisitor || 'Unknown') + '">' + visitor + '</td><td><b style="color:var(--navy)">' + page + '</b></td><td><span class="badge ' + badgeCls + '">' + esc(eventLabel) + '</span></td></tr>';
      }).join('') : '<tr><td colspan="4" class="table-empty">No website activity yet.</td></tr>';

      setText('ov-cta-clicks', Number(s.ctaClicks || 0));
      setText('ov-cta-clicks-7d', Number(s.last7CtaClicks || 0));
      const contactClicks = Number(s.phoneClicks || 0) + Number(s.whatsappClicks || 0);
      const last7Contact = Number(s.last7PhoneClicks || 0) + Number(s.last7WhatsappClicks || 0);
      setText('ov-contact-clicks', contactClicks);
      setText('ov-contact-clicks-7d', last7Contact);
    } catch (e) {
      const funnelNote = $('#ov-funnel-note');
      if (funnelNote) funnelNote.textContent = 'Could not load analytics.';
    }
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

  async function renderFunnel() {
    const api = window.ASBackend; if (!api) return;
    if (!analyticsData) { try { analyticsData = await api.request('api/admin/analytics'); } catch(e) {} }
    const s = (analyticsData && analyticsData.summary) || {};
    const views = Number(s.totalPageViews||0), starts = Number(s.formStarts||0), submits = Number(s.formSubmits||0);
    const sns = Math.max(0, starts - submits);
    const abandon = Number(s.last7FormAbandon||0);
    const items = [{label:'Page views', value:views},{label:'Form starts', value:starts},{label:'Submits', value:submits},{label:'Started not submitted', value:sns}];
    const max = Math.max(...items.map(i=>i.value),1);
    const host = $('#funnel-bars');
    if (host) host.innerHTML = items.map(i=>'<div class="pipeline-row"><div class="p-top"><span>'+esc(i.label)+'</span><b>'+i.value+'</b></div><div class="pipeline-track"><span style="width:'+Math.round((i.value/max)*100)+'%"></span></div></div>').join('');
    const set=(id,v)=>{ const el=$('#'+id); if(el) el.textContent=v; };
    set('fu-starts', starts); set('fu-submits', submits); set('fu-sns', sns); set('fu-abandon', abandon);
    const note = $('#funnel-note');
    if (note) note.textContent = starts > 0 ? ('Conversion: '+(submits>0?((submits/starts)*100).toFixed(1):'0.0')+'% from form start to submit. '+sns+' started but not submitted. '+abandon+' abandon event(s) in last 7 days.') : 'No funnel data yet.';
  }

  async function renderMarketing() {
    const api = window.ASBackend; if (!api) return;
    if (!analyticsData) { try { analyticsData = await api.request('api/admin/analytics'); } catch(e) {} }
    const d = analyticsData || {};
    const list = (id, arr, k, v, empty) => { const el=$('#'+id); if(!el) return; const max=Math.max(...arr.map(x=>Number(x[v]||0)),1); el.innerHTML = arr.length ? arr.map(x=>'<div class="pipeline-row"><div class="p-top"><span>'+esc(String(x[k]||'-'))+'</span><b>'+Number(x[v]||0)+'</b></div><div class="pipeline-track"><span style="width:'+Math.round((Number(x[v]||0)/max)*100)+'%"></span></div></div>').join('') : '<div class="empty-state" style="padding:18px"><p>'+esc(empty)+'</p></div>'; };
    list('mk-campaigns', Array.isArray(d.utmCampaigns)?d.utmCampaigns:[], 'campaign', 'count', 'No campaign data yet.');
    list('mk-sources', Array.isArray(d.trafficSources)?d.trafficSources:[], 'source', 'count', 'No source data yet.');
    list('mk-referrers', Array.isArray(d.topReferrers)?d.topReferrers:[], 'referrer', 'count', 'No referrer data yet.');
  }

  async function renderGrowth() {
    const api = window.ASBackend; if (api && !analyticsData) { try { analyticsData = await api.request('api/admin/analytics'); } catch(e) {} }
    const s = (analyticsData && analyticsData.summary) || {};
    const total = leads.length;
    const accepted = leads.filter(l=>l.status==='Accepted').length;
    const set=(id,v)=>{ const el=$('#'+id); if(el) el.textContent=v; };
    set('gr-total', total);
    set('gr-accepted', accepted);
    set('gr-conv', (total?((accepted/total)*100).toFixed(1):'0.0')+'%');
    set('gr-pv7', Number(s.last7PageViews||0));
    const byMonth = {};
    leads.forEach(l=>{ const k=String(l.createdAt||'').slice(0,7); if(!k) return; byMonth[k]=(byMonth[k]||0)+1; });
    const rows = Object.entries(byMonth).sort((a,b)=>a[0].localeCompare(b[0])).slice(-8).map(([month,count])=>({month,count}));
    const max=Math.max(...rows.map(r=>r.count),1);
    const host=$('#gr-monthly');
    if (host) host.innerHTML = rows.length ? rows.map(r=>'<div class="pipeline-row"><div class="p-top"><span>'+esc(r.month)+'</span><b>'+r.count+'</b></div><div class="pipeline-track"><span style="width:'+Math.round((r.count/max)*100)+'%"></span></div></div>').join('') : '<div class="empty-state" style="padding:18px"><p>No lead data yet.</p></div>';
  }

  function analyticsPalette() { return ['#10294B', '#D6A329', '#2B8C89', '#6C5CE7', '#E17055', '#0984E3', '#00B894', '#F39C12']; }

  function analyticsDonut(canvasId, legendId, rows, labelKey, valueKey, centerLabel) {
    const canvas = $(canvasId); if (!canvas) return;
    const palette = analyticsPalette();
    const list = Array.isArray(rows) ? rows : [];
    const data = list.map((row, i) => ({ label: String(row[labelKey] || '-'), value: Number(row[valueKey] || 0), color: palette[i % palette.length] })).filter(d => d.value > 0).slice(0, 6);
    drawDonut(canvas, data, centerLabel);
    const legend = $(legendId);
    if (legend) {
      const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
      legend.innerHTML = data.length ? data.map(d => '<div class="donut-legend-item"><i style="background:' + d.color + '"></i><span>' + esc(d.label) + '</span><b>' + Math.round(d.value / total * 100) + '%</b></div>').join('') : '<div class="empty-state" style="padding:4px"><p>No data yet.</p></div>';
    }
  }

  function analyticsBars(canvasId, rows, labelKey, valueKey) {
    const canvas = $(canvasId); if (!canvas || typeof drawBarChart !== 'function') return;
    const list = Array.isArray(rows) ? rows : [];
    const labels = list.map(r => { const t = String(r[labelKey] || '-'); return t.length > 11 ? t.slice(0, 10) + '…' : t; });
    const values = list.map(r => Number(r[valueKey] || 0));
    drawBarChart(canvas, labels.length ? labels : ['—'], values.length ? values : [0]);
  }

  async function renderAnalytics() {
    const api = window.ASBackend; if (!api) return;
    if (!analyticsData) { try { analyticsData = await api.request('api/admin/analytics'); } catch(e) {} }
    const d = analyticsData || {};
    const s = d.summary || {};
    const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };

    const engagement = Number(s.ctaClicks||0) + Number(s.phoneClicks||0) + Number(s.whatsappClicks||0) + Number(s.emailClicks||0);
    const engagement7 = Number(s.last7CtaClicks||0) + Number(s.last7PhoneClicks||0) + Number(s.last7WhatsappClicks||0);
    set('anly-views', Number(s.totalPageViews||0));
    set('anly-views7', Number(s.last7PageViews||0));
    set('anly-visitors', Number(s.uniqueVisitors||0));
    set('anly-visitors7', Number(s.last7UniqueVisitors||0));
    set('anly-starts', Number(s.formStarts||0));
    set('anly-submits', Number(s.formSubmits||0));
    set('anly-engagement', engagement);
    set('anly-engagement7', engagement7);

    analyticsDonut('#anly-sources-chart', '#anly-sources-legend', d.trafficSources, 'source', 'count', 'Views');
    analyticsDonut('#anly-devices-chart', '#anly-devices-legend', d.devices, 'device', 'count', 'Views');
    analyticsBars('#anly-landings-chart', d.topLandingPages, 'page', 'entries');
    analyticsBars('#anly-utms-chart', d.utmCampaigns, 'campaign', 'count');
    const engCanvas = $('#anly-engagement-chart');
    if (engCanvas && typeof drawBarChart === 'function') {
      drawBarChart(engCanvas, ['CTA', 'Phone', 'WhatsApp', 'Email'], [Number(s.ctaClicks||0), Number(s.phoneClicks||0), Number(s.whatsappClicks||0), Number(s.emailClicks||0)]);
    }
  }

  async function renderRecovery() {
    const body = $('#recovery-body');
    if (!body) return;
    const now = Date.now();
    const items = leads.filter(l => ['New','Contacted'].includes(l.status)).map(l => {
      const ageHrs = (now - new Date(l.createdAt||0).getTime())/36e5;
      const reason = l.status === 'New' ? (ageHrs>24?'New lead not contacted >24h':'New lead awaiting contact') : (ageHrs>72?'Contacted but no progress >72h':'Contacted follow-up');
      return { l, ageHrs, reason };
    }).sort((a,b)=>b.ageHrs-a.ageHrs).slice(0,20);
    body.innerHTML = items.length ? items.map(x => '<tr><td><b style="color:var(--navy)">'+esc(x.l.name||'Unknown')+'</b><div style="font-size:.75rem;color:var(--muted)">'+esc(x.l.phone||'')+'</div></td><td>'+esc(x.l.status||'')+'</td><td>'+Math.floor(x.ageHrs/24)+'d '+Math.floor(x.ageHrs%24)+'h</td><td>'+esc(x.reason)+'</td></tr>').join('') : '<tr><td colspan="4" class="table-empty">No recovery items detected yet.</td></tr>';
    const note = $('#recovery-note');
    if (note) {
      const api = window.ASBackend;
      if (!analyticsData && api) { try { analyticsData = await api.request('api/admin/analytics'); } catch(e) {} }
      const s = (analyticsData && analyticsData.summary) || {};
      const abandon = Number(s.last7FormAbandon || 0);
      const sns = Math.max(0, Number(s.formStarts||0) - Number(s.formSubmits||0));
      note.textContent = 'Anonymous abandon events (7d): ' + abandon + ' | Started not submitted: ' + sns;
    }
  }

  function renderFollowups() {
    const body = $('#followups-body');
    if (!body) return;
    const now = Date.now();
    const items = [...leads].filter(l => ['New','Contacted'].includes(l.status)).map(l => {
      const ageH = (now - new Date(l.createdAt||l.receivedAt||0).getTime())/36e5;
      const followUpDue = l.followUpDate ? (new Date(l.followUpDate+'T23:59:59').getTime() < now) : false;
      const overdue = followUpDue || (l.status==='New'&&ageH>=24)||(l.status==='Contacted'&&ageH>=72);
      return { l, ageH, overdue, followUpDue };
    }).sort((a,b)=> (b.overdue-a.overdue) || (b.followUpDue-a.followUpDue) || (b.ageH-a.ageH)).slice(0,20);
    body.innerHTML = items.length ? items.map(x => {
      const l = x.l;
      const sla = x.overdue ? ' <span class="badge b-red">SLA</span>' : '';
      const due = l.followUpDate ? '<div style="font-size:.72rem;color:'+(x.followUpDue?'var(--red)':'var(--muted)')+'">Due '+esc(fmtShort(l.followUpDate))+'</div>' : '';
      return '<tr><td><b style="color:var(--navy)">'+esc(l.name||'Unknown')+'</b><div style="font-size:.75rem;color:var(--muted)">'+esc(l.product||'')+'</div></td><td><span class="badge badge-'+String(l.status).toLowerCase()+'">'+esc(l.status||'')+'</span>'+sla+'</td><td>'+esc(l.priority||'Medium')+'</td><td>'+esc(fmtShort(l.createdAt))+due+'</td><td><button type="button" class="a-btn a-btn-light a-btn-sm" data-view-link="leads">Open</button></td></tr>';
    }).join('') : '<tr><td colspan="5" class="table-empty">No follow-ups found.</td></tr>';
  }

  async function renderHealth() {
    const api = window.ASBackend; if (!api) return;
    const set = (id,v)=>{ const el=$('#'+id); if(el) el.textContent=v; };
    try {
      const r = await fetch('/api/health', { credentials:'same-origin' });
      const d = await r.json().catch(()=>({}));
      set('health-api-status', r.ok ? 'Healthy' : 'Error');
      set('health-api-detail', r.ok ? ('HTTP '+r.status+' at '+new Date().toLocaleString()) : ('HTTP '+r.status));
      set('health-backend', d.backend || 'Unknown');
    } catch(e) { set('health-api-status','Unavailable'); set('health-api-detail','Could not reach /api/health'); }
  }

  async function renderAudit() {
    const api = window.ASBackend; const body = $('#audit-body');
    if (api && body) {
      try {
        const d = await api.request('api/audit');
        const items = Array.isArray(d) ? d : (Array.isArray(d.items) ? d.items : Array.isArray(d.logs) ? d.logs : []);
        body.innerHTML = items.length ? items.slice(0,30).map(a => '<tr><td title="'+esc(fmtDate(a.at||a.createdAt))+'">'+esc(timeAgo(a.at||a.createdAt))+'</td><td>'+esc(a.actorEmail||a.actor||'-')+'</td><td>'+esc(a.type||a.action||'-')+'</td><td>'+esc(a.summary||a.targetId||'-')+'</td></tr>').join('') : '<tr><td colspan="4" class="table-empty">No audit logs found.</td></tr>';
      } catch(e) { body.innerHTML = '<tr><td colspan="4" class="table-empty">Could not load audit logs.</td></tr>'; }
    }
    const sBody = $('#audit-sessions-body');
    if (api && sBody) {
      try {
        const d = await api.request('api/sessions');
        const items = Array.isArray(d) ? d : (Array.isArray(d.sessions) ? d.sessions : Array.isArray(d.items) ? d.items : []);
        sBody.innerHTML = items.length ? items.slice(0,20).map(s => '<tr><td>'+esc(s.email||s.user||'-')+'</td><td>'+esc(s.role||'-')+'</td><td>'+esc(timeAgo(s.lastSeenAt||s.lastSeen||s.createdAt))+'</td><td title="'+esc(s.userAgent||'')+'">'+esc(s.ip||'-')+'</td></tr>').join('') : '<tr><td colspan="4" class="table-empty">No active sessions found.</td></tr>';
      } catch(e) { sBody.innerHTML = '<tr><td colspan="4" class="table-empty">Could not load sessions.</td></tr>'; }
    }
  }

  /* ---------------------------------------------------------------- leads */
  function filteredLeads() {
    const q = filters.leadSearch.toLowerCase();
    return leads.filter(l => {
      if (q && !(l.name + ' ' + l.phone + ' ' + l.email + ' ' + l.id).toLowerCase().includes(q)) return false;
      if (filters.leadProduct && l.product !== filters.leadProduct) return false;
      if (filters.leadStatus && l.status !== filters.leadStatus) return false;
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
    $('#leads-open').textContent = leads.filter(l => ['New', 'Contacted'].includes(l.status)).length;
    $('#leads-converted').textContent = leads.filter(l => l.status === 'Accepted').length;
    $('#leads-value').textContent = compact(leads.reduce((s, l) => s + amountToNumber(l.amount), 0));

    $('#leads-body').innerHTML = pageItems.length ? pageItems.map(l =>
      '<tr>' +
      '<td><div class="cust"><span class="cust-avatar">' + initials(l.name) + '</span><span><b>' + esc(l.name) + '</b><span>' + esc(l.id) + '</span></span></div></td>' +
      '<td>' + esc(l.phone) + '</td>' +
      '<td>' + esc(l.product) + '<div style="font-size:.66rem;color:#5b6b7e">' + esc(l.city || 'Hyderabad') + '</div></td>' +
      '<td class="num">' + compact(amountToNumber(l.amount)) + '</td>' +
      '<td>' + (() => { const ageH=(Date.now()-new Date(l.createdAt||l.receivedAt||0).getTime())/36e5; const sla=(l.status==='New'&&ageH>=24)||(l.status==='Contacted'&&ageH>=72); return '<span class="badge badge-' + String(l.status).toLowerCase() + '">' + esc(l.status) + '</span>' + (sla ? ' <span class="badge b-red" title="SLA reminder">SLA</span>' : ''); })() + '</td>' +
      '<td><span class="badge badge-' + String(l.priority || 'medium').toLowerCase() + '">' + esc(l.priority || 'Medium') + '</span></td>' +
      '<td title="' + fmtDate(l.createdAt) + '">' + fmtShort(l.createdAt) + '</td>' +
      '<td><div class="row-actions">' +
        '<a class="a-btn-icon" href="https://wa.me/' + esc(String(l.phone || "").replace(/\D/g, "").replace(/^0/, "91").slice(-12)) + '" target="_blank" rel="noopener noreferrer" title="WhatsApp"><svg class="icon" aria-hidden="true"><use href="#i-whatsapp"></use></svg></a>' +
        '<button class="a-btn-icon" data-action="edit-lead" data-id="' + esc(l.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
        '<button class="a-btn-icon danger" data-action="delete-lead" data-id="' + esc(l.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
      '</div></td></tr>'
    ).join('') : '<tr><td colspan="8" class="table-empty"><svg class="icon" aria-hidden="true"><use href="#i-users"></use></svg><br>No leads match these filters.<br><button class="a-btn a-btn-light a-btn-sm" style="margin-top:10px" data-action="clear-filters">Clear filters</button></td></tr>';

    renderPagination('#leads-pagination', list.length, leadPage, (p) => { leadPage = p; renderLeads(); }, PAGE_SIZE);
    updateCounts();
    if (typeof renderOverviewLeads === 'function') renderOverviewLeads();
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
        '<div class="form-row"><div class="a-field"><label>Next follow-up</label><input name="followUpDate" type="date" value="' + esc(lead && lead.followUpDate ? String(lead.followUpDate).slice(0,10) : '') + '"></div><div class="a-field"><label>Last contacted</label><input name="lastContactedAt" type="date" value="' + esc(lead && lead.lastContactedAt ? String(lead.lastContactedAt).slice(0,10) : '') + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Enquiry notes</label><textarea name="message" placeholder="What is the customer looking for?">' + esc(lead ? lead.message : '') + '</textarea></div></div>',
      submitLabel: lead ? 'Save changes' : 'Add lead',
      onSubmit: async (data) => {
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
          followUpDate: String(data.get('followUpDate') || '').trim(),
          lastContactedAt: String(data.get('lastContactedAt') || '').trim(),
          message: String(data.get('message') || '')
        };
        const api = window.ASBackend;
        const canUseApi = api && api.request;
        const nowIso = new Date().toISOString();
        const addTimeline = (obj, event, detail) => {
          obj.timeline = Array.isArray(obj.timeline) ? obj.timeline : [];
          obj.timeline.unshift({ at: nowIso, event, detail: String(detail || '').slice(0, 240) });
          if (obj.timeline.length > 50) obj.timeline.length = 50;
        };
        try {
          if (lead) {
            const prevStatus = lead.status;
            payload.timeline = Array.isArray(lead.timeline) ? lead.timeline.slice() : [];
            if (prevStatus !== payload.status) addTimeline(payload, 'status_changed', 'Status: ' + prevStatus + ' → ' + payload.status);
            if ((lead.followUpDate || '') !== (payload.followUpDate || '')) addTimeline(payload, 'follow_up_updated', payload.followUpDate ? ('Next follow-up: ' + payload.followUpDate) : 'Follow-up cleared');
            if ((lead.message || '') !== (payload.message || '') && payload.message) addTimeline(payload, 'note_updated', payload.message);
            if (lead._server && canUseApi) {
              await api.request('api/enquiries/' + lead.id, { method: 'PATCH', body: { status: payload.status, handled: payload.status !== 'New', note: payload.message || '' } }).catch(()=>{});
              Object.assign(lead, payload);
            } else if (canUseApi) {
              const res = await api.request('api/admin/leads/' + encodeURIComponent(lead.id), { method: 'PATCH', body: payload }).catch(() => null);
              Object.assign(lead, (res && res.item) ? res.item : payload);
            } else {
              Object.assign(lead, payload);
            }
            toast('Lead updated.');
          } else {
            const itemBase = Object.assign({ id: uid('ASL-'), createdAt: nowIso, notes: [], timeline: [] }, payload);
            addTimeline(itemBase, 'created', 'Lead created');
            if (canUseApi) {
              const res = await api.request('api/admin/leads', { method: 'POST', body: itemBase }).catch(() => null);
              const item = (res && res.item) ? res.item : itemBase;
              leads.unshift(item);
            } else {
              leads.unshift(itemBase);
            }
            toast('Lead added to the pipeline.');
          }
        } catch (e) {
          if (lead) Object.assign(lead, payload); else leads.unshift(Object.assign({ id: uid('ASL-'), createdAt: nowIso, notes: [], timeline: [{ at: nowIso, event: 'created', detail: 'Lead created' }] }, payload));
          toast('Saved locally. Server sync may be pending.', 'error');
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
        '<div class="detail-box"><small>Next follow-up</small><b>' + esc(lead.followUpDate ? fmtShort(lead.followUpDate) : 'Not set') + '</b></div>' +
        '<div class="detail-box"><small>Last contacted</small><b>' + esc(lead.lastContactedAt ? fmtShort(lead.lastContactedAt) : '—') + '</b></div>' +
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
      '<div class="drawer-section"><h3>Linked records</h3><div class="note-list">' +
        (() => { const linkedApps = applications.filter(a => a.leadId===lead.id || (a.phone && lead.phone && String(a.phone).replace(/\D/g,'').slice(-10)===String(lead.phone).replace(/\D/g,'').slice(-10)));
          const linkedCust = customers.filter(c => c.leadId===lead.id || (c.phone && lead.phone && String(c.phone).replace(/\D/g,'').slice(-10)===String(lead.phone).replace(/\D/g,'').slice(-10)));
          const items = [];
          linkedApps.slice(0,3).forEach(a => items.push('<div class="note-item">Application: ' + esc(a.applicant||a.name||a.id) + ' <span class="badge badge-'+String(a.stage||'new').toLowerCase().replace(/[^a-z]/g,'')+'">'+esc(a.stage||'New')+'</span></div>'));
          linkedCust.slice(0,3).forEach(c => items.push('<div class="note-item">Customer: ' + esc(c.name||c.id) + ' <span class="badge badge-'+String(c.status||'new').toLowerCase().replace(/[^a-z]/g,'')+'">'+esc(c.status||'New')+'</span></div>'));
          return items.length ? items.join('') : '<div class="note-item" style="color:#5b6b7e">No linked applications/customers yet.</div>';
        })() +
      '</div></div>' +
      '<div class="drawer-section"><h3>Timeline</h3><div class="note-list">' +
        ((Array.isArray(lead.timeline)&&lead.timeline.length) ? lead.timeline.slice(0,8).map(t => '<div class="note-item">' + esc(t.detail || t.event || 'Update') + '<time>' + fmtDate(t.at) + '</time></div>').join('') : '<div class="note-item" style="color:#5b6b7e">No timeline events yet.</div>') +
      '</div></div>' +
      '<div class="drawer-section"><h3>Meta</h3><div class="detail-grid-2"><div class="detail-box"><small>Priority</small><b>' + esc(lead.priority || 'Medium') + '</b></div><div class="detail-box"><small>Owner</small><b>' + esc(lead.owner || 'Admin') + '</b></div></div></div>';

    $('#drawer-foot').innerHTML =
      '<button class="a-btn a-btn-light" id="drawer-convert-app" style="flex:1">Create application</button>' +
      '<button class="a-btn a-btn-light" id="drawer-convert-cust" style="flex:1">Create customer</button>' +
      '<button class="a-btn a-btn-light" id="drawer-edit" aria-label="Edit lead"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
      '<button class="a-btn a-btn-danger" id="drawer-delete" aria-label="Delete lead"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>';

    $('#drawer-status').addEventListener('change', (e) => {
      const prev = lead.status;
      lead.status = e.target.value;
      lead.timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
      if (prev !== lead.status) lead.timeline.unshift({ at: new Date().toISOString(), event: 'status_changed', detail: 'Status: ' + prev + ' → ' + lead.status });
      if (lead.timeline.length > 50) lead.timeline.length = 50;
      if (lead._server && window.ASBackend && window.ASBackend.request) {
        var handled = ['New'].indexOf(lead.status) === -1;
        lead._handled = handled;
        window.ASBackend.request('api/enquiries/' + lead.id, { method: 'PATCH', body: { status: lead.status, handled: handled } }).catch(function () {});
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
      const at = new Date().toISOString();
      lead.notes = lead.notes || [];
      lead.notes.unshift({ text, at });
      lead.timeline = Array.isArray(lead.timeline) ? lead.timeline : [];
      lead.timeline.unshift({ at, event: 'note_added', detail: text.slice(0, 240) });
      if (lead.timeline.length > 50) lead.timeline.length = 50;
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
    const convApp = $('#drawer-convert-app');
    if (convApp) convApp.addEventListener('click', () => { closeDrawer(); applicationModal(null, { applicant: lead.name, phone: lead.phone, product: lead.product, amount: lead.amount, owner: lead.owner || 'Admin', leadId: lead.id, notes: lead.message || '' }); });
    const convCust = $('#drawer-convert-cust');
    if (convCust) convCust.addEventListener('click', () => { closeDrawer(); customerModal(null, { name: lead.name, phone: lead.phone, email: lead.email, city: lead.city, product: lead.product, owner: lead.owner || 'Admin', source: lead.source || 'Lead', notes: lead.message || '', leadId: lead.id }); });
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

  async function fetchGoogleReviewsUI() {
    const panel = $('#google-reviews-panel');
    const list = $('#google-reviews-list');
    const meta = $('#google-reviews-meta');
    const btn = $('#fetch-google-reviews-btn');
    if (!panel || !list) return;
    panel.style.display = 'block';
    list.innerHTML = '<div class="empty-state"><p>Fetching Google reviews...</p></div>';
    if (meta) meta.textContent = 'Fetching reviews from Google Maps...';
    if (btn) { btn.disabled = true; btn.style.opacity = '.7'; }
    try {
      const api = window.ASBackend;
      if (!api || !api.request) throw new Error('Backend API unavailable.');
      const res = await api.request('api/admin/google-reviews');
      const reviews = Array.isArray(res.reviews) ? res.reviews : [];
      const place = res.place || {};
      if (meta) meta.textContent = (place.name ? place.name + ' · ' : '') + (place.rating ? (place.rating + '★ (' + (place.total || reviews.length) + ')') : '') + ' · Select reviews to publish on the website.';
      if (!reviews.length) {
        list.innerHTML = '<div class="empty-state"><p>No reviews returned. Check your Google Place ID and API configuration.</p></div>';
        return;
      }
      list.innerHTML = reviews.map(rv => {
        const exists = testimonials.some(t => String(t.googleReviewId || '') === String(rv.id) || (String(t.name||'').toLowerCase() === String(rv.author||'').toLowerCase() && String(t.quote||'').trim() === String(rv.text||'').trim()));
        const safeText = esc(rv.text || '');
        const safeAuthor = esc(rv.author || 'Google user');
        return '<div class="content-item" style="align-items:flex-start">' +
          '<div class="ci-main"><b>' + safeAuthor + '</b>' +
          '<p>' + safeText + '</p>' +
          '<div class="ci-meta"><span>Google Maps</span><span>' + (Number(rv.rating)||0) + '★</span><span>' + esc(rv.relativeTime || '') + '</span>' + (exists ? '<span class="badge badge-active">Added</span>' : '') + '</div></div>' +
          '<div class="ci-actions">' +
            (exists ? '<button class="a-btn a-btn-light a-btn-sm" type="button" disabled>Published/Added</button>' : '<button class="a-btn a-btn-primary a-btn-sm" type="button" data-action="publish-google-review" data-grid="' + esc(rv.id) + '">Add to website</button>') +
          '</div>' +
        '</div>';
      }).join('');
      list._googleReviews = reviews;
    } catch (err) {
      console.error('Google reviews fetch failed', err);
      if (meta) meta.textContent = 'Could not fetch Google reviews.';
      list.innerHTML = '<div class="empty-state"><p>' + esc((err && err.message) ? err.message : 'Could not fetch Google reviews.') + '</p><p style="font-size:.72rem;color:#5b6b7e;margin-top:6px">Configure GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID on the server.</p></div>';
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
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

    const cProdList = $('#content-products-list');
    if (cProdList) {
      cProdList.innerHTML = products.length ? products.map(p => {
        const slot = CONTENT_IMAGE_SLOTS.find(s => (p.name || '').toLowerCase().includes(s.key.replace(/-/g,' ')) || (s.label || '').toLowerCase() === (p.name || '').toLowerCase());
        const img = slot ? (contentImages[slot.key] || slot.fallback) : '';
        const thumb = img && img !== 'icon' ? '<span class="img-preview" style="width:56px;height:56px;flex:none;border-radius:10px;overflow:hidden;background:#f3f6fa;display:grid;place-items:center"><img src="' + esc(img) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></span>' : '<span class="img-preview" style="width:56px;height:56px;flex:none;border-radius:10px;background:#f3f6fa;display:grid;place-items:center"><svg class="icon" aria-hidden="true"><use href="#i-' + esc(p.icon || 'doc') + '"></use></svg></span>';
        const uploadBtn = slot ? '<label class="a-btn a-btn-light a-btn-sm image-upload-btn" style="margin:0"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-plus"></use></svg> Upload image<input type="file" accept="image/*" data-upload-image="' + esc(slot.key) + '" class="image-upload-input"></label>' : '';
        return '<div class="content-item" style="align-items:center;gap:14px">' +
          thumb +
          '<div class="ci-main"><b>' + esc(p.name) + '</b><p>' + esc(p.description || 'No description') + '</p>' +
          '<div class="ci-meta"><span>' + esc(p.category || 'Product') + '</span><span>' + (p.rate ? Number(p.rate).toFixed(2) + '% p.a.' : 'Rate N/A') + '</span><span class="badge badge-' + (p.visible ? 'active' : 'inactive') + '">' + (p.visible ? 'Visible' : 'Hidden') + '</span></div></div>' +
          '<div class="ci-actions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + uploadBtn + '<button class="a-btn-icon" data-action="edit-product" data-id="' + esc(p.id) + '" title="Edit product"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button></div>' +
        '</div>';
      }).join('') : '<div class="empty-state"><h4>No products yet</h4><p>Add products in the Loan products section.</p></div>';
    }
    const cProdSummary = $('#content-products-summary');
    if (cProdSummary) cProdSummary.textContent = products.length ? (products.filter(p => p.visible).length + ' of ' + products.length + ' visible on the website') : 'No products configured yet.';

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
    const hosts = document.querySelectorAll('#content-images-list, #content-images-list-content');
    if (!hosts.length) return;
    const html = CONTENT_IMAGE_SLOTS.map(slot => {
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
    hosts.forEach(h => { h.innerHTML = html; });

    const summaries = document.querySelectorAll('#content-images-summary, #content-images-summary-content');
    if (summaries.length) {
      const customCount = CONTENT_IMAGE_SLOTS.filter(slot => contentImages[slot.key] && contentImages[slot.key] !== slot.fallback).length;
      const uploadCount = CONTENT_IMAGE_SLOTS.filter(slot => typeof contentImages[slot.key] === 'string' && contentImages[slot.key].indexOf('data:image/') === 0).length;
      let text = customCount
        ? customCount + ' of ' + CONTENT_IMAGE_SLOTS.length + ' cards customised. Changes show on the homepage in this browser only.'
        : 'All cards use their default look. Upload a photo or choose icon only for any card.';
      if (uploadCount) text += ' Uploaded photos are stored only in this browser.';
      summaries.forEach(el => { el.textContent = text; });
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

  function postModal(id, preset) {
    const p = id ? posts.find(x => x.id === id) : (preset && typeof preset === 'object' ? preset : null);
    const isEdit = !!(id && p && p.id && posts.find(x => x.id === id));
    openModal({
      title: isEdit ? 'Edit article' : 'Add article',
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
        if (isEdit) { Object.assign(posts.find(x => x.id === id), payload); toast('Article updated.'); }
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

  function customerModal(id, prefill) {
    const c = id ? customers.find(x => x.id === id) : null;
    const p = prefill || {};
    const statusOpts = ['New', 'Contacted', 'Qualified', 'Documents', 'Sanctioned', 'Disbursed', 'Inactive'].map(s => '<option ' + ((c ? c.status : 'New') === s ? 'selected' : '') + '>' + s + '</option>').join('');
    openModal({
      title: c ? 'Edit customer' : 'Add customer',
      sub: 'Customer profile and relationship details.',
      body:
        '<div class="form-row"><div class="a-field"><label>Full name <span class="req">*</span></label><input name="name" required value="' + esc(c ? c.name : (p.name||'')) + '"></div>' +
        '<div class="a-field"><label>Phone</label><input name="phone" value="' + esc(c ? c.phone : (p.phone||'')) + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Email</label><input name="email" type="email" value="' + esc(c ? c.email : (p.email||'')) + '"></div>' +
        '<div class="a-field"><label>City</label><input name="city" value="' + esc(c ? c.city : (p.city||'')) + '"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Product interest</label><input name="product" value="' + esc(c ? (c.product || c.interest || '') : (p.product||'')) + '" placeholder="e.g. Home Loan"></div>' +
        '<div class="a-field"><label>Status</label><select name="status">' + statusOpts + '</select></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Assigned to</label><input name="owner" value="' + esc(c ? (c.owner || '') : (p.owner||'')) + '"></div>' +
        '<div class="a-field"><label>Source</label><input name="source" value="' + esc(c ? (c.source || '') : (p.source||'')) + '"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Notes</label><textarea name="notes">' + esc(c ? (c.notes || '') : (p.notes||'')) + '</textarea></div></div>' +
        (p.leadId || (c && c.leadId) ? '<input type="hidden" name="leadId" value="'+esc(c?c.leadId:p.leadId)+'">' : ''),
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
          leadId: String(data.get('leadId') || c?.leadId || p.leadId || '').trim(),
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

  /* ---------------------------------------------------------------- applications */
  function renderApplications() {
    const body = $('#applications-body'); if (!body) return;
    const rows = applications.slice().sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0));
    const set = (id,v)=>{ const el=$('#'+id); if(el) el.textContent=v; };
    set('app-total', rows.length);
    set('app-progress', rows.filter(a=>['New','Documents Pending','Under Review','Submitted to Bank','Approved'].includes(a.stage)).length);
    set('app-approved', rows.filter(a=>['Sanctioned','Disbursed'].includes(a.stage)).length);
    set('app-hold', rows.filter(a=>['Rejected','On Hold'].includes(a.stage)).length);
    body.innerHTML = rows.length ? rows.map(a =>
      '<tr>' +
      '<td><b style="color:var(--navy)">'+esc(a.applicant||a.name||'Unknown')+'</b><div style="font-size:.75rem;color:var(--muted)">'+esc(a.id||'')+'</div></td>' +
      '<td>'+esc(a.product||'—')+'</td>' +
      '<td class="num">'+(a.amount?compact(amountToNumber(a.amount)):'—')+'</td>' +
      '<td><span class="badge badge-'+String(a.stage||'new').toLowerCase().replace(/[^a-z]/g,'')+'">'+esc(a.stage||'New')+'</span></td>' +
      '<td>'+esc(a.owner||'—')+'</td>' +
      '<td title="'+esc(fmtDate(a.updatedAt||a.createdAt))+'">'+esc(fmtShort(a.updatedAt||a.createdAt))+'</td>' +
      '<td><div class="row-actions"><button class="a-btn-icon" data-action="edit-application" data-id="'+esc(a.id)+'" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button><button class="a-btn-icon danger" data-action="delete-application" data-id="'+esc(a.id)+'" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button></div></td>' +
      '</tr>'
    ).join('') : '<tr><td colspan="7" class="table-empty">No applications yet. Add one to start tracking.</td></tr>';
  }

  function applicationModal(id, prefill) {
    const a = id ? applications.find(x=>x.id===id) : null;
    const p = prefill || {};
    const stages = ['New','Documents Pending','Under Review','Submitted to Bank','Approved','Sanctioned','Disbursed','Rejected','On Hold'];
    const stageOpts = stages.map(s=>'<option '+((a?a.stage:'New')===s?'selected':'')+'>'+s+'</option>').join('');
    const productOpts = products.map(pr=>'<option '+((a?a.product:p.product)===pr.name?'selected':'')+'>'+esc(pr.name)+'</option>').join('');
    openModal({
      title: a ? 'Edit application' : 'Add application',
      sub: 'Track application progress with real records only.',
      body:
        '<div class="form-row"><div class="a-field"><label>Applicant name <span class="req">*</span></label><input name="applicant" required value="'+esc(a?a.applicant||a.name:(p.applicant||''))+'"></div>' +
        '<div class="a-field"><label>Phone</label><input name="phone" value="'+esc(a?a.phone:(p.phone||''))+'"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Product</label><select name="product">'+productOpts+'</select></div>' +
        '<div class="a-field"><label>Amount (₹)</label><input name="amount" type="number" min="0" step="10000" value="'+esc(a?a.amount:(p.amount||''))+'"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Stage</label><select name="stage">'+stageOpts+'</select></div>' +
        '<div class="a-field"><label>Owner</label><input name="owner" value="'+esc(a?a.owner:(p.owner||'Admin'))+'"></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Lender / Bank</label><input name="lender" value="'+esc(a?a.lender:'')+'"></div>' +
        '<div class="a-field"><label>Reference</label><input name="reference" value="'+esc(a?a.reference:'')+'"></div></div>' +
        '<div class="form-row one"><div class="a-field"><label>Notes</label><textarea name="notes">'+esc(a?a.notes:(p.notes||''))+'</textarea></div></div>' +
        (p.leadId || (a && a.leadId) ? '<input type="hidden" name="leadId" value="'+esc(a?a.leadId:p.leadId)+'">' : ''),
      submitLabel: a ? 'Save changes' : 'Add application',
      onSubmit: async (data) => {
        const applicant = String(data.get('applicant')||'').trim();
        if (!applicant) { toast('Applicant name is required.', 'error'); return false; }
        const now = new Date().toISOString();
        const payload = { applicant, phone:String(data.get('phone')||'').trim(), product:String(data.get('product')||''), amount:Number(data.get('amount'))||0, stage:String(data.get('stage')||'New'), owner:String(data.get('owner')||'Admin').trim(), lender:String(data.get('lender')||'').trim(), reference:String(data.get('reference')||'').trim(), notes:String(data.get('notes')||'').trim(), leadId:String(data.get('leadId')||a?.leadId||p.leadId||'').trim(), updatedAt: now };
        const api = window.ASBackend;
        try {
          if (a) {
            if (api && api.request) { const res = await api.request('api/admin/applications/'+encodeURIComponent(a.id), { method:'PATCH', body: payload }).catch(()=>null); Object.assign(a, (res&&res.item)?res.item:payload); }
            else Object.assign(a, payload);
            toast('Application updated.');
          } else {
            let item = Object.assign({ id: uid('APP-',4), createdAt: now }, payload);
            if (api && api.request) { const res = await api.request('api/admin/applications', { method:'POST', body: payload }).catch(()=>null); if (res && res.item) item = res.item; }
            applications.unshift(item);
            toast('Application added.');
          }
        } catch(e) { if (a) Object.assign(a,payload); else applications.unshift(Object.assign({ id: uid('APP-',4), createdAt: now }, payload)); toast('Saved locally. Server sync may be pending.', 'error'); }
        save.applications(); apps = applications; renderAll();
      }
    });
  }

  /* ---------------------------------------------------------------- notifications */
  function renderNotifications() {
    const host = $('#notifications-list');
    const items = Array.isArray(notifications) ? notifications.slice().sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) : [];

    // Bell dropdown (always rendered)
    const menu = $('#notif-menu');
    if (menu) {
      const unread = items.filter(n => !n.read).length;
      const head = '<div class="notif-head"><strong>Notifications</strong><span id="notif-menu-count">' + (unread ? (unread + ' unread') : 'No new alerts') + '</span></div>';
      if (!items.length) {
        menu.innerHTML = head + '<div class="notif-item"><span><b>No notifications</b><span>New alerts will appear here.</span></span></div>';
      } else {
        menu.innerHTML = head + items.slice(0, 8).map(n => {
          const when = n.createdAt ? timeAgo(n.createdAt) : '';
          return '<button type="button" class="notif-item" data-action="open-notification" data-id="' + esc(n.id) + '" style="width:100%;text-align:left;background:none;border:0;cursor:pointer;' + (!n.read ? 'background:rgba(201,162,39,.06);' : '') + '">' +
            '<span><b>' + esc(n.title || 'Notification') + '</b><span>' + esc(n.message || '') + (when ? ' · ' + esc(when) : '') + '</span></span>' +
          '</button>';
        }).join('') + '<div style="padding:10px 12px;border-top:1px solid #f2eee4"><button type="button" class="a-btn a-btn-light a-btn-sm" data-action="go-notifications">View all notifications</button></div>';
      }
    }

    if (!host) return;
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
    const totalLeads = leads.length;
    const accepted = leads.filter(l => l.status === 'Accepted').length;
    const contacted = leads.filter(l => l.status === 'Contacted').length;
    const newLeads = leads.filter(l => l.status === 'New').length;
    const declined = leads.filter(l => l.status === 'Declined').length;
    const activePartners = partners.filter(p => p.active).length;
    const conversion = totalLeads ? Math.round((accepted / totalLeads) * 100) : 0;
    const contactRate = totalLeads ? Math.round(((contacted + accepted + declined) / totalLeads) * 100) : 0;

    const set = (id, v) => { const el = $('#'+id); if (el) el.textContent = v; };
    set('report-disbursed', String(totalLeads));
    set('report-conversion', conversion + '%');
    set('report-ticket', String(accepted));
    set('report-lenders', String(activePartners));
    const rdc=$('#report-disbursed-chip'); if(rdc) rdc.textContent='Live';
    const rcc=$('#report-conversion-chip'); if(rcc) rcc.textContent='Live';
    // relabel KPI cards if present
    const labels = $$('#view-reports .kpi-label');
    if (labels[0]) labels[0].textContent = 'Total enquiries';
    if (labels[1]) labels[1].textContent = 'Accepted conversion';
    if (labels[2]) labels[2].textContent = 'Accepted enquiries';
    if (labels[3]) labels[3].textContent = 'Active lending partners';

    const funnel = [
      ['Enquiries received', totalLeads],
      ['Contacted', contacted + accepted + declined],
      ['Accepted', accepted],
      ['Declined', declined],
    ];
    const maxF = Math.max(...funnel.map(f => f[1]), 1);
    const funnelHost = $('#funnel-list');
    if (funnelHost) funnelHost.innerHTML = funnel.map(([label, count]) =>
      '<div class="pipeline-row"><div class="p-top"><span>' + label + '</span><b>' + count + (totalLeads ? ' • ' + Math.round(count / totalLeads * 100) + '%' : '') + '</b></div><div class="pipeline-track"><span style="width:' + Math.max(4, Math.round(count / maxF * 100)) + '%"></span></div></div>'
    ).join('');

    // Product interest breakdown (real lead data)
    const prodMap = {};
    leads.forEach(l => { const p = String(l.product || 'Unspecified'); prodMap[p] = (prodMap[p]||0)+1; });
    const prodRows = Object.entries(prodMap).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const lenderBody = $('#lender-body');
    if (lenderBody) lenderBody.innerHTML = prodRows.length ? prodRows.map(([name, count]) => {
      const acc = leads.filter(l => String(l.product||'Unspecified')===name && l.status==='Accepted').length;
      return '<tr><td><b style="font-weight:700;color:var(--navy)">' + esc(name) + '</b></td><td>Product</td><td>' + count + '</td><td class="num">' + acc + '</td><td>—</td><td><span class="badge badge-' + (count && acc/count>=0.3?'active':'inactive') + '">' + (count?Math.round(acc/count*100):0) + '%</span></td></tr>';
    }).join('') : '<tr><td colspan="6" class="table-empty">No lead data yet.</td></tr>';
    const lenderHead = document.querySelector('#view-reports .card:last-of-type .card-head h3');
    if (lenderHead) lenderHead.textContent = 'Product interest performance';
    const lenderSub = document.querySelector('#view-reports .card:last-of-type .card-head p');
    if (lenderSub) lenderSub.textContent = 'Enquiries and accepted outcomes by product (real lead data)';

    // Charts: replace disbursement/source charts with lead trends if chart funcs exist
    const disbCanvas = $('#chart-disbursement');
    const srcCanvas = $('#chart-source');
    if (disbCanvas && typeof drawLineChart === 'function') {
      const byMonth = {};
      leads.forEach(l => { const k = String(l.createdAt||'').slice(0,7); if(!k) return; byMonth[k]=(byMonth[k]||0)+1; });
      const keys = Object.keys(byMonth).sort().slice(-6);
      drawLineChart(disbCanvas, keys.length?keys:['—'], keys.length?keys.map(k=>byMonth[k]):[0], keys.length?keys.map(k=>leads.filter(l=>String(l.createdAt||'').startsWith(k)&&l.status==='Accepted').length):[0]);
      const disbTitle = disbCanvas.closest('.card')?.querySelector('.card-head h3');
      if (disbTitle) disbTitle.textContent = 'Monthly enquiries';
      const disbSub = disbCanvas.closest('.card')?.querySelector('.card-head p');
      if (disbSub) disbSub.textContent = 'Enquiries vs accepted (real data)';
    }
    if (srcCanvas && typeof drawBarChart === 'function') {
      const srcMap = {};
      leads.forEach(l => { const k = String(l.source||'Unknown'); srcMap[k]=(srcMap[k]||0)+1; });
      const srcEntries = Object.entries(srcMap).sort((a,b)=>b[1]-a[1]).slice(0,6);
      drawBarChart(srcCanvas, srcEntries.length?srcEntries.map(e=>e[0]):['—'], srcEntries.length?srcEntries.map(e=>e[1]):[0], '#0d2b4e');
    }
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
    if (currentUser && (currentUser.role === 'super_admin' || currentUser.role === 'admin')) { loadUsers(); }
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

  function exportSummary() {
    const total = leads.length;
    const accepted = leads.filter(l => l.status === 'Accepted').length;
    const contacted = leads.filter(l => l.status === 'Contacted').length;
    const declined = leads.filter(l => l.status === 'Declined').length;
    const s = (analyticsData && analyticsData.summary) || {};
    downloadCSV('as-financial-performance.csv', [
      ['Metric', 'Value'],
      ['Total enquiries', total],
      ['New enquiries', leads.filter(l => l.status === 'New').length],
      ['Contacted enquiries', contacted],
      ['Accepted enquiries', accepted],
      ['Declined enquiries', declined],
      ['Accepted conversion %', total ? ((accepted/total)*100).toFixed(1) : '0.0'],
      ['Active partners', partners.filter(p => p.active).length],
      ['Total page views (analytics)', Number(s.totalPageViews||0)],
      ['Unique visitors (analytics)', Number(s.uniqueVisitors||0)],
      ['Form starts (analytics)', Number(s.formStarts||0)],
      ['Form submits (analytics)', Number(s.formSubmits||0)],
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
      api.available(true).then((ok) => {
        if (!ok) throw Object.assign(new Error('Backend is unavailable. Start the server and try again.'), { status: 503 });
        return api.login(email, pass);
      }).then((result) => {
        if (result && !isAllowedAdminRole(result)) {
          denyAccess('Administrator access only.');
          return;
        }
        try { history.replaceState(null, '', location.pathname); } catch (e) {}
        const remember = !!($('#login-remember') ? $('#login-remember').checked : true);
        enterApp(result || { email: email }, remember);
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

    // settings tabs
    function setSettingsTab(tab) {
      $$('#settings-tabs [data-settings-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.settingsTab === tab));
      $$('.settings-tab-panel').forEach(panel => { panel.style.display = panel.dataset.settingsPanel === tab ? '' : 'none'; });
    }
    $$('#settings-tabs [data-settings-tab]').forEach(btn => btn.addEventListener('click', () => setSettingsTab(btn.dataset.settingsTab || 'business')));
    setSettingsTab('business');

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
      if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) { showMsg(resultEl, 'Password must be at least 10 characters and include a letter and a number.', 'error'); return; }
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
      if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) { showMsg(msg, 'New password must be at least 10 characters and include a letter and a number.', 'error'); return; }
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
        role: ($('#nu-role') && $('#nu-role').value) || 'staff',
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
      if (action === 'delete') {
        const row = btn.closest('tr');
        const email = row ? (row.children[1] && row.children[1].textContent || 'this user') : 'this user';
        confirmDialog('Delete user?', email + ' will be permanently removed and signed out.', () => {
          showMsg(msg, 'Deleting user…', 'info');
          api.request('api/users/' + encodeURIComponent(id), { method: 'DELETE' }).then(() => {
            showMsg(msg, 'User deleted.', 'ok');
            loadUsers();
          }).catch((err) => showMsg(msg, (err && err.message) || 'Could not delete user.', 'error'));
        });
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
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-view-link]');
      if (link) { e.preventDefault(); setView(link.dataset.viewLink); }
    });

    // mobile sidebar
    $('#admin-burger').addEventListener('click', openSidebar);
    $('#sidebar-close').addEventListener('click', closeSidebar);
    $('#sidebar-scrim').addEventListener('click', closeSidebar);

    // add lead buttons
    $$('[data-add-lead]').forEach(b => b.addEventListener('click', () => leadModal()));
    const addCustomerBtn = $('#add-customer-btn');
    if (addCustomerBtn) addCustomerBtn.addEventListener('click', () => customerModal());
    const addAppBtn = $('#add-application-btn');
    if (addAppBtn) addAppBtn.addEventListener('click', () => applicationModal());

    // lead filters
    $('#leads-search').addEventListener('input', debounce((e) => { filters.leadSearch = e.target.value; leadPage = 1; renderLeads(); }, 180));
    $('#leads-product-filter').addEventListener('change', (e) => { filters.leadProduct = e.target.value; leadPage = 1; renderLeads(); });
    $('#leads-status-filter').addEventListener('change', (e) => { filters.leadStatus = e.target.value; leadPage = 1; renderLeads(); });
    $('#clear-lead-filters').addEventListener('click', () => {
      filters.leadSearch = filters.leadProduct = filters.leadStatus = '';
      $('#leads-search').value = '';
      $('#leads-product-filter').value = '';
      $('#leads-status-filter').value = '';
      leadPage = 1; renderLeads();
    });

    // applications section removed

    // products / partners / content
    $('#add-product-btn').addEventListener('click', () => productModal());
    $('#add-partner-btn').addEventListener('click', () => partnerModal());
    $('#partner-filter').addEventListener('change', (e) => { filters.partnerType = e.target.value; renderPartners(); });
    $('#add-testimonial-btn').addEventListener('click', () => testimonialModal());
    const fetchGoogleBtn = $('#fetch-google-reviews-btn');
    if (fetchGoogleBtn) fetchGoogleBtn.addEventListener('click', fetchGoogleReviewsUI);
    const closeGoogleBtn = $('#close-google-reviews-btn');
    if (closeGoogleBtn) closeGoogleBtn.addEventListener('click', () => { const p = $('#google-reviews-panel'); if (p) p.style.display = 'none'; });
    const addPostBtn = $('#add-post-btn');
    if (addPostBtn) addPostBtn.addEventListener('click', () => postModal());
    const importPostBtn = $('#import-post-btn');
    if (importPostBtn) importPostBtn.addEventListener('click', async () => {
      const url = window.prompt('Paste article URL to import:');
      if (!url) return;
      const api = window.ASBackend;
      if (!api) { toast('Backend unavailable.', 'error'); return; }
      importPostBtn.disabled = true;
      try {
        const data = await api.request('api/admin/import-article?url=' + encodeURIComponent(url.trim()));
        const a = (data && data.article) || {};
        postModal(null, { title: a.title || '', excerpt: a.excerpt || '', category: 'Guide', readTime: '5 min', published: false, date: new Date().toISOString() });
      } catch (e) {
        toast((e && e.message) ? e.message : 'Could not import article.', 'error');
      } finally {
        importPostBtn.disabled = false;
      }
    });
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
    ['#reset-content-images-btn', '#reset-content-images-btn-content'].forEach(sel => {
      const btn = $(sel);
      if (btn) btn.addEventListener('click', () => {
        contentImages = {};
        save.contentImages();
        renderContentImages();
        renderContent();
        toast('Homepage images reset to defaults.');
      });
    });
    const addTaskBtn = $('#add-task-btn');
    if (addTaskBtn) addTaskBtn.addEventListener('click', taskModal);
    const refreshAnalyticsBtn = $('#refresh-analytics-btn');
    if (refreshAnalyticsBtn) refreshAnalyticsBtn.addEventListener('click', () => { renderOverview(); toast('Analytics refreshed.'); });
    const analyticsRefreshBtn = $('#analytics-refresh-btn');
    if (analyticsRefreshBtn) analyticsRefreshBtn.addEventListener('click', async () => {
      const api = window.ASBackend;
      if (api) { try { analyticsData = await api.request('api/admin/analytics'); } catch (e) {} }
      renderAnalytics();
      toast('Analytics refreshed.');
    });

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
    const downloadReportBtn = $('#download-report-btn');
    if (downloadReportBtn) downloadReportBtn.addEventListener('click', exportSummary);
    $('#print-report-btn').addEventListener('click', exportSummary);

    // settings
    $('#settings-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      ['businessName', 'tagline', 'phone', 'phoneRaw', 'email', 'address', 'hours', 'whatsapp'].forEach(k => {
        if (data.get(k) != null) settings[k] = String(data.get(k)).trim();
      });
      const notifIds = ['notif-leads','notif-apps','notif-weekly','notif-whatsapp'];
      if (notifIds.some(id => $('#' + id))) {
        settings.notifications = {
          leads: !!($('#notif-leads') && $('#notif-leads').checked),
          apps: !!($('#notif-apps') && $('#notif-apps').checked),
          weekly: !!($('#notif-weekly') && $('#notif-weekly').checked),
          whatsapp: !!($('#notif-whatsapp') && $('#notif-whatsapp').checked)
        };
      }
      save.settings();
      toast('Settings saved. The public website will reflect these details.');
    });
    $('#settings-reset').addEventListener('click', renderSettings);
  const healthBtn = $('#health-check-btn'); if (healthBtn) healthBtn.addEventListener('click', renderHealth);
  const auditBtn = $('#audit-refresh-btn'); if (auditBtn) auditBtn.addEventListener('click', renderAudit);
  const sessBtn = $('#sessions-refresh-btn'); if (sessBtn) sessBtn.addEventListener('click', renderAudit);
    ['notif-leads', 'notif-apps', 'notif-weekly', 'notif-whatsapp'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('change', () => {
        const notifIds = ['notif-leads','notif-apps','notif-weekly','notif-whatsapp'];
        if (notifIds.some(nid => $('#' + nid))) {
          settings.notifications = {
            leads: !!($('#notif-leads') && $('#notif-leads').checked),
            apps: !!($('#notif-apps') && $('#notif-apps').checked),
            weekly: !!($('#notif-weekly') && $('#notif-weekly').checked),
            whatsapp: !!($('#notif-whatsapp') && $('#notif-whatsapp').checked)
          };
          save.settings();
        }
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
          renderContent();
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
        renderContent();
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
        filters.leadSearch = filters.leadProduct = filters.leadStatus = '';
        $('#leads-search').value = ''; $('#leads-product-filter').value = ''; $('#leads-status-filter').value = '';
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
      if (action === 'edit-application') applicationModal(id);
      if (action === 'delete-application') {
        const a = applications.find(x => x.id === id);
        if (a) confirmDialog('Delete this application?', (a.applicant || 'This application') + ' will be removed.', () => {
          applications = applications.filter(x => x.id !== id);
          save.applications(); apps = applications;
          renderAll();
          toast('Application deleted.');
        });
      }
      if (action === 'toggle-notification') {
        const n = notifications.find(x => x.id === id);
        if (n) { n.read = !n.read; save.notifications(); renderAll(); }
      }
      if (action === 'delete-notification') {
        if (String(id).indexOf('NTF-SLA-') === 0) {
          try { const d = new Set(JSON.parse(localStorage.getItem('as_sla_dismissed')||'[]')); d.add(String(id)); localStorage.setItem('as_sla_dismissed', JSON.stringify(Array.from(d))); } catch(e) {}
        }
        notifications = notifications.filter(x => x.id !== id);
        save.notifications();
        renderAll();
      }
      if (action === 'open-notification') {
        const n = notifications.find(x => x.id === id);
        if (n && !n.read) { n.read = true; n.readAt = nowISO(); save.notifications(); }
        const notifMenu = $('#notif-menu');
        if (notifMenu) notifMenu.classList.remove('open');
        showView('notifications');
        renderAll();
      }
      if (action === 'go-notifications') {
        const notifMenu = $('#notif-menu');
        if (notifMenu) notifMenu.classList.remove('open');
        showView('notifications');
      }
      // application actions removed
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
      if (action === 'publish-google-review') {
        const grid = btn.dataset.grid || id;
        const list = $('#google-reviews-list');
        const reviews = list && Array.isArray(list._googleReviews) ? list._googleReviews : [];
        const rv = reviews.find(r => String(r.id) === String(grid));
        if (!rv) { toast('Review not found.', 'error'); return; }
        const exists = testimonials.some(t => String(t.googleReviewId || '') === String(rv.id));
        if (exists) { toast('This review is already added.', 'error'); return; }
        testimonials.unshift({
          id: uid('TST-', 3),
          name: rv.author || 'Google user',
          quote: rv.text || '',
          product: 'Google Review',
          location: rv.placeName || 'Google Maps',
          date: rv.time ? rv.time.slice(0,10) : new Date().toISOString().slice(0,10),
          published: true,
          rating: Number(rv.rating) || 5,
          googleReviewId: rv.id,
          source: 'google_maps'
        });
        save.testimonials();
        renderAll();
        fetchGoogleReviewsUI();
        toast('Google review added to website testimonials.');
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
      if (currentView === 'overview') renderOverview();
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
  let restoringSession = false;
  async function restoreSession() {
    if (restoringSession) return;
    restoringSession = true;
    const api = window.ASBackend;
    const loginBox = document.querySelector('.login-box');
    const err = $('#login-error');
    if (err) err.classList.remove('show');
    if (loginBox) loginBox.setAttribute('aria-busy', 'true');
    try {
      if (!api || !api.session) { showLogin(); return; }
      const available = await api.available(true).catch(() => false);
      if (!available) { showLogin(); return; }
      const session = await api.session().catch(() => null);
      if (session && isAllowedAdminRole(session)) {
        enterApp(session, true);
        return;
      }
    } catch (e) {
      // fall through to login
    } finally {
      restoringSession = false;
      if (loginBox) loginBox.removeAttribute('aria-busy');
    }
    showLogin();
  }

  function init() {
    clearSampleDataOnce();
    loadData();
    bindEvents();
    const api = window.ASBackend;
    if (api && api.request && !api.__admin401Wrapped) {
      const orig = api.request.bind(api);
      api.request = function (path, options) {
        return orig(path, options).catch((err) => {
          if (err && err.status === 401 && !String(path || '').includes('api/login') && !String(path || '').includes('api/session')) {
            const loginVisible = !$('#login-screen').classList.contains('hidden');
            if (!loginVisible && !restoringSession) {
              currentUser = null;
              showLogin('Your session expired. Please sign in again.');
            }
          }
          throw err;
        });
      };
      api.__admin401Wrapped = true;
    }
    $('#login-year').textContent = new Date().getFullYear();
    try {
      pendingResetToken = (new URLSearchParams(location.search).get('reset') || '').trim();
    } catch (e) { pendingResetToken = ''; }
    // If a password reset token is present, show login/reset flow. Otherwise
    // restore an existing authenticated session to avoid login/dashboard flicker.
    if (pendingResetToken) {
      showLogin();
      return;
    }
    restoreSession();
  }

  init();
})();

/* ---------- mobile table scroll wrappers ---------- */
(function () {
  function wrapTables(root) {
    (root || document).querySelectorAll('table').forEach((table) => {
      if (table.closest('.table-wrap, .admin-table-wrap, .table-responsive')) return;
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => wrapTables(document));
  else wrapTables(document);
})();
