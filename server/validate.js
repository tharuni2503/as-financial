'use strict';

/* Input shaping for everything the API accepts. */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ASSET_SRC = /^assets\/img\/[A-Za-z0-9/._-]+$/;
const DATA_SRC = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/;
const MAX_DATA_SRC = 3_000_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value) {
  // eslint-disable-next-line no-control-regex
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function text(value, max, { required = false, label = 'value' } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, 'Missing ' + label + '.');
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new HttpError(400, 'Invalid ' + label + '.');
  }
  const out = clean(value).trim();
  if (required && !out) throw new HttpError(400, 'Missing ' + label + '.');
  return out.slice(0, max);
}

function list(value, max, label) {
  if (!Array.isArray(value)) throw new HttpError(400, label + ' must be a list.');
  if (value.length > max) throw new HttpError(400, 'Too many ' + label + ' (max ' + max + ').');
  return value;
}

function source(value) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'Image path is missing.');
  if (value.length > MAX_DATA_SRC) throw new HttpError(400, 'Image is too large.');
  if (ASSET_SRC.test(value) && !value.includes('..')) return value;
  if (DATA_SRC.test(value)) return value;
  throw new HttpError(400, 'Image must be a site asset or an uploaded PNG/JPEG/WebP.');
}

function testimonial(item, index) {
  if (!item || typeof item !== 'object') throw new HttpError(400, 'Invalid testimonial entry.');
  const name = text(item.name, 80, { required: true, label: 'name' });
  const quote = text(item.quote, 600, { required: true, label: 'quote' });
  return {
    id: text(item.id, 40) || 'TST-' + (index + 1),
    name,
    quote,
    product: text(item.product, 80),
    location: text(item.location, 80),
    published: Boolean(item.published)
  };
}

function galleryItem(item, index) {
  if (!item || typeof item !== 'object') throw new HttpError(400, 'Invalid poster entry.');
  return {
    id: text(item.id, 40) || 'GAL-' + (index + 1),
    src: source(item.src),
    caption: text(item.caption, 120) || 'Poster',
    alt: text(item.alt, 160) || text(item.caption, 160) || 'Poster'
  };
}

function post(item, index) {
  if (!item || typeof item !== 'object') throw new HttpError(400, 'Invalid post entry.');
  return {
    id: text(item.id, 40) || 'POST-' + (index + 1),
    title: text(item.title, 140, { required: true, label: 'title' }),
    excerpt: text(item.excerpt, 320),
    category: text(item.category, 60),
    date: text(item.date, 40),
    slug: text(item.slug, 80),
    published: Boolean(item.published)
  };
}

function images(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Images must be an object.');
  }
  const keys = Object.keys(value);
  if (keys.length > 80) throw new HttpError(400, 'Too many image overrides.');
  const out = {};
  keys.forEach((key) => {
    if (!/^[a-z0-9-]{1,60}$/i.test(key)) throw new HttpError(400, 'Invalid image key: ' + key);
    const entry = value[key];
    if (entry === '' || entry === 'icon') {
      out[key] = entry;
      return;
    }
    out[key] = source(entry);
  });
  return out;
}

function content(section, payload) {
  switch (section) {
    case 'testimonials':
      return list(payload, 40, 'testimonials').map(testimonial);
    case 'gallery':
      return list(payload, 40, 'posters').map(galleryItem);
    case 'posts':
      return list(payload, 60, 'posts').map(post);
    case 'images':
      return images(payload);
    default:
      throw new HttpError(404, 'Unknown content section.');
  }
}

function enquiry(payload) {
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Invalid enquiry.');

  if (text(payload.website, 40)) {
    // Honeypot filled in: pretend it worked, but do not store anything.
    return null;
  }

  const name = text(payload.name, 100, { required: true, label: 'name' });
  const phone = text(payload.phone, 20, { required: true, label: 'mobile number' }).replace(/[^\d]/g, '');
  if (name.length < 2) throw new HttpError(400, 'Please enter your full name.');
  if (!/^\d{10,13}$/.test(phone)) throw new HttpError(400, 'Please enter a valid 10-digit mobile number.');

  const email = text(payload.email, 120);
  if (email && !EMAIL.test(email)) throw new HttpError(400, 'Please enter a valid email address.');

  const consent = payload.consent;
  if (consent === false || consent === 'false') {
    throw new HttpError(400, 'Please accept the consent note so we can contact you.');
  }

  return {
    name,
    phone,
    email,
    product: text(payload.product, 80) || 'General enquiry',
    amount: text(payload.amount, 40),
    income: text(payload.income, 40),
    employment: text(payload.employment, 60),
    city: text(payload.city, 60),
    message: text(payload.message, 2000),
    source: text(payload.source, 60) || 'Website form'
  };
}

const ADMIN_ARRAYS = ['leads', 'applications', 'products', 'partners', 'tasks', 'customers', 'documents', 'notifications'];

function scalar(value, maxString) {
  if (value === null || value === undefined) return value === undefined ? null : null;
  const t = typeof value;
  if (t === 'boolean') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) return 0;
    return value;
  }
  if (t === 'string') return clean(value).slice(0, maxString);
  return null;
}

function sanitize(value, depth, maxString) {
  if (depth > 8) return null;
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (value.length > 600) throw new HttpError(400, 'List is too large.');
    return value.map((item) => sanitize(item, depth + 1, maxString));
  }
  const t = typeof value;
  if (t === 'object') {
    const keys = Object.keys(value);
    if (keys.length > 120) throw new HttpError(400, 'Object has too many fields.');
    const out = {};
    keys.forEach((key) => {
      if (typeof key !== 'string') return;
      const safeKey = clean(key).slice(0, 80);
      if (!safeKey) return;
      out[safeKey] = sanitize(value[key], depth + 1, maxString);
    });
    return out;
  }
  return scalar(value, maxString);
}

function adminCollection(name, payload) {
  if (name === 'settings') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new HttpError(400, 'Settings must be an object.');
    }
    return sanitize(payload, 0, 4000);
  }
  if (!ADMIN_ARRAYS.includes(name)) throw new HttpError(404, 'Unknown admin collection.');
  if (!Array.isArray(payload)) throw new HttpError(400, name + ' must be a list.');
  if (payload.length > 2000) throw new HttpError(400, 'Too many ' + name + ' (max 2000).');
  return payload.map((item) => sanitize(item, 0, 8000));
}

function adminItem(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'Item must be an object.');
  }
  const out = sanitize(payload, 0, 8000);
  if (!out || typeof out !== 'object' || Array.isArray(out)) throw new HttpError(400, 'Item must be an object.');
  return out;
}

module.exports = { HttpError, content, enquiry, text, adminCollection, adminItem, sanitize, ADMIN_ARRAYS };
