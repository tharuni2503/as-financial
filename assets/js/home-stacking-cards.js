'use strict';

/* Stacking cards effect adapted from the selected Superdesign component.
   Source behaviour: gsap.to(card, { scale: 0.95, filter: "brightness(0.5)",
   scrollTrigger: { trigger: nextCard, start: "top bottom", end: "top top",
   scrub: true } }). This controller reproduces that scrub with no framework
   and no network, storage or backend calls. It never changes box dimensions. */
(function () {
  var SCALE_END = 0.95;
  var BRIGHTNESS_END = 0.5;

  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };

  var progressFor = function (nextTop, viewportHeight) {
    if (!viewportHeight) return 0;
    return clamp((viewportHeight - nextTop) / viewportHeight, 0, 1);
  };

  var styleFor = function (progress) {
    var p = clamp(progress, 0, 1);
    return {
      scale: 1 - (1 - SCALE_END) * p,
      brightness: 1 - (1 - BRIGHTNESS_END) * p
    };
  };

  var api = {
    SCALE_END: SCALE_END,
    BRIGHTNESS_END: BRIGHTNESS_END,
    clamp: clamp,
    progressFor: progressFor,
    styleFor: styleFor
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
    if (!allowed() || root.classList.contains('home-stacking-ready')) return null;

    var list = document.querySelector('[data-stacking-cards]');
    if (!list) return null;
    var items = Array.prototype.slice.call(list.querySelectorAll('.faq-item'));
    if (items.length < 2) return null;

    var listeners = [];
    var destroyed = false;
    var raf = 0;
    var state = { progress: items.map(function () { return 0; }) };
    window.__homeStackingCardsState = state;

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function paint() {
      if (destroyed) return;
      var vh = window.innerHeight || root.clientHeight;
      for (var i = 0; i < items.length - 1; i++) {
        var nextTop = items[i + 1].getBoundingClientRect().top;
        var p = progressFor(nextTop, vh);
        state.progress[i] = p;
        var style = styleFor(p);
        items[i].style.transform = p > 0 ? 'scale(' + style.scale.toFixed(4) + ')' : '';
        items[i].style.filter = p > 0 ? 'brightness(' + style.brightness.toFixed(4) + ')' : '';
      }
    }

    function schedule() {
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        raf = 0;
        paint();
      });
    }

    function reset() {
      items.forEach(function (item) {
        item.style.removeProperty('transform');
        item.style.removeProperty('filter');
      });
      state.progress = state.progress.map(function () { return 0; });
    }

    listen(window, 'scroll', schedule, { passive: true });
    listen(window, 'resize', schedule, { passive: true });

    root.classList.add('home-stacking-ready');
    paint();

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
      reset();
      root.classList.remove('home-stacking-ready');
      if (window.__homeStackingCardsState === state) delete window.__homeStackingCardsState;
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
