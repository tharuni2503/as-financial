/* ==========================================================================
   AS Financial — timezone-safe date display helpers
   --------------------------------------------------------------------------
   Date-only values (YYYY-MM-DD) such as followUpDate must not be parsed as
   UTC midnight and then re-rendered in a local timezone: admins west of UTC
   would see the previous day. These helpers format date-only values in UTC so
   the displayed calendar date always matches the stored date.

   Full timestamps keep the previous local-time rendering.
   Exposed as window.ASDateFormat for the admin bundle and CommonJS for tests.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ASDateFormat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

  function isDateOnly(value) {
    return DATE_ONLY.test(String(value == null ? '' : value));
  }

  function dateOnlyToUTC(value) {
    const m = DATE_ONLY.exec(String(value == null ? '' : value));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    const d = new Date(Date.UTC(year, month, day));
    if (isNaN(d)) return null;
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
    return d;
  }

  function safeDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d) ? null : d;
  }

  function fmtDate(value, locale) {
    if (!value) return '—';
    const dateOnly = dateOnlyToUTC(value);
    const d = dateOnly || safeDate(value);
    if (!d) return '—';
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    if (dateOnly) options.timeZone = 'UTC';
    return d.toLocaleDateString(locale || 'en-IN', options);
  }

  function fmtShort(value, locale) {
    if (!value) return '—';
    const dateOnly = dateOnlyToUTC(value);
    const d = dateOnly || safeDate(value);
    if (!d) return '—';
    const options = { day: '2-digit', month: 'short' };
    if (dateOnly) options.timeZone = 'UTC';
    return d.toLocaleDateString(locale || 'en-IN', options);
  }

  // Calendar date used by the server for reminder buckets.
  function todayISO(now, timeZone) {
    const d = now instanceof Date ? now : new Date();
    const zone = timeZone || 'Asia/Kolkata';
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(d);
      const map = {};
      parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
      if (map.year && map.month && map.day) return map.year + '-' + map.month + '-' + map.day;
    } catch (e) { /* fall through to local date */ }
    const local = d instanceof Date ? d : new Date();
    return local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') +
      '-' + String(local.getDate()).padStart(2, '0');
  }

  return { isDateOnly, dateOnlyToUTC, fmtDate, fmtShort, todayISO };
});
