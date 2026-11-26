/* AS Financial - simple AI assistant (website knowledge + lead capture fallback) */
(function () {
  'use strict';

  const launcher = document.getElementById('as-assistant-launcher');
  const panel = document.getElementById('as-assistant-panel');
  const closeBtn = document.getElementById('as-assistant-close');
  const messages = document.getElementById('as-assistant-messages');
  const quick = document.getElementById('as-assistant-quick');
  const form = document.getElementById('as-assistant-form');
  const input = document.getElementById('as-assistant-input');
  if (!launcher || !panel || !messages || !form || !input) return;

  const settings = Object.assign({
    phone: '+91 91827 03079',
    phoneRaw: '919182703079',
    email: 'asfinancialservicesandsolution@gmail.com',
    address: 'Panchavati Colony Road No. 1, Medipalli, Hyderabad, Telangana 500098',
    hours: 'Mon – Sat · 9:30 AM – 7:00 PM',
    whatsapp: '919182703079'
  }, (function(){ try { return JSON.parse(localStorage.getItem('as_settings')||'{}'); } catch(e){ return {}; } })());

  const phoneDigits = String(settings.phoneRaw || settings.whatsapp || '919182703079').replace(/[^\d]/g, '');
  const waLink = 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent('Hi AS Financial, I need help with a loan.');
  const telLink = 'tel:+' + phoneDigits;

  function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function safeHref(href) {
    const value = String(href || '');
    if (/^tel:\+?\d{8,15}$/.test(value)) return value;
    if (/^https:\/\/wa\.me\/\d{8,15}(\?|$)/.test(value)) return value;
    if (/^contact\.html#contact-form$/.test(value)) return value;
    return 'contact.html#contact-form';
  }

  messages.setAttribute('aria-live', 'polite');
  messages.setAttribute('aria-relevant', 'additions');

  function addMsg(text, who, html) {
    const div = document.createElement('div');
    div.className = 'as-msg ' + (who === 'user' ? 'as-msg-user' : 'as-msg-bot');
    if (html) div.innerHTML = text; else div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  function setQuick(items) {
    quick.innerHTML = '';
    (items || []).forEach(label => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'as-quick-btn';
      b.textContent = label;
      b.addEventListener('click', () => handleUser(label));
      quick.appendChild(b);
    });
  }

  function contactCta() {
    return '<div class="as-cta-row">' +
      '<a class="as-cta" href="' + esc(safeHref(telLink)) + '">Call now</a>' +
      '<a class="as-cta" href="' + esc(safeHref(waLink)) + '" target="_blank" rel="noopener noreferrer">WhatsApp</a>' +
      '<a class="as-cta" href="' + esc(safeHref('contact.html#contact-form')) + '">Contact form</a>' +
      '</div>';
  }

  function leadCapture() {
    addMsg('If you\'d like, share your details and our team will contact you. You can also apply directly.', 'bot');
    addMsg('<form class="as-lead-form" id="as-lead-mini">' +
      '<input name="name" type="text" placeholder="Your name" aria-label="Your name" required maxlength="80">' +
      '<input name="phone" type="tel" placeholder="Mobile number" aria-label="Mobile number" inputmode="tel" autocomplete="tel" required maxlength="20">' +
      '<select name="product" aria-label="Loan type"><option value="General enquiry">Loan type</option><option>Home Loan</option><option>Personal Loan</option><option>Business Loan</option><option>Loan Against Property</option><option>Vehicle Loan</option><option>Balance Transfer</option></select>' +
      '<button type="submit">Request callback</button>' +
      '</form>' + contactCta(), 'bot', true);
    const mini = document.getElementById('as-lead-mini');
    if (mini) mini.addEventListener('submit', async function(e){
      e.preventDefault();
      const fd = new FormData(mini);
      const name = String(fd.get('name')||'').trim();
      const phone = String(fd.get('phone')||'').trim();
      let digits = phone.replace(/\D/g,'');
      if ((digits.length === 12 || digits.length === 13) && digits.indexOf('91') === 0) digits = digits.slice(2);
      if (digits.length === 13 && digits.indexOf('091') === 0) digits = digits.slice(3);
      if (name.length < 2) { addMsg('Please enter your name.', 'bot'); return; }
      if (!/^[6-9]\d{9}$/.test(digits)) { addMsg('Please enter a valid 10-digit Indian mobile number.', 'bot'); return; }
      const payload = { name, phone, email:'', product: fd.get('product')||'General enquiry', amount:'', income:'', employment:'', city:'Hyderabad', message:'Callback requested from AI assistant', source:'AI Assistant', consent:true, website:'' };
      try {
        const api = window.ASBackend;
        const res = api ? await api.enquire(payload) : null;
        if (res && res.ok) addMsg('Thanks ' + esc(name.split(' ')[0]) + '! Our team will call you back shortly.', 'bot', true);
        else { addMsg('I could not submit automatically right now. Please call or WhatsApp us and we will assist immediately. ' + contactCta(), 'bot', true); }
      } catch(err) {
        addMsg('I could not submit automatically right now. Please call or WhatsApp us and we will assist immediately. ' + contactCta(), 'bot', true);
      }
    });
  }

  const KB = [
    { k:['hello','hi','hey','good morning','good evening'], a: () => 'Hi! I\'m the AS Financial assistant. I can help with loans, eligibility, documents, rates, process, or connect you with an advisor.', q:['Loan products','Eligibility','Documents needed','Contact advisor'] },
    { k:['contact','phone','call','number','whatsapp','email','reach','talk','advisor','human','agent'], a: () => 'You can reach AS Financial at ' + settings.phone + ' or ' + settings.email + '. Office hours: ' + settings.hours + '. ' + contactCta(), html:true, q:['Request callback','Office address','Loan products'] },
    { k:['address','location','office','visit','where'], a: () => 'Our office is at ' + settings.address + '. Office hours: ' + settings.hours + '.', q:['Contact advisor','Loan products'] },
    { k:['hour','timing','open','close','working'], a: () => 'We are available ' + settings.hours + '. For urgent queries, you can also WhatsApp us.', q:['Contact advisor','Apply now'] },
    { k:['loan','product','service','offer','home','personal','business','lap','property','vehicle','car','education','balance transfer'], a: () => 'We assist with Home Loans, Personal Loans, Business Loans, Loan Against Property, Vehicle Loans, and Balance Transfers. Tell me which loan you\'re interested in, and I\'ll share the basic details.', q:['Home Loan','Personal Loan','Business Loan','Loan Against Property'] },
    { k:['home loan','housing','mortgage'], a: () => 'Home loans can be used for purchase, construction, extension, or renovation. Eligibility depends on income, credit profile, property, and documents. I can connect you with an advisor for exact options.', q:['Documents needed','Eligibility','Request callback'] },
    { k:['personal loan'], a: () => 'Personal loans are unsecured loans for personal needs, subject to income, employment, and credit profile. An advisor can check the best options for you.', q:['Eligibility','Documents needed','Request callback'] },
    { k:['business loan'], a: () => 'Business loans support working capital, expansion, equipment, and other business needs. Eligibility depends on business vintage, turnover, banking, and documents.', q:['Documents needed','Eligibility','Request callback'] },
    { k:['loan against property','lap','mortgage loan'], a: () => 'Loan Against Property (LAP) lets you leverage residential/commercial property for funds. Eligibility depends on property value, income, and profile.', q:['Documents needed','Eligibility','Request callback'] },
    { k:['vehicle','car loan','auto'], a: () => 'Vehicle loans help finance new or used vehicles. Eligibility and terms depend on profile, vehicle, and lender policy.', q:['Eligibility','Documents needed','Request callback'] },
    { k:['balance transfer','bt','transfer loan'], a: () => 'Balance transfer can help move an existing loan to better terms where eligible. Share your current loan details with an advisor for an exact comparison.', q:['Request callback','Contact advisor'] },
    { k:['eligib','qualify','criteria','salary','income','cibil','credit score','age'], a: () => 'Eligibility generally depends on age, income/employment, credit score, existing obligations, loan amount, and property/profile (for secured loans). For an exact eligibility check, our advisor can review your details.', q:['Documents needed','Request callback','EMI calculator'] },
    { k:['document','docs','paper','kyc','proof'], a: () => 'Common documents include ID proof, address proof, income proof (salary slips/ITR/bank statements), and property/business documents where applicable. Exact documents vary by loan type.', q:['Home Loan','Business Loan','Request callback'] },
    { k:['rate','interest','roi','percent','charges','fee'], a: () => 'Interest rates and charges vary by lender, loan type, profile, and current offers. I can connect you with an advisor for the latest applicable rates.', q:['Request callback','Contact advisor','Loan products'] },
    { k:['emi','calculator','calculate','monthly payment','installment'], a: () => 'You can use our EMI calculator on the website for an estimate. For a personalized EMI and eligibility check, our advisor can help.', q:['Request callback','Contact advisor'] },
    { k:['process','step','how to apply','procedure','timeline','time'], a: () => 'Typical process: share your requirement, basic eligibility check, document submission, lender comparison/processing, approval, and disbursal. Timelines vary by loan type and documents.', q:['Apply now','Documents needed','Request callback'] },
    { k:['apply','callback','register','enquiry','lead','get started','start'], a: () => 'I can help you get started. Please share your details and our team will contact you.', action: leadCapture, q:['Contact advisor'] },
    { k:['thank','thanks'], a: () => 'You\'re welcome! If you need help with any loan query, I\'m here.', q:['Loan products','Contact advisor'] }
  ];

  function findAnswer(text) {
    const t = text.toLowerCase();
    let best = null, score = 0;
    for (const item of KB) {
      let s = 0;
      for (const k of item.k) { if (t.includes(k)) s += Math.min(k.length, 10); }
      if (s > score) { score = s; best = item; }
    }
    return score > 0 ? best : null;
  }

  function handleUser(text) {
    const msg = String(text || '').trim();
    if (!msg) return;
    addMsg(msg, 'user');
    input.value = '';
    const item = findAnswer(msg);
    if (item) {
      if (item.action) { item.action(); }
      else {
        const ans = typeof item.a === 'function' ? item.a() : item.a;
        addMsg(ans, 'bot', !!item.html);
      }
      setQuick(item.q || ['Loan products','Request callback','Contact advisor']);
      return;
    }
    addMsg('I don\'t have that specific information right now. I can connect you with an AS Financial advisor so you get the right answer quickly.', 'bot');
    addMsg(contactCta(), 'bot', true);
    setQuick(['Request callback','Call now','WhatsApp']);
  }

  function closePanel(restoreFocus) {
    if (panel.hasAttribute('hidden')) return;
    panel.setAttribute('hidden', '');
    launcher.setAttribute('aria-expanded', 'false');
    if (restoreFocus) launcher.focus();
  }
  launcher.addEventListener('click', () => {
    const open = panel.hasAttribute('hidden');
    if (open) {
      panel.removeAttribute('hidden');
      launcher.setAttribute('aria-expanded', 'true');
      if (!messages.dataset.init) {
        messages.dataset.init = '1';
        addMsg('Hi! I\'m the AS Financial assistant. Ask me about loans, eligibility, documents, rates, or the application process.', 'bot');
        addMsg('<span style="font-size:.78rem;color:#667085">General information only — not financial advice or a loan approval. Rates and terms vary by lender and profile.</span>', 'bot', true);
        setQuick(['Loan products','Eligibility','Documents needed','Request callback']);
      }
      setTimeout(() => input.focus(), 50);
    } else {
      closePanel(false);
    }
  });
  closeBtn && closeBtn.addEventListener('click', () => closePanel(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hasAttribute('hidden')) closePanel(true);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); handleUser(input.value); });
})();