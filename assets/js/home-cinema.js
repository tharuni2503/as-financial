'use strict';

(function () {
  /* Pure helpers are exported for Node-based tests; browser boot is guarded. */
  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };
  var easeInOut = function (t) {
    t = clamp(t);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  };
  var easeOut = function (t) {
    t = clamp(t);
    return 1 - Math.pow(1 - t, 3);
  };
  var easeIn = function (t) {
    t = clamp(t);
    return t * t * t;
  };

  /* Progress stays relative to one stage, never to the whole document. */
  var progressFor = function (scrollY, stageTop, stageHeight, viewportHeight) {
    var scrollable = Math.max(1, stageHeight - viewportHeight);
    return clamp((scrollY - stageTop) / scrollable);
  };

  var railOverflow = function (trackScrollWidth, viewportWidth) {
    return Math.max(0, trackScrollWidth - viewportWidth);
  };

  var phaseFor = function (progress, count) {
    var total = Math.max(1, count);
    return Math.min(total - 1, Math.floor(clamp(progress) * total));
  };

  var api = {
    clamp: clamp,
    easeInOut: easeInOut,
    easeOut: easeOut,
    easeIn: easeIn,
    progressFor: progressFor,
    railOverflow: railOverflow,
    phaseFor: phaseFor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var root = document.documentElement;
  var teardown = null;
  var reduceQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  function setVar(el, name, value) {
    if (el) el.style.setProperty(name, String(value));
  }

  /* Original word spans preserve the exact line breaks and text metrics.
     Their reveal animation is disabled in CSS; only layout is retained. */
  function splitWords(el) {
    if (!el || el.dataset.wordsReady === '1') return;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    var wordIndex = 0;
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text || !/\S/.test(text)) return;
      var frag = document.createDocumentFragment();
      text.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          return;
        }
        var span = document.createElement('span');
        span.className = 'cine-word';
        span.style.setProperty('--wd', (wordIndex++ * 42) + 'ms');
        span.textContent = part;
        frag.appendChild(span);
      });
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
    el.dataset.wordsReady = '1';
  }

  function boot() {
    if (!document.body || !document.body.classList.contains('page-home')) return null;
    if (reduceQuery && reduceQuery.matches) return null;
    if (root.classList.contains('home-cinema-ready')) return null;

    var created = [];
    var listeners = [];
    var timers = [];
    var observers = [];
    var destroyed = false;

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function later(fn, delay) {
      var id = window.setTimeout(fn, delay);
      timers.push(id);
      return id;
    }

    var stageEls = Array.prototype.slice.call(document.querySelectorAll('[data-cine-stage]'));
    var stages = {};
    stageEls.forEach(function (el) { stages[el.dataset.cineStage] = el; });
    if (Object.keys(stages).length < 5) return null;

    var hero = stages.hero.querySelector('#hero');
    var headline = hero ? hero.querySelector('h1') : null;
    var heroCopy = hero ? hero.querySelector('.hero2-copy') : null;
    var manifestoFront = document.querySelector('[data-cine-manifesto-front]');
    var manifestoGhost = document.querySelector('.cine-manifesto-copy--ghost');
    var track = document.getElementById('products-grid');
    var viewport = track ? track.parentElement : null;
    var packetDoc = document.querySelector('[data-cine-packet-document]');
    var packetPhaseEl = document.querySelector('[data-cine-packet-phase]');
    var steps = packetDoc ? Array.prototype.slice.call(packetDoc.querySelectorAll('.process-step')) : [];
    var chapters = Array.prototype.slice.call(document.querySelectorAll('[data-cine-chapter]'));
    var chapterDots = Array.prototype.slice.call(document.querySelectorAll('.cine-season-index span'));
    var moreBtn = document.querySelector('[data-products-more]');

    /* Keep the original text metrics; the reveal animation itself is off. */
    splitWords(headline);
    splitWords(manifestoFront);
    if (heroCopy && !heroCopy.hasAttribute('data-rev')) heroCopy.setAttribute('data-rev', '');

    /* The milestone labels are part of the original process design. */
    steps.forEach(function (step, index) {
      if (step.querySelector('.process-status')) return;
      var status = document.createElement('span');
      status.className = 'process-status';
      status.textContent = 'Step ' + String(index + 1).padStart(2, '0');
      step.insertBefore(status, step.firstChild);
      created.push(status);
    });

    var state = {
      stages: {},
      railOverflow: 0,
      headlineOverflow: 0,
      manifestoDelta: null,
      packetPhase: -1,
      seasonChapter: -1,
      staticMode: false,
      progress: {},
      needsMeasure: true,
      raf: 0
    };

    window.__homeCinemaState = state;

    function measure() {
      var scrollY = window.scrollY || window.pageYOffset || 0;
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      state.staticMode = (window.innerWidth || document.documentElement.clientWidth) <= 700;
      stageEls.forEach(function (el) {
        var rect = el.getBoundingClientRect();
        var height = el.offsetHeight || rect.height;
        state.stages[el.dataset.cineStage] = {
          top: Math.round((rect.top + scrollY) * 100) / 100,
          height: Math.round(height * 100) / 100,
          scrollable: Math.max(1, Math.round((height - viewportHeight) * 100) / 100)
        };
      });

      state.railOverflow = track && viewport
        ? railOverflow(track.scrollWidth, viewport.clientWidth)
        : 0;
      state.headlineOverflow = headline ? headline.scrollWidth - headline.clientWidth : 0;

      if (manifestoFront && manifestoGhost) {
        var frontRect = manifestoFront.getBoundingClientRect();
        var ghostRect = manifestoGhost.getBoundingClientRect();
        state.manifestoDelta = {
          x: Math.round((frontRect.left - ghostRect.left) * 100) / 100,
          y: Math.round((frontRect.top - ghostRect.top) * 100) / 100,
          width: Math.round((frontRect.width - ghostRect.width) * 100) / 100,
          height: Math.round((frontRect.height - ghostRect.height) * 100) / 100
        };
      }
    }

    function update(scrollY) {
      var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      var stageProgress = {};
      Object.keys(state.stages).forEach(function (name) {
        var m = state.stages[name];
        stageProgress[name] = progressFor(scrollY, m.top, m.height, viewportHeight);
        setVar(stages[name], '--' + name + '-progress', stageProgress[name].toFixed(4));
      });

      /* 1. Hero headline: a gentle lift only; size, colour and opacity stay original. */
      var heroProgress = stageProgress.hero || 0;
      setVar(stages.hero, '--hero-type-y', (-12 * easeInOut(clamp(heroProgress / 0.85))).toFixed(2) + 'px');
      setVar(stages.hero, '--hero-type-scale', '1');
      setVar(stages.hero, '--hero-type-alpha', '1');

      /* 2. Manifesto: the approved two-layer reveal, without extra scaling. */
      var manifestoProgress = stageProgress.manifesto || 0;
      setVar(stages.manifesto, '--manifesto-wipe', (100 * (1 - easeInOut(manifestoProgress))).toFixed(2) + '%');
      setVar(stages.manifesto, '--manifesto-scale', '1');

      /* 3. Products: measured horizontal rail. */
      var railProgress = stageProgress.rail || 0;
      setVar(stages.rail, '--rail-x', (-state.railOverflow * railProgress).toFixed(2) + 'px');
      setVar(stages.rail, '--rail-progress', railProgress.toFixed(4));

      /* 4. Journey: progress indicator only; every step remains visible. */
      var packetProgress = stageProgress.packet || 0;
      setVar(stages.packet, '--packet-meter', (packetProgress * 100).toFixed(2) + '%');
      var packetPhase = phaseFor(packetProgress, steps.length || 5);
      if (packetPhase !== state.packetPhase) {
        state.packetPhase = packetPhase;
        steps.forEach(function (step, index) {
          step.classList.toggle('is-packet-on', index <= packetPhase);
        });
        if (packetPhaseEl) {
          var title = steps[packetPhase] ? steps[packetPhase].querySelector('h3') : null;
          packetPhaseEl.textContent = title
            ? 'Step ' + (packetPhase + 1) + ' of ' + steps.length + ' — ' + title.textContent.trim()
            : '';
        }
      }

      /* 5. Guidance: chapter crossfade with a restrained 8px lift. */
      var activeChapter = phaseFor(stageProgress.season || 0, chapters.length || 3);
      if (activeChapter !== state.seasonChapter) {
        state.seasonChapter = activeChapter;
        chapters.forEach(function (chapter, index) {
          var active = index === activeChapter;
          var exposed = state.staticMode || active;
          chapter.classList.toggle('is-active', active);
          chapter.setAttribute('aria-hidden', exposed ? 'false' : 'true');
          chapter.inert = !exposed;
        });
        chapterDots.forEach(function (dot, index) {
          dot.classList.toggle('is-active', index === activeChapter);
        });
      }

      state.progress = stageProgress;
      state.scrollY = scrollY;
    }

    function frame() {
      state.raf = 0;
      if (destroyed) return;
      if (state.needsMeasure) {
        measure();
        state.needsMeasure = false;
      }
      update(window.scrollY || window.pageYOffset || 0);
    }

    function schedule(needsMeasure) {
      if (destroyed) return;
      if (needsMeasure) state.needsMeasure = true;
      if (state.raf) return;
      state.raf = window.requestAnimationFrame(frame);
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

    if (moreBtn) {
      listen(moreBtn, 'click', function () { later(function () { schedule(true); }, 0); });
    }

    if ('MutationObserver' in window && track) {
      var mutationObserver = new MutationObserver(function () { schedule(true); });
      mutationObserver.observe(track, { childList: true, subtree: true });
      observers.push(mutationObserver);
    }

    if ('ResizeObserver' in window) {
      var resizeObserver = new ResizeObserver(function () { schedule(true); });
      stageEls.concat([track, viewport, headline]).forEach(function (el) {
        if (el) {
          try { resizeObserver.observe(el); } catch (ignored) {}
        }
      });
      observers.push(resizeObserver);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { schedule(true); }).catch(function () {});
    }

    root.classList.add('home-cinema-ready');
    schedule(true);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (state.raf) window.cancelAnimationFrame(state.raf);
      state.raf = 0;
      listeners.forEach(function (entry) {
        try { entry[0].removeEventListener(entry[1], entry[2], entry[3]); } catch (ignored) {}
      });
      timers.forEach(function (id) { window.clearTimeout(id); });
      observers.forEach(function (observer) {
        try { observer.disconnect(); } catch (ignored) {}
      });
      created.forEach(function (el) {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      root.classList.remove('home-cinema-ready');
      window.__homeCinemaDestroy = null;
    }

    window.__homeCinemaDestroy = destroy;
    return destroy;
  }

  function init() {
    teardown = boot();
    if (reduceQuery) {
      var onChange = function (event) {
        if (event.matches) {
          if (teardown) teardown();
          teardown = null;
        } else if (!teardown) {
          teardown = boot();
        }
      };
      if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onChange);
      else if (reduceQuery.addListener) reduceQuery.addListener(onChange);
    }
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
