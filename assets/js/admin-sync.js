/* Bridges the admin dashboard and the backend.
 *
 * - Pulls server-published content and admin collections into localStorage so
 *   the dashboard reflects what the server has.
 * - Pushes saves (content + admin collections) to the API when signed in.
 * - Without a backend nothing changes: local demo behavior remains intact.
 */
(function () {
  'use strict';

  var api = window.ASBackend;
  if (!api) return;

  var CONTENT = {
    as_testimonials: 'testimonials',
    as_gallery: 'gallery',
    as_posts: 'posts',
    as_content_images: 'images'
  };

  var ADMIN = {
    as_leads: 'leads',
    as_applications: 'applications',
    as_products: 'products',
    as_partners: 'partners',
    as_tasks: 'tasks',
    as_settings: 'settings'
  };

  var statusEl = null;
  var statusTimer = 0;

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
        if (!api.token()) return changed;
        return api.request('api/admin/store').then(function (store) {
          if (!store) return changed;
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
              // Seed empty server collection from current local state once.
              api.request('api/admin/store/' + name, { method: 'PUT', body: local }).catch(function () {});
            }
          });
          return changed;
        }).catch(function () { return changed; });
      })
      .then(function (changed) {
        if (changed && !sessionStorage.getItem('as_pulled_v2')) {
          sessionStorage.setItem('as_pulled_v2', '1');
          location.reload();
        }
      })
      .catch(function () { /* offline: keep local data */ });
  }

  pull();

  /* ------------------------------------------------------------ push */
  var timers = {};

  function push(sectionType, name, value) {
    if (!api.token()) return;
    var path = sectionType === 'content' ? 'api/content/' + name : 'api/admin/store/' + name;
    api.request(path, { method: 'PUT', body: value })
      .then(function () { status('Saved to server.', 'ok'); })
      .catch(function (error) {
        if (error && error.status === 401) {
          api.setToken('');
          status('Session expired. Sign in again to sync.', 'warn');
        } else if (error && error.status === 400) {
          status('Could not save: ' + error.message, 'warn');
        } else {
          status('Saved in this browser only (backend unreachable).', 'warn');
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

  /* --------------------------------------------------- sign in / out */
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function () {
      var emailField = document.getElementById('login-email');
      var passwordField = document.getElementById('login-password');
      var email = emailField ? emailField.value.trim() : '';
      var password = passwordField ? passwordField.value : '';
      api.login(email, password)
        .then(function (result) {
          if (result && result.token) {
            api.setToken(result.token);
            sessionStorage.removeItem('as_reauth');
            status('Connected. Data now syncs with the server.', 'ok');
            sessionStorage.removeItem('as_pulled_v2');
            document.dispatchEvent(new Event('as:sync-enquiries'));
            pull();
          }
        })
        .catch(function () { api.setToken(''); });
    });
  }

  ['logout-btn', 'sidebar-logout'].forEach(function (id) {
    var button = document.getElementById(id);
    if (button) button.addEventListener('click', function () {
      api.logout();
      api.setToken('');
    });
  });

  if (api.token()) {
    api.session().then(function () {
      document.dispatchEvent(new Event('as:sync-enquiries'));
    }).catch(function (error) {
      if (error && error.status === 401) {
        api.setToken('');
        try {
          if ((sessionStorage.getItem('as_admin_session') || localStorage.getItem('as_admin_session')) && !sessionStorage.getItem('as_reauth')) {
            sessionStorage.setItem('as_reauth', '1');
            sessionStorage.removeItem('as_admin_session');
            localStorage.removeItem('as_admin_session');
            location.reload();
          }
        } catch (e) { /* ignore */ }
      }
    });
  } else {
    // Signed into the UI but missing an API token: require fresh sign-in for sync.
    try {
      if ((sessionStorage.getItem('as_admin_session') || localStorage.getItem('as_admin_session')) && !sessionStorage.getItem('as_reauth')) {
        sessionStorage.setItem('as_reauth', '1');
        sessionStorage.removeItem('as_admin_session');
        localStorage.removeItem('as_admin_session');
        location.reload();
      }
    } catch (e) { /* ignore */ }
  }
})();
