/* AS Financial — inline icon sprite (stroke icons, 24x24) */
(function () {
  if (document.getElementById('as-icon-sprite')) return;
  const icons = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    key: '<circle cx="8" cy="8" r="4.2"/><path d="m11 11 9 9"/><path d="m16 16 2-2"/><path d="m18 18 2-2"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 19.5c0-3 2.9-4.8 6.5-4.8s6.5 1.8 6.5 4.8"/><path d="M16.5 5.2a3.2 3.2 0 0 1 0 6"/><path d="M18 14.8c2.2.6 3.6 2.1 3.6 4.7"/>',
    briefcase: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/><path d="M10.5 12.5v2h3v-2"/>',
    graduation: '<path d="m2.5 8.5 9.5-4.5 9.5 4.5-9.5 4.5z"/><path d="M6.5 10.8V16c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-5.2"/><path d="M21.5 8.5V14"/>',
    plot: '<path d="M3 20V9.5l9-5 9 5V20z"/><path d="M3 20h18"/><path d="M8.5 20v-5.5h7V20"/><path d="M8.5 17.5h7"/>',
    car: '<path d="M4 15.5 5.6 9h12.8L20 15.5"/><path d="M3 15.5h18V19h-2.5v-1.5h-13V19H3z"/><circle cx="7" cy="15.5" r=".8"/><circle cx="17" cy="15.5" r=".8"/>',
    stethoscope: '<path d="M6 3v5a4.5 4.5 0 0 0 9 0V3"/><path d="M4 3h3"/><path d="M14 3h3"/><path d="M10.5 12.5V16a4.5 4.5 0 0 0 9 0v-3"/><circle cx="19.5" cy="11.5" r="1.8"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6z"/><path d="m8.6 11.8 2.3 2.3 4.5-4.6"/>',
    transfer: '<path d="M4 8h14l-3-3"/><path d="M20 16H6l3 3"/>',
    rupee: '<path d="M7 4h9"/><path d="M7 8.5h9"/><path d="M14.5 4c0 3.2-2.2 4.5-5.5 4.5H7l8 11.5"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7 5.4-5.5"/>',
    phone: '<path d="M6.2 3.5 9 3l1.8 4.3-2 1.6a13.5 13.5 0 0 0 6.3 6.3l1.6-2L21 15l-.5 2.8c-.2 1.3-1.4 2.2-2.7 2A16.8 16.8 0 0 1 4.2 6.2c-.2-1.3.7-2.5 2-2.7z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
    pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.2 1.9"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>',
    'arrow-right': '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
    'arrow-up-right': '<path d="M6 18 18 6"/><path d="M8 6h10v10"/>',
    calculator: '<rect x="4" y="2.5" width="16" height="19" rx="2.5"/><path d="M7.5 7h9v3.5h-9z"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01M16 17.5h.01"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    'trending-up': '<path d="m3 17 6-6 4 4 8-8"/><path d="M16 7h5v5"/>',
    doc: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
    image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17.5 5.2-4 4.3 3 3-2.2 3.5 2.7"/>',
    handshake: '<path d="m3 11 4-4 4 1 2-2 3 2 5 5-3 3-2-2-2 2-3-2-3 2-3-3z"/><path d="m7 7-2 2 3 3"/><path d="m19 9 2-2"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
    quote: '<path d="M9.5 6C6.5 7 5 9.4 5 13v5h5v-6H7.5c0-2.3.8-3.7 3-4.4z"/><path d="M19 6c-3 1-4.5 3.4-4.5 7v5h5v-6H17c0-2.3.8-3.7 3-4.4z"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    close: '<path d="m5 5 14 14M19 5 5 19"/>',
    whatsapp: '<path d="M20.5 11.6a8.5 8.5 0 0 1-12.6 7.5L3 20.5l1.4-4.8A8.5 8.5 0 1 1 20.5 11.6z"/><path d="M8.5 8c.3 3.6 3.9 6.8 7.4 7.2.8.1 1.4-.4 1.6-1.1l.2-1-2.6-1-.9 1a6 6 0 0 1-2.8-2.8l1-.9-1-2.6-1-.1c-.8 0-1.4.5-1.4 1.3z"/>',
    facebook: '<path d="M14.5 21v-7h2.4l.4-3h-2.8V9.2c0-.9.3-1.5 1.5-1.5H17.5V5a18 18 0 0 0-2.1-.1c-2.1 0-3.6 1.3-3.6 3.8V11H9.5v3h2.3v7z"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".7" fill="currentColor"/>',
    linkedin: '<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7.5 10v7M7.5 7.2v.1M11.5 17v-4a2.5 2.5 0 0 1 5 0v4"/><path d="M11.5 10.5V17"/>',
    youtube: '<rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="m10.5 9 5 3-5 3z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    bell: '<path d="M18 8.5a6 6 0 0 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5z"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/>',
    filter: '<path d="M3 5h18l-7 8.5V20l-4 2v-8.5z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    edit: '<path d="m4 16-1 5 5-1L20 8l-4-4z"/><path d="m13.5 5.5 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="m6 7 1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    logout: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/>',
    dashboard: '<rect x="3" y="3" width="7" height="8" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="15" width="7" height="6" rx="1.5"/>',
    folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2.5h8A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
    box: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="M3.5 7.5 12 12l8.5-4.5"/><path d="M12 12v9"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H2.8a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V2.8a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1.1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z"/>',
    report: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M9.5 12h6M9.5 15.5h6M9.5 8.5h2"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    sparkle: '<path d="M12 2.5 13.8 9l6.7 3-6.7 3L12 21.5 10.2 15 3.5 12l6.7-3z"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>',
    lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14v2.5"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/>',
    wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 18.5z"/><path d="M3 8h18"/><path d="M16 13h2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>',
    send: '<path d="m21 3-9.5 18-2-7.5L2 11z"/><path d="M21 3 9.5 13.5"/>',
    percent: '<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>'
  };
  const svg = Object.entries(icons).map(([name, path]) =>
    `<symbol id="i-${name}" viewBox="0 0 24 24">${path}</symbol>`
  ).join('');
  const holder = document.createElement('div');
  holder.id = 'as-icon-sprite';
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  document.body.prepend(holder);
  window.AS_ICONS = Object.keys(icons);
})();
