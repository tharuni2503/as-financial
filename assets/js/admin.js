/* ==========================================================================
   AS Financial — admin dashboard logic
   Data is persisted in localStorage for demo purposes.
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
  const LOGIN = { email: 'admin@asfinancial.in', password: 'AS@2026' };

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

  /* ---------------------------------------------------------------- seeds */
  const HISTORY_NAMES = [
    'Arjun Mehta', 'Pooja Iyer', 'Sai Krishna', 'Farhan Ali', 'Deepa Nair', 'Manoj Verma', 'Ritu Agarwal', 'Kiran Kumar',
    'Shalini Rao', 'Imran Sheikh', 'Divya Menon', 'Rahul Jain', 'Anitha Reddy', 'Vamshi Goud', 'Rohit Sharma', 'Meera Joshi',
    'Naresh Naidu', 'Sana Fatima', 'Prakash Rao', 'Swathi Kulkarni', 'Yashwant Rao', 'Bhavana Sree', 'Ajay Chauhan', 'Rehana Begum',
    'Sandeep Yadav', 'Keerthi Rao', 'Vivek Anand', 'Nandini Rao', 'Harish Babu', 'Sarita Devi', 'Gopal Krishna', 'Shruti Patel'
  ];
  const HISTORY_PRODUCTS = ['Home Loan', 'Personal Loan', 'Business Loan', 'Mortgage / LAP', 'Education Loan', 'Car Loan', 'Plot / Land Loan'];
  const HISTORY_STATUS = ['Disbursed', 'Lost', 'Sanctioned', 'Contacted', 'Documents', 'Contacted', 'Disbursed', 'Lost'];
  const HISTORY_SOURCES = ['Website form', 'Referral', 'WhatsApp', 'Walk-in', 'Phone call', 'Homepage popup'];
  const HISTORY_CITIES = ['Medipalli', 'Uppal', 'Dilsukhnagar', 'Secunderabad', 'Ghatkesar', 'Nacharam', 'Malakpet', 'Ramanthapur'];

  function seedLeads() {
    const recent = [
      { id: 'ASL-1001', name: 'Ramesh Kumar', phone: '9848012345', email: 'ramesh.k@gmail.com', product: 'Home Loan', amount: 4800000, source: 'Website form', status: 'New', priority: 'High', city: 'Medipalli', employment: 'Salaried', message: 'Looking to purchase a 2BHK flat near Medipalli. Need help with eligibility.', owner: 'Unassigned', createdAt: daysAgo(0), notes: [] },
      { id: 'ASL-1002', name: 'Dr. Sneha Priya', phone: '9866123456', email: 'sneha@clinic.in', product: 'Business Loan', amount: 3500000, source: 'Referral', status: 'Qualified', priority: 'High', city: 'Uppal', employment: 'Self-employed', message: 'Setting up a new clinic, needs equipment finance and working capital.', owner: 'Admin', createdAt: daysAgo(1), notes: [{ text: 'Spoke on phone. Sharing 2 years ITR and GST returns.', at: daysAgo(0) }] },
      { id: 'ASL-1003', name: 'Anand Varma', phone: '9701234567', email: 'anand.v@outlook.com', product: 'Balance Transfer', amount: 6200000, source: 'Phone call', status: 'Documents', priority: 'Medium', city: 'Dilsukhnagar', employment: 'Salaried', message: 'Current EMI is high. Wants to transfer home loan and reduce tenure.', owner: 'Admin', createdAt: daysAgo(2), notes: [] },
      { id: 'ASL-1004', name: 'Priya Reddy', phone: '9959012345', email: 'priya.reddy@gmail.com', product: 'Personal Loan', amount: 800000, source: 'Homepage popup', status: 'Contacted', priority: 'Medium', city: 'Ghatkesar', employment: 'Salaried', message: 'Wedding expenses in February.', owner: 'Unassigned', createdAt: daysAgo(3), notes: [] },
      { id: 'ASL-1005', name: 'Mohammed Irfan', phone: '9000123456', email: 'irfan@yahoo.com', product: 'Home Loan', amount: 7500000, source: 'WhatsApp', status: 'Qualified', priority: 'High', city: 'Secunderabad', employment: 'Business owner', message: 'Buying an independent house, needs 80% funding.', owner: 'Admin', createdAt: daysAgo(4), notes: [] },
      { id: 'ASL-1006', name: 'Lakshmi Narayana', phone: '9440123456', email: 'lakshmi.n@gmail.com', product: 'Education Loan', amount: 2500000, source: 'Website form', status: 'New', priority: 'Medium', city: 'Medipalli', employment: 'Salaried', message: 'Daughter admitted to a university in Canada for a master’s programme.', owner: 'Unassigned', createdAt: daysAgo(5), notes: [] },
      { id: 'ASL-1007', name: 'Suresh Babu', phone: '9849012346', email: 'suresh.babu@gmail.com', product: 'Mortgage / LAP', amount: 9000000, source: 'Walk-in', status: 'Sanctioned', priority: 'High', city: 'Nacharam', employment: 'Self-employed', message: 'Loan against commercial property for business expansion.', owner: 'Admin', createdAt: daysAgo(6), notes: [{ text: 'Sanction letter received from HDB Financial. Awaiting disbursal date.', at: daysAgo(1) }] },
      { id: 'ASL-1008', name: 'Kavita Sharma', phone: '9876543210', email: 'kavita.sharma@gmail.com', product: 'Home Loan', amount: 5200000, source: 'Website form', status: 'Contacted', priority: 'Low', city: 'Hyderabad', employment: 'Salaried', message: 'First-time buyer, comparing rates.', owner: 'Unassigned', createdAt: daysAgo(7), notes: [] },
      { id: 'ASL-1009', name: 'Naveen Reddy', phone: '9701122334', email: 'naveen.reddy@gmail.com', product: 'Plot / Land Loan', amount: 4000000, source: 'Referral', status: 'Lost', priority: 'Medium', city: 'Ghatkesar', employment: 'Business owner', message: 'Plot purchase near Ghatkesar.', owner: 'Admin', createdAt: daysAgo(9), notes: [{ text: 'Property documents incomplete. Client will revisit next quarter.', at: daysAgo(5) }] },
      { id: 'ASL-1010', name: 'Ayesha Begum', phone: '9966332211', email: 'ayesha.b@gmail.com', product: 'Personal Loan', amount: 1200000, source: 'Homepage popup', status: 'New', priority: 'High', city: 'Malakpet', employment: 'Salaried', message: 'Medical expenses, needs funds urgently.', owner: 'Unassigned', createdAt: daysAgo(10), notes: [] },
      { id: 'ASL-1011', name: 'Vikram Singh', phone: '9848998877', email: 'vikram.s@gmail.com', product: 'Car Loan', amount: 1500000, source: 'WhatsApp', status: 'Contacted', priority: 'Low', city: 'Uppal', employment: 'Salaried', message: 'New SUV purchase, exchanging an old car.', owner: 'Unassigned', createdAt: daysAgo(12), notes: [] },
      { id: 'ASL-1012', name: 'Srinivas Rao', phone: '9050607080', email: 'srini.rao@gmail.com', product: 'Business Loan', amount: 5000000, source: 'Phone call', status: 'Disbursed', priority: 'High', city: 'Medipalli', employment: 'Business owner', message: 'Working capital for a hardware distribution business.', owner: 'Admin', createdAt: daysAgo(15), notes: [{ text: 'Disbursed by Bajaj Finserv. Client onboarded for annual rate review.', at: daysAgo(2) }] },
      { id: 'ASL-1013', name: 'Neha Gupta', phone: '9988776655', email: 'neha.gupta@gmail.com', product: 'NRI Home Loan', amount: 11000000, source: 'Referral', status: 'Qualified', priority: 'High', city: 'Hyderabad', employment: 'NRI', message: 'Buying an apartment in Hyderabad while working in Dubai.', owner: 'Admin', createdAt: daysAgo(18), notes: [] },
      { id: 'ASL-1014', name: 'Rajesh Yadav', phone: '9123456780', email: 'rajesh.y@gmail.com', product: 'Gold Loan', amount: 700000, source: 'Walk-in', status: 'Lost', priority: 'Low', city: 'Ramanthapur', employment: 'Self-employed', message: 'Short-term funds against gold jewellery.', owner: 'Unassigned', createdAt: daysAgo(22), notes: [] }
    ];

    // Historical enquiries spread across the last 7 months so trends are meaningful.
    const history = HISTORY_NAMES.map((name, i) => {
      const monthsBack = 1 + Math.floor(i / 5);
      const d = new Date();
      d.setMonth(d.getMonth() - monthsBack, 3 + (i % 5) * 5);
      d.setHours(10 + (i % 8), (i * 7) % 60, 0, 0);
      const slug = name.toLowerCase().replace(/[^a-z]+/g, '.');
      return {
        id: 'ASL-' + (2001 + i),
        name,
        phone: '98' + String(76000000 + i * 12345),
        email: slug + '@gmail.com',
        product: HISTORY_PRODUCTS[i % HISTORY_PRODUCTS.length],
        amount: 800000 + (i % 7) * 950000,
        source: HISTORY_SOURCES[i % HISTORY_SOURCES.length],
        status: HISTORY_STATUS[i % HISTORY_STATUS.length],
        priority: ['High', 'Medium', 'Low'][i % 3],
        city: HISTORY_CITIES[i % HISTORY_CITIES.length],
        employment: ['Salaried', 'Self-employed', 'Business owner'][i % 3],
        message: 'Enquiry from ' + HISTORY_CITIES[i % HISTORY_CITIES.length] + ' for a ' + HISTORY_PRODUCTS[i % HISTORY_PRODUCTS.length] + '.',
        owner: i % 4 === 0 ? 'Unassigned' : 'Admin',
        createdAt: d.toISOString(),
        notes: []
      };
    });

    return recent.concat(history);
  }

  function seedApplications() {
    return [
      { id: 'ASF-1042', customer: 'Ramesh Kumar', phone: '9848012345', product: 'Home Loan', amount: 4800000, lender: 'HDFC Bank', stage: 'Underwriting', rate: 8.45, appliedAt: daysAgo(3), sanctionedAt: '', owner: 'Admin', notes: 'Credit team requested latest 3-month salary slips.' },
      { id: 'ASF-1041', customer: 'Dr. Sneha Priya', phone: '9866123456', product: 'Business Loan', amount: 3500000, lender: 'Bajaj Finserv', stage: 'Sanctioned', rate: 13.25, appliedAt: daysAgo(8), sanctionedAt: daysAgo(2), owner: 'Admin', notes: 'Sanction letter received. Disbursal scheduled after property visit.' },
      { id: 'ASF-1040', customer: 'Anand Varma', phone: '9701234567', product: 'Balance Transfer', amount: 6200000, lender: 'ICICI Bank', stage: 'Documents', rate: 8.55, appliedAt: daysAgo(5), sanctionedAt: '', owner: 'Admin', notes: 'Waiting for existing loan statement and foreclosure letter.' },
      { id: 'ASF-1039', customer: 'Priya Reddy', phone: '9959012345', product: 'Personal Loan', amount: 800000, lender: 'Tata Capital', stage: 'Disbursed', rate: 11.20, appliedAt: daysAgo(12), sanctionedAt: daysAgo(6), owner: 'Admin', notes: 'Disbursed directly to client account.' },
      { id: 'ASF-1038', customer: 'Mohammed Irfan', phone: '9000123456', product: 'Home Loan', amount: 7500000, lender: 'SBI', stage: 'Sanctioned', rate: 8.50, appliedAt: daysAgo(14), sanctionedAt: daysAgo(4), owner: 'Admin', notes: 'Sanction letter issued. Legal verification complete.' },
      { id: 'ASF-1037', customer: 'Lakshmi Narayana', phone: '9440123456', product: 'Education Loan', amount: 2500000, lender: 'Canara Bank', stage: 'Logged', rate: 9.10, appliedAt: daysAgo(2), sanctionedAt: '', owner: 'Unassigned', notes: 'Awaiting university offer letter.' },
      { id: 'ASF-1036', customer: 'Suresh Babu', phone: '9849012346', product: 'Mortgage / LAP', amount: 9000000, lender: 'HDB Financial', stage: 'Underwriting', rate: 9.65, appliedAt: daysAgo(18), sanctionedAt: '', owner: 'Admin', notes: 'Property valuation scheduled this week.' },
      { id: 'ASF-1035', customer: 'Kavita Sharma', phone: '9876543210', product: 'Home Loan', amount: 5200000, lender: 'Axis Bank', stage: 'Documents', rate: 8.60, appliedAt: daysAgo(20), sanctionedAt: '', owner: 'Admin', notes: 'Collecting Form 16 and 6-month bank statement.' },
      { id: 'ASF-1034', customer: 'Naveen Reddy', phone: '9701122334', product: 'Plot / Land Loan', amount: 4000000, lender: 'PNB Housing', stage: 'Rejected', rate: 9.90, appliedAt: daysAgo(30), sanctionedAt: '', owner: 'Admin', notes: 'Rejected due to unclear property title.' },
      { id: 'ASF-1033', customer: 'Srinivas Rao', phone: '9050607080', product: 'Business Loan', amount: 5000000, lender: 'Bajaj Finserv', stage: 'Disbursed', rate: 12.75, appliedAt: daysAgo(45), sanctionedAt: daysAgo(30), owner: 'Admin', notes: 'Disbursed. Annual review in 11 months.' },
      { id: 'ASF-1032', customer: 'Ayesha Begum', phone: '9966332211', product: 'Personal Loan', amount: 1200000, lender: 'IIFL Finance', stage: 'Sanctioned', rate: 11.75, appliedAt: daysAgo(52), sanctionedAt: daysAgo(38), owner: 'Admin', notes: 'Awaiting borrower signature on agreement.' },
      { id: 'ASF-1031', customer: 'Vikram Singh', phone: '9848998877', product: 'Car Loan', amount: 1500000, lender: 'HDFC Bank', stage: 'Disbursed', rate: 8.90, appliedAt: daysAgo(70), sanctionedAt: daysAgo(60), owner: 'Admin', notes: 'Vehicle delivered. Loan active.' },
      { id: 'ASF-1030', customer: 'Neha Gupta', phone: '9988776655', product: 'NRI Home Loan', amount: 11000000, lender: 'ICICI Bank', stage: 'Sanctioned', rate: 8.65, appliedAt: daysAgo(95), sanctionedAt: daysAgo(75), owner: 'Admin', notes: 'POA verification pending from Dubai.' },
      { id: 'ASF-1029', customer: 'Rajesh Yadav', phone: '9123456780', product: 'Gold Loan', amount: 700000, lender: 'Muthoot Finance', stage: 'Disbursed', rate: 9.50, appliedAt: daysAgo(120), sanctionedAt: daysAgo(118), owner: 'Admin', notes: 'Short-tenure gold loan, closed early.' }
    ];
  }

  function seedProducts() {
    return [
      { id: 'PRD-01', name: 'Home Loan', icon: 'home', category: 'Property', rate: 8.35, maxAmount: 100000000, tenure: '30 years', visible: true, description: 'Purchase, construction, renovation and top-up loans for residential property.' },
      { id: 'PRD-02', name: 'Personal Loan', icon: 'user', category: 'Retail', rate: 10.50, maxAmount: 5000000, tenure: '7 years', visible: true, description: 'Collateral-free funding for weddings, travel, medical needs and more.' },
      { id: 'PRD-03', name: 'Business Loan', icon: 'briefcase', category: 'Business', rate: 12.00, maxAmount: 20000000, tenure: '7 years', visible: true, description: 'Working capital and expansion finance for MSMEs and proprietors.' },
      { id: 'PRD-04', name: 'Mortgage / LAP', icon: 'key', category: 'Property', rate: 9.25, maxAmount: 100000000, tenure: '15 years', visible: true, description: 'Loan against residential or commercial property.' },
      { id: 'PRD-05', name: 'Education Loan', icon: 'graduation', category: 'Retail', rate: 8.75, maxAmount: 15000000, tenure: '15 years', visible: true, description: 'Higher studies in India and abroad with moratorium support.' },
      { id: 'PRD-06', name: 'Plot / Land Loan', icon: 'plot', category: 'Property', rate: 9.50, maxAmount: 50000000, tenure: '15 years', visible: true, description: 'Purchase of residential or commercial plots.' },
      { id: 'PRD-07', name: 'Car Loan', icon: 'car', category: 'Retail', rate: 8.75, maxAmount: 5000000, tenure: '7 years', visible: true, description: 'New and used car and two-wheeler finance.' },
      { id: 'PRD-08', name: 'Doctor Loan', icon: 'stethoscope', category: 'Business', rate: 10.25, maxAmount: 10000000, tenure: '10 years', visible: true, description: 'Clinic setup, equipment and practice expansion loans.' },
      { id: 'PRD-09', name: 'Balance Transfer', icon: 'transfer', category: 'Retail', rate: 8.40, maxAmount: 50000000, tenure: '25 years', visible: true, description: 'Transfer an existing loan for a lower EMI or take a top-up.' },
      { id: 'PRD-10', name: 'Insurance', icon: 'shield', category: 'Protection', rate: 0, maxAmount: 0, tenure: '—', visible: true, description: 'Life, health and general insurance solutions.' }
    ];
  }

  function seedPartners() {
    return [
      { id: 'BNK-01', name: 'State Bank of India', type: 'Public sector', rate: 8.50, active: true, applications: 24, sanctioned: 19, approval: 79 },
      { id: 'BNK-02', name: 'HDFC Bank', type: 'Private bank', rate: 8.35, active: true, applications: 31, sanctioned: 24, approval: 77 },
      { id: 'BNK-03', name: 'ICICI Bank', type: 'Private bank', rate: 8.45, active: true, applications: 27, sanctioned: 21, approval: 78 },
      { id: 'BNK-04', name: 'Axis Bank', type: 'Private bank', rate: 8.60, active: true, applications: 18, sanctioned: 13, approval: 72 },
      { id: 'BNK-05', name: 'Kotak Mahindra Bank', type: 'Private bank', rate: 8.55, active: true, applications: 14, sanctioned: 11, approval: 79 },
      { id: 'BNK-06', name: 'Bank of Baroda', type: 'Public sector', rate: 8.55, active: true, applications: 12, sanctioned: 9, approval: 75 },
      { id: 'BNK-07', name: 'Canara Bank', type: 'Public sector', rate: 8.50, active: true, applications: 11, sanctioned: 8, approval: 73 },
      { id: 'BNK-08', name: 'Union Bank of India', type: 'Public sector', rate: 8.55, active: true, applications: 9, sanctioned: 6, approval: 67 },
      { id: 'BNK-09', name: 'Punjab National Bank', type: 'Public sector', rate: 8.60, active: true, applications: 8, sanctioned: 6, approval: 75 },
      { id: 'BNK-10', name: 'Indian Bank', type: 'Public sector', rate: 8.65, active: false, applications: 5, sanctioned: 3, approval: 60 },
      { id: 'BNK-11', name: 'IDFC FIRST Bank', type: 'Private bank', rate: 8.70, active: true, applications: 12, sanctioned: 9, approval: 75 },
      { id: 'BNK-12', name: 'Yes Bank', type: 'Private bank', rate: 8.90, active: false, applications: 6, sanctioned: 4, approval: 67 },
      { id: 'BNK-13', name: 'Federal Bank', type: 'Private bank', rate: 8.75, active: true, applications: 7, sanctioned: 5, approval: 71 },
      { id: 'BNK-14', name: 'IndusInd Bank', type: 'Private bank', rate: 8.80, active: true, applications: 8, sanctioned: 6, approval: 75 },
      { id: 'BNK-15', name: 'Bajaj Housing Finance', type: 'NBFC / HFC', rate: 8.40, active: true, applications: 22, sanctioned: 18, approval: 82 },
      { id: 'BNK-16', name: 'Tata Capital', type: 'NBFC / HFC', rate: 8.90, active: true, applications: 15, sanctioned: 11, approval: 73 },
      { id: 'BNK-17', name: 'L&T Finance', type: 'NBFC / HFC', rate: 9.10, active: true, applications: 10, sanctioned: 7, approval: 70 },
      { id: 'BNK-18', name: 'LIC Housing Finance', type: 'NBFC / HFC', rate: 8.45, active: true, applications: 16, sanctioned: 13, approval: 81 },
      { id: 'BNK-19', name: 'HDB Financial Services', type: 'NBFC / HFC', rate: 9.65, active: true, applications: 12, sanctioned: 9, approval: 75 },
      { id: 'BNK-20', name: 'Muthoot Finance', type: 'NBFC / HFC', rate: 9.50, active: true, applications: 6, sanctioned: 5, approval: 83 }
    ];
  }

  function seedTestimonials() {
    return [
      { id: 'TST-01', name: 'Donthuri Aravind Goud', location: 'Google review', product: 'Personal loan', quote: 'I had a very good experience with their service. They provided excellent support and helped me process my personal loan very quickly. The process was smooth, simple, and hassle-free. The staff were very helpful and responsive throughout the process. Highly recommended for their fast and professional service.', published: true, date: daysAgo(30) },
      { id: 'TST-02', name: 'Asarla Kumar', location: 'Google review', product: 'Home loan', quote: 'Very happy with the home loan service. The team explained everything clearly, handled the documentation properly and completed the process much faster than I expected. Good communication and professional support from start to finish — thank you for the excellent service.', published: true, date: daysAgo(34) },
      { id: 'TST-03', name: 'Sudhakar Sindhu', location: 'Google review', product: 'Financial services', quote: 'Excellent Financial Services & Solutions! I had a very positive experience with their services. The team is professional, supportive, and provides clear and honest guidance throughout the process.', published: true, date: daysAgo(38) },
      { id: 'TST-04', name: 'Rakhi Rakesh', location: 'Google review', product: 'Loan assistance', quote: 'Excellent DSA office with professional staff and quick service. Good support throughout the loan process. Highly recommended.', published: false, date: daysAgo(46) },
      { id: 'TST-05', name: 'Tharuni Lodi', location: 'Google review', product: 'Loan assistance', quote: 'Excellent service! Friendly team, clear guidance, and professional support. Highly recommended!', published: false, date: daysAgo(54) },
      { id: 'TST-06', name: 'D. Pranitha', location: 'Google review', product: 'Home loan', quote: 'I had a very good experience with AS Finance. The staff were friendly and helpful, and the home loan process was smooth and easy.', published: false, date: daysAgo(63) },
      { id: 'TST-07', name: 'Radhika Mahesh', location: 'Google review', product: 'Financial services', quote: 'Well experienced team with excellent customer support. Highly recommended.', published: false, date: daysAgo(78) },
      { id: 'TST-08', name: 'Sukanya Lodi', location: 'Google review', product: 'Financial guidance', quote: 'Very helpful team with professional service and good customer support. A great place for financial guidance!', published: false, date: daysAgo(95) },
      { id: 'TST-09', name: 'Santhosh Kumar', location: 'Google review', product: 'Loan assistance', quote: 'Best service.', published: false, date: daysAgo(120) }
    ];
  }

  function seedPosts() {
    return [
      { id: 'BLG-01', title: 'Documents you actually need for a home loan', category: 'Home loans', excerpt: 'KYC, salary slips, bank statements, ITR — a lender-by-lender checklist for salaried and self-employed buyers.', readTime: '6 min', published: true, date: daysAgo(6) },
      { id: 'BLG-02', title: '5 practical ways to improve your CIBIL score before applying', category: 'Credit health', excerpt: 'Small changes in utilisation and repayment history can move your score — and your interest rate.', readTime: '4 min', published: true, date: daysAgo(14) },
      { id: 'BLG-03', title: 'When a home loan balance transfer actually saves you money', category: 'Balance transfer', excerpt: 'Run the numbers on fees, remaining tenure and reset dates before switching lenders.', readTime: '5 min', published: true, date: daysAgo(32) },
      { id: 'BLG-04', title: 'Plot loan or composite loan: which one should you choose?', category: 'Property', excerpt: 'A simple comparison for buyers planning to build within the next two years.', readTime: '5 min', published: false, date: daysAgo(48) }
    ];
  }

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

  function seedGallery() {
    return [
      { id: 'GAL-01', src: 'assets/img/gallery/banner.jpg', caption: 'Signboard & services banner', alt: 'AS Financial Services and Solutions signboard banner' },
      { id: 'GAL-02', src: 'assets/img/gallery/storefront.jpg', caption: 'Our office in Medipalli', alt: 'Our office in Medipalli, Hyderabad' },
      { id: 'GAL-03', src: 'assets/img/gallery/instant.jpg', caption: 'Instant loan support', alt: 'Instant loan support poster' },
      { id: 'GAL-04', src: 'assets/img/gallery/dreams.jpg', caption: 'Your dreams, our financial support', alt: 'Your dreams, our financial support poster' },
      { id: 'GAL-05', src: 'assets/img/gallery/partner.jpg', caption: 'Loan types we arrange', alt: 'Your trusted financial partner: loan types' },
      { id: 'GAL-06', src: 'assets/img/gallery/services.jpg', caption: 'Services & specialised profiles', alt: 'All loan services and specialised profiles' },
      { id: 'GAL-07', src: 'assets/img/gallery/banks.jpg', caption: 'Bank & NBFC partners', alt: 'Our bank and NBFC partners' }
    ];
  }

  function seedTasks() {
    return [
      { id: 'TSK-01', text: 'Call Ramesh Kumar with HDFC Bank rate confirmation', due: 'Today, 11:00 AM', done: false },
      { id: 'TSK-02', text: 'Collect pending bank statements from Kavita Sharma', due: 'Today, 2:30 PM', done: false },
      { id: 'TSK-03', text: 'Follow up with ICICI on Anand Varma foreclosure letter', due: 'Today, 4:00 PM', done: false },
      { id: 'TSK-04', text: 'Send sanction letter to Mohammed Irfan', due: 'Tomorrow', done: true },
      { id: 'TSK-05', text: 'Weekly pipeline review with the team', due: 'Saturday', done: false }
    ];
  }

  function seedAll(force) {
    window.__asSeeding = true;
    if (force || localStorage.getItem('as_leads') === null) store.set('as_leads', seedLeads());
    if (force || localStorage.getItem('as_applications') === null) store.set('as_applications', seedApplications());
    if (force || localStorage.getItem('as_products') === null) store.set('as_products', seedProducts());
    if (force || localStorage.getItem('as_partners') === null) store.set('as_partners', seedPartners());
    const existingTestimonials = store.get('as_testimonials', null);
    const legacyThree = Array.isArray(existingTestimonials) && existingTestimonials.length === 3 && existingTestimonials.some(t => t.id === 'TST-01' && t.name === 'D. Pranitha');
    if (force || existingTestimonials === null || legacyThree) store.set('as_testimonials', seedTestimonials());
    if (force || localStorage.getItem('as_posts') === null) store.set('as_posts', seedPosts());
    if (force || localStorage.getItem('as_content_images') === null) store.set('as_content_images', {});
    if (force || localStorage.getItem('as_gallery') === null) store.set('as_gallery', seedGallery());
    if (force || localStorage.getItem('as_tasks') === null) store.set('as_tasks', seedTasks());
    if (force || localStorage.getItem('as_settings') === null) store.set('as_settings', DEFAULT_SETTINGS);
    window.__asSeeding = false;
  }

  /* ---------------------------------------------------------------- state */
  let leads = [], apps = [], products = [], partners = [], testimonials = [], posts = [], contentImages = {}, gallery = [], tasks = [], settings = {};
  let leadPage = 1, appPage = 1;
  const PAGE_SIZE = 8;
  const filters = { leadSearch: '', leadProduct: '', leadStatus: '', leadSource: '', appSearch: '', appLender: '', appStage: 'all', partnerType: '' };
  let currentView = 'overview';
  let activeLeadId = null;
  let charts = {};

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
    settings = Object.assign({}, DEFAULT_SETTINGS, store.get('as_settings', {}));
    settings.notifications = Object.assign({}, DEFAULT_SETTINGS.notifications, settings.notifications || {});
    if (!Array.isArray(leads)) leads = [];
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
    if (!api || !api.token || !api.token() || syncingEnquiries) return;
    syncingEnquiries = true;
    api.request('api/enquiries')
      .then((data) => {
        const list = (data && Array.isArray(data.enquiries)) ? data.enquiries : [];
        const serverLeads = list.map(mapServerEnquiry);
        const local = leads.filter(l => !l._server);
        leads = serverLeads.concat(local);
        renderAll();
      })
      .catch(() => { /* backend unavailable or session expired */ })
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
  function showLogin() {
    $('#login-screen').classList.remove('hidden');
    $('#admin-app').classList.add('hidden');
    document.body.style.overflow = '';
  }

  function enterApp(remember) {
    $('#login-screen').classList.add('hidden');
    $('#admin-app').classList.remove('hidden');
    const email = LOGIN.email;
    const name = 'Admin';
    $('#sidebar-user-name').textContent = name;
    $('#topbar-user').textContent = name;
    $('#sidebar-avatar').textContent = initials(name);
    $('#topbar-avatar').textContent = initials(name);
    $('#greeting-name').textContent = name;
    const d = new Date();
    $('#topbar-date').textContent = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('#last-signin').textContent = 'Today, ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    if (remember) localStorage.setItem('as_admin_session', email);
    sessionStorage.setItem('as_admin_session', email);
    loadData();
    renderAll();
    syncServerEnquiries();
    setView('overview', true);
  }

  function logout() {
    sessionStorage.removeItem('as_admin_session');
    localStorage.removeItem('as_admin_session');
    showLogin();
    toast('You have been signed out.');
  }

  /* ---------------------------------------------------------------- navigation */
  const VIEW_TITLES = {
    overview: 'Overview', leads: 'Leads', applications: 'Applications', reports: 'Reports',
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
    if (view === 'leads') renderLeads();
    if (view === 'applications') renderApplications();
    if (view === 'reports') renderReports();
    if (view === 'products') renderProducts();
    if (view === 'partners') renderPartners();
    if (view === 'content') renderContent();
    if (view === 'settings') renderSettings();
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
  function renderPartners() {
    const list = partners.filter(p => !filters.partnerType || p.type === filters.partnerType);
    const host = $('#partners-grid');
    if (!list.length) {
      host.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>No partners found</h3><p>Add a bank or NBFC to your panel.</p></div>';
      return;
    }
    host.innerHTML = list.map(p =>
      '<div class="partner-tile-admin">' +
        '<div class="tile-actions">' +
          '<button class="a-btn-icon" data-action="edit-partner" data-id="' + esc(p.id) + '" title="Edit"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
          '<button class="a-btn-icon danger" data-action="delete-partner" data-id="' + esc(p.id) + '" title="Delete"><svg class="icon icon-sm" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
        '</div>' +
        '<b>' + esc(p.name) + '</b>' +
        '<span>' + esc(p.type) + '</span>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
          '<span class="badge badge-' + (p.active ? 'active' : 'inactive') + '">' + (p.active ? 'Active' : 'Paused') + '</span>' +
          '<span style="font-size:.7rem;color:var(--muted)">' + (p.rate ? p.rate.toFixed(2) + '%' : '—') + '</span>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  function partnerModal(id) {
    const p = id ? partners.find(x => x.id === id) : null;
    openModal({
      title: p ? 'Edit partner' : 'Add lending partner',
      sub: 'Lenders shown on the website and in application dropdowns.',
      body:
        '<div class="form-row"><div class="a-field"><label>Partner name <span class="req">*</span></label><input name="name" required value="' + esc(p ? p.name : '') + '" placeholder="e.g. HDFC Bank"></div>' +
        '<div class="a-field"><label>Type</label><select name="type">' + ['Public sector', 'Private bank', 'NBFC / HFC'].map(t => '<option ' + (p && p.type === t ? 'selected' : '') + '>' + t + '</option>').join('') + '</select></div></div>' +
        '<div class="form-row"><div class="a-field"><label>Starting rate (%)</label><input name="rate" type="number" step="0.05" min="0" value="' + esc(p ? p.rate : '') + '"></div>' +
        '<div class="a-field"><label>Status</label><select name="active"><option value="true" ' + (!p || p.active ? 'selected' : '') + '>Active</option><option value="false" ' + (p && !p.active ? 'selected' : '') + '>Paused</option></select></div></div>' +
        '<div class="form-row three"><div class="a-field"><label>Applications</label><input name="applications" type="number" min="0" value="' + esc(p ? p.applications : 0) + '"></div>' +
        '<div class="a-field"><label>Sanctioned</label><input name="sanctioned" type="number" min="0" value="' + esc(p ? p.sanctioned : 0) + '"></div>' +
        '<div class="a-field"><label>Approval rate (%)</label><input name="approval" type="number" min="0" max="100" value="' + esc(p ? p.approval : 0) + '"></div></div>',
      submitLabel: p ? 'Save changes' : 'Add partner',
      onSubmit: (data) => {
        const name = String(data.get('name') || '').trim();
        if (!name) { toast('Partner name is required.', 'error'); return false; }
        const payload = {
          name,
          type: data.get('type'),
          rate: Number(data.get('rate')) || 0,
          active: data.get('active') === 'true',
          applications: Number(data.get('applications')) || 0,
          sanctioned: Number(data.get('sanctioned')) || 0,
          approval: Number(data.get('approval')) || 0
        };
        if (p) { Object.assign(p, payload); toast('Partner updated.'); }
        else { partners.push(Object.assign({ id: uid('BNK-', 2) }, payload)); toast('Partner added.'); }
        save.partners();
        renderAll();
      }
    });
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

  function renderContent() {
    $('#testimonials-list').innerHTML = testimonials.length ? testimonials.map(t =>
      '<div class="content-item">' +
        '<div class="ci-main"><b>' + esc(t.name) + '</b>' +
        '<p>' + esc(t.quote) + '</p>' +
        '<div class="ci-meta"><span>' + esc(t.product) + '</span><span>' + esc(t.location) + '</span><span>' + fmtShort(t.date) + '</span><span class="badge badge-' + (t.published ? 'active' : 'inactive') + '">' + (t.published ? 'Published' : 'Hidden') + '</span></div></div>' +
        '<div class="ci-actions">' +
          '<label class="switch" style="margin-top:4px" title="Show this review on the homepage"><input type="checkbox" data-toggle="testimonial" data-id="' + esc(t.id) + '" aria-label="Show review from ' + esc(t.name) + ' on the homepage" ' + (t.published ? 'checked' : '') + '><span></span></label>' +
          '<button class="a-btn-icon" data-action="edit-testimonial" data-id="' + esc(t.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
          '<button class="a-btn-icon danger" data-action="delete-testimonial" data-id="' + esc(t.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
        '</div></div>'
    ).join('') : '<div class="empty-state"><p>No testimonials yet.</p></div>';

    const summary = $('#testimonials-summary');
    if (summary) {
      const publishedCount = testimonials.filter(t => t.published).length;
      summary.textContent = publishedCount + ' of ' + testimonials.length + ' reviews published. The homepage shows published reviews in this list order. Selections are saved in this browser only.';
    }

    $('#posts-list').innerHTML = posts.length ? posts.map(p =>
      '<div class="content-item">' +
        '<div class="ci-main"><b>' + esc(p.title) + '</b><p>' + esc(p.excerpt) + '</p>' +
        '<div class="ci-meta"><span>' + esc(p.category) + '</span><span>' + esc(p.readTime) + ' read</span><span>' + fmtShort(p.date) + '</span><span class="badge badge-' + (p.published ? 'active' : 'inactive') + '">' + (p.published ? 'Published' : 'Draft') + '</span></div></div>' +
        '<div class="ci-actions">' +
          '<label class="switch" style="margin-top:4px" title="Publish this article on the website"><input type="checkbox" data-toggle="post" data-id="' + esc(p.id) + '" aria-label="Publish article: ' + esc(p.title) + '" ' + (p.published ? 'checked' : '') + '><span></span></label>' +
          '<button class="a-btn-icon" data-action="edit-post" data-id="' + esc(p.id) + '" title="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"></use></svg></button>' +
          '<button class="a-btn-icon danger" data-action="delete-post" data-id="' + esc(p.id) + '" title="Delete"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>' +
        '</div></div>'
    ).join('') : '<div class="empty-state"><p>No articles yet.</p></div>';

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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!modalSubmitHandler) return closeModal();
      const result = modalSubmitHandler(new FormData(form));
      if (result !== false) closeModal();
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
    // login
    $('#login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#login-email').value.trim().toLowerCase();
      const pass = $('#login-password').value;
      if (email === LOGIN.email && pass === LOGIN.password) {
        $('#login-error').classList.remove('show');
        enterApp(true);
      } else {
        $('#login-error').classList.add('show');
      }
    });

    // logout
    ['logout-btn', 'sidebar-logout'].forEach(id => {
      const el = $('#' + id);
      if (el) el.addEventListener('click', logout);
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
    $('#add-gallery-btn').addEventListener('click', () => {
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

    $('#reset-data-btn').addEventListener('click', () => {
      confirmDialog('Reset demo data?', 'All leads, applications, products, partners and content will be replaced with the sample dataset.', () => {
        ['as_leads', 'as_applications', 'as_products', 'as_partners', 'as_testimonials', 'as_posts', 'as_tasks', 'as_settings'].forEach(store.remove);
        seedAll(true);
        loadData();
        renderAll();
        toast('Demo data restored.');
      });
    });

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
          if (l._server && window.ASBackend && window.ASBackend.token && window.ASBackend.token()) {
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
    seedAll(false);
    loadData();
    bindEvents();
    $('#login-year').textContent = new Date().getFullYear();
    const session = sessionStorage.getItem('as_admin_session') || localStorage.getItem('as_admin_session');
    if (session) {
      enterApp(false);
      const hash = location.hash.replace('#', '');
      if (VIEW_TITLES[hash]) setView(hash, true);
    } else {
      showLogin();
    }
  }

  init();
})();
