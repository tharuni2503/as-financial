/* Shared client for the optional Node backend (server/index.js).
 * Auth uses HttpOnly session cookies set by the server. Every call fails soft:
 * without a backend the site keeps using browser-local/demo data. */
(function () {
  'use strict';

  var TOKEN_KEY = 'as_api_token'; // legacy cleanup only
  var probe = null;

  function clearLegacyToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (error) { /* storage blocked */ }
  }

  function request(path, options) {
    var opts = options || {};
    var headers = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';

    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      credentials: 'same-origin'
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (payload) {
        if (!response.ok) {
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
        return result;
      });
    },
    logout: function () {
      return request('api/logout', { method: 'POST' }).catch(function () { return null; }).then(function (result) {
        clearLegacyToken();
        return result;
      });
    },
    session: function () {
      return request('api/session');
    },
    publish: function (section, value) {
      return request('api/content/' + section, { method: 'PUT', body: value });
    },
    enquire: function (payload) {
      return request('api/enquiries', { method: 'POST', body: payload });
    }
  };
})();
