/* Bridges the admin dashboard and the backend.
 *
 * Auth uses server-set HttpOnly cookies. This module syncs published content
 * and admin collections when a valid session exists. Without a backend the
 * dashboard keeps working in local demo mode.
 */
(function () {
  'use strict';

  var api = window.ASBackend;
  if (!api) return;

  var CONTENT = {
    as_testimonials: 'testimonials',
    as_gallery: 'gallery',
    as_posts: 'posts',
    as_lenders: 'lenders',
    as_content_images: 'images'
  };

  var ADMIN = {
    as_leads: 'leads',
    as_applications: 'applications',
    as_products: 'products',
    as_partners: 'partners',
    as_tasks: 'tasks',
    as_customers: 'customers',
    as_documents: 'documents',
    as_notifications: 'notifications',
    as_settings: 'settings'
  };

  var statusEl = null;
  var statusTimer = 0;
  var canSyncAdmin = false;

  function status(message, tone) {
    if (!document.body) return;
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.className = 'as-publish-status';
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = message;
    statusEl.dataset.tone = tone || 'info';
    statusEl.classList.add('is-visible');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.classList.remove('is-visible'); }, 4200);
  }

  function hasContent(value) {
    if (Array.isArray(value)) return value.length > 0;
    return !!value && typeof value === 'object' && Object.keys(value).length > 0;
  }

  function getLocal(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }

  function setLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* blocked */ }
  }

  function same(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function pullAdmin() {
    if (!canSyncAdmin) return Promise.resolve(false);
    return api.request('api/admin/store').then(function (store) {
      if (!store) return false;
      var changed = false;
      Object.keys(ADMIN).forEach(function (key) {
        var name = ADMIN[key];
        var remote = store[name];
        var local = getLocal(key);
        if (hasContent(remote)) {
          if (!same(remote, local)) {
            setLocal(key, remote);
            changed = true;
          }
        } else if (hasContent(local)) {
          api.request('api/admin/store/' + name, { method: 'PUT', body: local }).catch(function () {});
        }
      });
      return changed;
    }).catch(function (error) {
      if (error && error.status === 401) canSyncAdmin = false;
      return false;
    });
  }

  function pull() {
    return api.available()
      .then(function (ok) { return ok ? api.content('admin') : null; })
      .then(function (content) {
        var changed = false;
        if (content) {
          Object.keys(CONTENT).forEach(function (key) {
            var remote = content[CONTENT[key]];
            if (!hasContent(remote)) return;
            if (!same(remote, getLocal(key))) {
              setLocal(key, remote);
              changed = true;
            }
          });
        }
        return pullAdmin().then(function (adminChanged) { return changed || adminChanged; });
      })
      .then(function (changed) {
        if (changed && !sessionStorage.getItem('as_pulled_v3')) {
          sessionStorage.setItem('as_pulled_v3', '1');
          location.reload();
        }
      })
      .catch(function () { /* offline: keep local data */ });
  }

  /* ------------------------------------------------------------ push */
  var timers = {};

  function push(sectionType, name, value) {
    var path = sectionType === 'content' ? 'api/content/' + name : 'api/admin/store/' + name;
    if (sectionType === 'admin' && !canSyncAdmin) return;
    api.request(path, { method: 'PUT', body: value })
      .then(function () {
        if (sectionType === 'admin' || canSyncAdmin) status('Saved to server.', 'ok');
      })
      .catch(function (error) {
        if (error && error.status === 401) {
          canSyncAdmin = false;
          status('Session expired. Sign in again to sync.', 'warn');
        } else if (error && error.status === 400) {
          status('Could not save: ' + error.message, 'warn');
        } else if (sectionType === 'admin' || canSyncAdmin) {
          status('Saved in this browser only (backend unavailable).', 'warn');
        }
      });
  }

  document.addEventListener('as:store', function (event) {
    var detail = event && event.detail ? event.detail : {};
    var key = detail.key;
    var sectionType = null;
    var name = null;

    if (CONTENT[key]) { sectionType = 'content'; name = CONTENT[key]; }
    else if (ADMIN[key]) { sectionType = 'admin'; name = ADMIN[key]; }
    else return;

    if (window.__asSeeding) return;

    clearTimeout(timers[name]);
    timers[name] = setTimeout(function () { push(sectionType, name, detail.value); }, 500);
  });

  /* --------------------------------------------------- auth hooks */
  function onAuthReady() {
    canSyncAdmin = true;
    sessionStorage.removeItem('as_pulled_v3');
    status('Connected. Data syncs with the server.', 'ok');
    document.dispatchEvent(new Event('as:sync-enquiries'));
    pull();
  }

  document.addEventListener('as:auth-ready', onAuthReady);

  // If already authenticated (page load with valid cookie), admin.js will
  // dispatch as:auth-ready after session check. Also try a lightweight probe.
  api.available().then(function (ok) {
    if (!ok) return;
    return api.session().then(function () {
      // Session valid; admin.js may not have entered yet, but enable sync.
      canSyncAdmin = true;
      document.dispatchEvent(new Event('as:sync-enquiries'));
      pull();
    }).catch(function () { canSyncAdmin = false; });
  }).catch(function () {});

  // Logout buttons are handled in admin.js (calls backend). We just react.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('#logout-btn, #sidebar-logout') : null;
    if (t) canSyncAdmin = false;
  });
})();
