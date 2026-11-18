/* Bridges the admin dashboard and the backend.
 *
 * - On load, pulls the copy the server already has into localStorage so the
 *   dashboard shows what is actually published.
 * - On every save of gallery / testimonials / posts / offering images, pushes
 *   the same data to the API. Without a backend nothing changes.
 */
(function () {
  'use strict';

  var api = window.ASBackend;
  if (!api) return;

  var SECTIONS = {
    as_testimonials: 'testimonials',
    as_gallery: 'gallery',
    as_posts: 'posts',
    as_content_images: 'images'
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

  /* ------------------------------------------------------------ pull */
  api.available()
    .then(function (ok) { return ok ? api.content('admin') : null; })
    .then(function (content) {
      if (!content) return;
      var changed = false;
      Object.keys(SECTIONS).forEach(function (key) {
        var remote = content[SECTIONS[key]];
        if (!hasContent(remote)) return;
        var json = JSON.stringify(remote);
        try {
          if (localStorage.getItem(key) !== json) {
            localStorage.setItem(key, json);
            changed = true;
          }
        } catch (error) { /* storage blocked */ }
      });
      if (changed && !sessionStorage.getItem('as_pulled')) {
        sessionStorage.setItem('as_pulled', '1');
        location.reload();
      }
    })
    .catch(function () { /* offline: keep local data */ });

  /* ------------------------------------------------------------ push */
  var timers = {};

  document.addEventListener('as:store', function (event) {
    var detail = event && event.detail ? event.detail : {};
    var section = SECTIONS[detail.key];
    if (!section || window.__asSeeding) return;

    clearTimeout(timers[section]);
    timers[section] = setTimeout(function () {
      if (!api.token()) return;
      api.publish(section, detail.value)
        .then(function () { status('Published to the website.', 'ok'); })
        .catch(function (error) {
          if (error && error.status === 401) {
            api.setToken('');
            status('Session expired. Sign in again to publish.', 'warn');
          } else if (error && error.status === 400) {
            status('Could not publish: ' + error.message, 'warn');
          } else {
            status('Saved in this browser only (backend unreachable).', 'warn');
          }
        });
    }, 450);
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
            status('Connected. Edits now publish site-wide.', 'ok');
            document.dispatchEvent(new Event('as:sync-enquiries'));
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

  // Drop a token left over from an earlier server run.
  if (api.token()) {
    api.session().then(function () {
      document.dispatchEvent(new Event('as:sync-enquiries'));
    }).catch(function (error) {
      if (error && error.status === 401) api.setToken('');
    });
  }
})();
