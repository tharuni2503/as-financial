/* Shared client for the optional Node backend (server/index.js).
 * Auth uses HttpOnly session cookies set by the server. A CSRF token is
 * returned by login/session and sent on mutating requests. Every call fails
 * soft: without a backend the site keeps using browser-local/demo data. */
(function () {
  'use strict';

  var TOKEN_KEY = 'as_api_token'; // legacy cleanup only
  var probe = null;
  var csrfToken = '';

  function clearLegacyToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (error) { /* storage blocked */ }
  }

  function setCsrf(token) {
    csrfToken = typeof token === 'string' ? token : '';
  }

  function request(path, options) {
    var opts = options || {};
    var method = String(opts.method || 'GET').toUpperCase();
    var headers = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (csrfToken && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      headers['x-csrf-token'] = csrfToken;
    }

    return fetch(path, {
      method: method,
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) setCsrf('');
          var error = new Error((payload && payload.error) || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          error.payload = payload;
          throw error;
        }
        return payload;
      });
    });
  }

  function available() {
    if (probe) return probe;
    probe = request('api/health')
      .then(function (payload) { return !!(payload && payload.ok); })
      .catch(function () { return false; });
    return probe;
  }

  window.ASBackend = {
    available: available,
    request: request,
    csrf: function () { return csrfToken; },
    // Legacy helpers (no-op for cookie auth); kept so older code paths don't break.
    token: function () { return ''; },
    setToken: function () { clearLegacyToken(); },
    content: function (scope) {
      return available().then(function (ok) {
        if (!ok) return null;
        return request('api/content' + (scope === 'admin' ? '?scope=admin' : ''));
      });
    },
    login: function (email, password) {
      return request('api/login', { method: 'POST', body: { email: email, password: password } }).then(function (result) {
        clearLegacyToken();
        if (result) setCsrf(result.csrfToken);
        return result;
      });
    },
    logout: function () {
      return request('api/logout', { method: 'POST' }).catch(function () { return null; }).then(function (result) {
        clearLegacyToken();
        setCsrf('');
        return result;
      });
    },
    session: function () {
      return request('api/session').then(function (result) {
        if (result) setCsrf(result.csrfToken);
        return result;
      });
    },
    publish: function (section, value) {
      return request('api/content/' + section, { method: 'PUT', body: value });
    },
    enquire: function (payload) {
      return request('api/enquiries', { method: 'POST', body: payload });
    }
  };
})();
