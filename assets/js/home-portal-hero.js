'use strict';

/* Scroll-bound portal reveal adapted from the selected Superdesign animation.
   The controller only writes CSS custom properties on its own overlay, so the
   restored homepage markup, dimensions and original scroll animations are
   untouched. Touch, small-screen and reduced-motion visitors are excluded. */
(function () {
  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };

  /* The overlay fades in and out around the hero stage, while the transform
     values stay bound to scroll position and therefore reverse cleanly. */
  var revealWindow = function (progress) {
    var p = clamp(progress);
    var appear = clamp((p - 0.06) / 0.16);
    var disappear = clamp((1 - p) / 0.16);
    return {
      opacity: Math.min(appear, disappear),
      motion: clamp((p - 0.06) / 0.84)
    };
  };

  var portalValues = function (progress) {
    var windowState = revealWindow(progress);
    var q = windowState.motion;
    return {
      'opacity': windowState.opacity.toFixed(3),
      'scale': (1.22 - q * 0.22).toFixed(3),
      'duo': (q * 0.42).toFixed(3),
      'left': (-q * 115).toFixed(2) + '%',
      'right': (q * 115).toFixed(2) + '%',
      'dot-a-x': (q * 18).toFixed(2) + 'vw',
      'dot-a-y': (q * 55).toFixed(2) + 'vh',
      'dot-b-x': (-q * 58).toFixed(2) + 'vw',
      'dot-b-y': (-q * 45).toFixed(2) + 'vh',
      'title-scale': (1 + q * 0.12).toFixed(3),
      'tracking': (-0.03 - q * 0.08).toFixed(4) + 'em',
      'half-left': (-q * 45).toFixed(2) + '%',
      'half-right': (q * 45).toFixed(2) + '%'
    };
  };

  var api = {
    clamp: clamp,
    revealWindow: revealWindow,
    portalValues: portalValues
  };

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
    if (!allowed() || root.classList.contains('home-portal-hero-ready')) return null;

    var stage = document.querySelector('[data-cine-stage="hero"]');
    var portal = stage ? stage.querySelector('.ph-portal') : null;
    if (!stage || !portal) return null;

    var listeners = [];
    var observers = [];
    var destroyed = false;
    var propertyNames = Object.keys(portalValues(0));

    var state = {
      progress: 0,
      scrollY: 0,
      values: portalValues(0),
      stage: null,
      needsMeasure: true,
      raf: 0
    };
    window.__homePortalState = state;

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function measure() {
      var rect = stage.getBoundingClientRect();
      var scrollY = window.scrollY || window.pageYOffset || 0;
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      var height = stage.offsetHeight || rect.height;
      state.stage = {
        top: Math.round((rect.top + scrollY) * 100) / 100,
        height: Math.round(height * 100) / 100,
        scrollable: Math.max(1, Math.round((height - viewportHeight) * 100) / 100)
      };
    }

    function frame() {
      state.raf = 0;
      if (destroyed || !state.stage) return;

      var scrollY = window.scrollY || window.pageYOffset || 0;
      var progress = clamp((scrollY - state.stage.top) / state.stage.scrollable);
      var values = portalValues(progress);

      state.progress = progress;
      state.scrollY = scrollY;
      state.values = values;
      Object.keys(values).forEach(function (name) {
        portal.style.setProperty('--ph-' + name, values[name]);
      });
    }

    function schedule(needsMeasure) {
      if (destroyed) return;
      if (needsMeasure) state.needsMeasure = true;
      if (state.raf) return;
      state.raf = window.requestAnimationFrame(function () {
        if (state.needsMeasure) {
          measure();
          state.needsMeasure = false;
        }
        frame();
      });
    }

    var onScroll = function () { schedule(false); };
    var onResize = function () { schedule(true); };
    var onVisibility = function () {
      if (document.hidden) {
        if (state.raf) window.cancelAnimationFrame(state.raf);
        state.raf = 0;
      } else {
        schedule(true);
      }
    };

    listen(window, 'scroll', onScroll, { passive: true });
    listen(window, 'resize', onResize, { passive: true });
    listen(window, 'orientationchange', onResize, { passive: true });
    listen(document, 'visibilitychange', onVisibility);
    listen(window, 'load', onResize, { once: true });

    if ('ResizeObserver' in window) {
      var resizeObserver = new ResizeObserver(function () { schedule(true); });
      resizeObserver.observe(stage);
      resizeObserver.observe(portal);
      observers.push(resizeObserver);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { schedule(true); }).catch(function () {});
    }

    root.classList.add('home-portal-hero-ready');
    schedule(true);

    return function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (state.raf) window.cancelAnimationFrame(state.raf);
      state.raf = 0;
      listeners.forEach(function (entry) {
        try {
          entry[0].removeEventListener(entry[1], entry[2], entry[3]);
        } catch (ignored) {}
      });
      observers.forEach(function (observer) {
        try { observer.disconnect(); } catch (ignored) {}
      });
      propertyNames.forEach(function (name) {
        portal.style.removeProperty('--ph-' + name);
      });
      root.classList.remove('home-portal-hero-ready');
      if (window.__homePortalState === state) delete window.__homePortalState;
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
