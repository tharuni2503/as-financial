'use strict';

/* Pointer-activated aurora backdrop adapted from the selected Superdesign
   animation. The resting hero is unchanged: the layer is transparent until a
   fine pointer enters, then the five source blades drift on their original
   timings. No network, storage, layout or backend writes are used. */
(function () {
  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };

  var offsetFor = function (clientX, clientY, rect, max) {
    var limit = max === undefined ? 12 : max;
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (clamp((clientX - rect.left) / rect.width, 0, 1) - 0.5) * 2 * limit,
      y: (clamp((clientY - rect.top) / rect.height, 0, 1) - 0.5) * 2 * limit
    };
  };

  var api = { clamp: clamp, offsetFor: offsetFor };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var root = document.documentElement;
  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var fineQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  var wideQuery = window.matchMedia ? window.matchMedia('(min-width: 701px)') : null;
  var teardown = null;

  function allowed() {
    return !!fineQuery && fineQuery.matches && !!wideQuery && wideQuery.matches &&
      !!reduceQuery && !reduceQuery.matches;
  }

  function boot() {
    if (!document.body || !document.body.classList.contains('page-home')) return null;
    if (!allowed() || root.classList.contains('home-aurora-ready')) return null;

    var hero = document.querySelector('[data-aurora-hero]');
    var aurora = hero ? hero.querySelector('.au-aurora') : null;
    if (!hero || !aurora) return null;

    var listeners = [];
    var destroyed = false;
    var rect = null;
    var state = { x: 0, y: 0, active: false };
    window.__homeAuroraState = state;

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function measure() {
      rect = hero.getBoundingClientRect();
    }

    function paint(x, y) {
      state.x = x;
      state.y = y;
      aurora.style.setProperty('--au-x', x.toFixed(2) + 'px');
      aurora.style.setProperty('--au-y', y.toFixed(2) + 'px');
    }

    function onEnter(event) {
      measure();
      var target = offsetFor(event.clientX, event.clientY, rect);
      paint(target.x, target.y);
      state.active = true;
      hero.classList.add('is-au-active');
    }

    function onMove(event) {
      if (!state.active) return;
      if (!rect) measure();
      var target = offsetFor(event.clientX, event.clientY, rect);
      paint(target.x, target.y);
    }

    function onLeave() {
      state.active = false;
      hero.classList.remove('is-au-active');
      paint(0, 0);
    }

    listen(hero, 'pointerenter', onEnter);
    listen(hero, 'pointermove', onMove);
    listen(hero, 'pointerleave', onLeave);
    listen(hero, 'pointercancel', onLeave);
    listen(window, 'resize', measure, { passive: true });

    root.classList.add('home-aurora-ready');

    return function destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.forEach(function (entry) {
        try {
          entry[0].removeEventListener(entry[1], entry[2], entry[3]);
        } catch (ignored) {}
      });
      hero.classList.remove('is-au-active');
      aurora.style.removeProperty('--au-x');
      aurora.style.removeProperty('--au-y');
      root.classList.remove('home-aurora-ready');
      if (window.__homeAuroraState === state) delete window.__homeAuroraState;
      teardown = null;
    };
  }

  function onPreferenceChange() {
    if (teardown && !allowed()) {
      teardown();
      teardown = null;
    } else if (!teardown && allowed()) {
      teardown = boot();
    }
  }

  function init() {
    teardown = boot();
    [reduceQuery, fineQuery, wideQuery].forEach(function (query) {
      if (!query) return;
      if (query.addEventListener) query.addEventListener('change', onPreferenceChange);
      else if (query.addListener) query.addListener(onPreferenceChange);
    });
    window.addEventListener('pagehide', function () {
      if (teardown) teardown();
      teardown = null;
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
