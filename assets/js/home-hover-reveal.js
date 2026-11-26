'use strict';

/* Cursor-following goo reveal for the homepage hero image. It is gated to
   fine pointers and no-preference motion; touch and reduced-motion users keep
   the original static image. No network, storage or layout writes are used. */
(function () {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var root = document.documentElement;
  var frame = document.querySelector('[data-hover-reveal]');
  if (!frame) return;

  var fineQuery = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
  var reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var teardown = null;

  function allowed() {
    return !!fineQuery && fineQuery.matches && !!reduceQuery && !reduceQuery.matches;
  }

  function boot() {
    if (teardown || !allowed() || root.classList.contains('home-hover-reveal-ready')) return null;

    var circles = Array.prototype.slice.call(frame.querySelectorAll('.hr-blob'));
    var cursor = frame.querySelector('.hr-cursor');
    if (circles.length !== 3 || !cursor) return null;

    /* Spring values match the selected Superdesign hover reveal: a tight lead
       circle and two looser trailing circles. */
    var configs = [
      { stiffness: 200, damping: 25, mass: 0.5 },
      { stiffness: 150, damping: 30, mass: 0.8 },
      { stiffness: 100, damping: 35, mass: 1 }
    ];
    var points = configs.map(function (config, index) {
      return {
        x: -400,
        y: -400,
        vx: 0,
        vy: 0,
        config: config,
        el: circles[index]
      };
    });

    var target = { x: -400, y: -400 };
    var rect = null;
    var raf = 0;
    var primed = false;
    var destroyed = false;
    var listeners = [];

    function listen(targetEl, type, fn, options) {
      targetEl.addEventListener(type, fn, options);
      listeners.push([targetEl, type, fn, options]);
    }

    function measure() {
      rect = frame.getBoundingClientRect();
    }

    function setTarget(event) {
      if (!rect) measure();
      target.x = event.clientX - rect.left;
      target.y = event.clientY - rect.top;
      cursor.style.left = target.x.toFixed(2) + 'px';
      cursor.style.top = target.y.toFixed(2) + 'px';
    }

    function paint() {
      points.forEach(function (point) {
        point.el.setAttribute('cx', point.x.toFixed(2));
        point.el.setAttribute('cy', point.y.toFixed(2));
      });
    }

    function tick() {
      raf = 0;
      if (destroyed || !frame.classList.contains('is-hr-active')) return;

      var dt = 1 / 60;
      points.forEach(function (point) {
        var config = point.config;
        var ax = ((target.x - point.x) * config.stiffness - point.vx * config.damping) / config.mass;
        var ay = ((target.y - point.y) * config.stiffness - point.vy * config.damping) / config.mass;
        point.vx += ax * dt;
        point.vy += ay * dt;
        point.x += point.vx * dt;
        point.y += point.vy * dt;
      });

      paint();
      raf = window.requestAnimationFrame(tick);
    }

    function start() {
      if (!raf && !destroyed) raf = window.requestAnimationFrame(tick);
    }

    function stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    function onEnter(event) {
      measure();
      setTarget(event);
      if (!primed) {
        primed = true;
        points.forEach(function (point) {
          point.x = target.x;
          point.y = target.y;
          point.vx = 0;
          point.vy = 0;
        });
      }
      frame.classList.add('is-hr-active');
      paint();
      start();
    }

    function onMove(event) {
      setTarget(event);
      start();
    }

    function onLeave() {
      frame.classList.remove('is-hr-active');
      stop();
    }

    listen(frame, 'pointerenter', onEnter);
    listen(frame, 'pointermove', onMove);
    listen(frame, 'pointerleave', onLeave);
    listen(frame, 'pointercancel', onLeave);
    listen(window, 'resize', measure, { passive: true });

    root.classList.add('home-hover-reveal-ready');
    paint();

    return function destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      listeners.forEach(function (entry) {
        try {
          entry[0].removeEventListener(entry[1], entry[2], entry[3]);
        } catch (ignored) {}
      });
      frame.classList.remove('is-hr-active');
      root.classList.remove('home-hover-reveal-ready');
      teardown = null;
    };
  }

  function onPreferenceChange() {
    if (!allowed() && teardown) {
      teardown();
      teardown = null;
    } else if (allowed() && !teardown) {
      teardown = boot();
    }
  }

  function init() {
    teardown = boot();
    [fineQuery, reduceQuery].forEach(function (query) {
      if (!query) return;
      if (query.addEventListener) query.addEventListener('change', onPreferenceChange);
      else if (query.addListener) query.addListener(onPreferenceChange);
    });
    window.addEventListener('pagehide', function () {
      if (teardown) teardown();
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
