'use strict';

/* Scroll Journey Line adapted from the selected Superdesign component.
   The source binds an SVG path's revealed length to document scroll progress
   with a spring (stiffness 400, damping 90, restDelta 1e-3). This controller
   reproduces that behaviour with no framework and no network, storage or
   backend calls. The resting page is unchanged: the rail is transparent until
   the module is ready and the path is empty until the page scrolls. */
(function () {
  var PATH_D = 'M 50 0 C 50 100, 80 150, 80 250 S 20 350, 20 500 S 80 650, 80 800 S 50 900, 50 1000';
  var STIFFNESS = 400;
  var DAMPING = 90;
  var REST_DELTA = 1e-3;

  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };

  var createSpring = function (initial, stiffness, damping, restDelta) {
    var current = initial || 0;
    var velocity = 0;
    var target = current;
    return {
      set: function (value) { target = value; },
      step: function (dt) {
        var d = Math.min(Math.max(dt, 0), 0.064);
        var accel = (target - current) * stiffness - velocity * damping;
        velocity += accel * d;
        current += velocity * d;
        if (Math.abs(target - current) < restDelta && Math.abs(velocity) < restDelta) {
          current = target;
          velocity = 0;
        }
        return current;
      },
      get: function () { return current; }
    };
  };

  var pageProgress = function (scrollY, scrollHeight, viewportHeight) {
    var max = scrollHeight - viewportHeight;
    return max > 0 ? clamp(scrollY / max, 0, 1) : 0;
  };

  var api = {
    PATH_D: PATH_D,
    STIFFNESS: STIFFNESS,
    DAMPING: DAMPING,
    REST_DELTA: REST_DELTA,
    clamp: clamp,
    createSpring: createSpring,
    pageProgress: pageProgress
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
    if (!allowed() || root.classList.contains('home-journey-line-ready')) return null;

    var rail = document.querySelector('[data-journey-line]');
    var path = rail ? rail.querySelector('.jl-progress') : null;
    if (!rail || !path) return null;

    var listeners = [];
    var destroyed = false;
    var raf = 0;
    var last = 0;
    var spring = createSpring(0, STIFFNESS, DAMPING, REST_DELTA);
    var state = { progress: 0, target: 0 };
    window.__homeJourneyLineState = state;

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function measure() {
      state.target = pageProgress(
        window.scrollY || window.pageYOffset || 0,
        root.scrollHeight,
        window.innerHeight
      );
      spring.set(state.target);
    }

    function frame(now) {
      if (destroyed) return;
      var dt = last ? (now - last) / 1000 : 0;
      last = now;
      var value = spring.step(dt);
      state.progress = value;
      path.style.setProperty('--jl-progress', clamp(value, 0, 1).toFixed(4));
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      measure();
      if (!raf) {
        last = 0;
        raf = window.requestAnimationFrame(frame);
      }
    }

    listen(window, 'scroll', start, { passive: true });
    listen(window, 'resize', start, { passive: true });

    root.classList.add('home-journey-line-ready');
    start();

    return function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      listeners.forEach(function (entry) {
        try {
          entry[0].removeEventListener(entry[1], entry[2], entry[3]);
        } catch (ignored) {}
      });
      path.style.removeProperty('--jl-progress');
      root.classList.remove('home-journey-line-ready');
      if (window.__homeJourneyLineState === state) delete window.__homeJourneyLineState;
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
