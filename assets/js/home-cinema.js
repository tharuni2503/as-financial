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

  /* Progress is always relative to one stage, never to the whole document. */
  var progressFor = function (scrollY, stageTop, stageHeight, viewportHeight) {
    var scrollable = Math.max(1, stageHeight - viewportHeight);
    return clamp((scrollY - stageTop) / scrollable);
  };

  /* The rail travels exactly the measured overflow, multiplied by progress. */
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

  function setVar(el, name, value) {
    if (el) el.style.setProperty(name, String(value));
  }

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
    var reduceQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
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

    /* Split only the two major text blocks, preserving existing markup. */
    splitWords(headline);
    splitWords(manifestoFront);

    /* Add status labels once; they describe real steps, never an application state. */
    steps.forEach(function (step, index) {
      if (step.querySelector('.process-status')) return;
      var status = document.createElement('span');
      status.className = 'process-status';
      status.textContent = 'Step ' + String(index + 1).padStart(2, '0');
      step.insertBefore(status, step.firstChild);
      created.push(status);
    });

    /* Reusable reveal system: one IntersectionObserver, targeted nodes only. */
    var revSelectors = [
      '.hero2-copy',
      '.sec-partners .section-head',
      '.lp2-stat',
      '.lp2-toolbar',
      '.lp2-help',
      '#products .section-head',
      '#products-grid > .pcard',
      '#products .more-wrap',
      '.profiles',
      '#process-home .section-head',
      '#calculator .section-head',
      '.calc-tabs-card',
      '.ambak-field',
      '#why-us .split-media',
      '#why-us .split > .reveal',
      '.sec-guides .section-head',
      '.blog-grid > .blog-card',
      '#faq .faq-side',
      '#faq .faq-item',
      '#visit-us .visit > *',
      '.sec-cta .cta-card',
      '.footer-compact > *',
      '.footer-bottom > *'
    ];

    var revSet = [];
    var seenRev = [];
    revSelectors.forEach(function (selector) {
      Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (el) {
        if (seenRev.indexOf(el) === -1) {
          seenRev.push(el);
          revSet.push(el);
        }
      });
    });

    revSet.forEach(function (el, index) {
      if (!el.hasAttribute('data-rev')) el.setAttribute('data-rev', '');
      if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', Math.min(index % 8, 7) * 45 + 'ms');
    });

    var groupSelectors = [
      '.lp2-stats > *',
      '#products-grid > .pcard',
      '.ambak-field',
      '.blog-grid > .blog-card',
      '#faq .faq-item'
    ];
    groupSelectors.forEach(function (selector) {
      Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (el, index) {
        el.style.setProperty('--d', Math.min(index * 60, 360) + 'ms');
      });
    });

    var revObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-rev');
        revObserver.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '80px 0px -10% 0px' });
    observers.push(revObserver);
    revSet.forEach(function (el) { revObserver.observe(el); });

    function watchDynamic(node) {
      if (!node || node.nodeType !== 1) return;
      var rows = [];
      if (node.matches && node.matches('.lp2-grid > *')) rows.push(node);
      if (node.querySelectorAll) {
        Array.prototype.slice.call(node.querySelectorAll('.lp2-grid > *')).forEach(function (row) { rows.push(row); });
      }
      rows.forEach(function (row) {
        if (row.hasAttribute('data-rev')) return;
        row.setAttribute('data-rev', '');
        row.style.setProperty('--d', Math.min(Array.prototype.indexOf.call(row.parentNode.children, row) * 45, 360) + 'ms');
        revObserver.observe(row);
      });
    }

    var mutationObserver = new MutationObserver(function (mutations) {
      var railChanged = false;
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, watchDynamic);
        if (track && (mutation.target === track || (mutation.target && mutation.target.closest && mutation.target.closest('#products-grid')))) {
          railChanged = true;
        }
      });
      if (railChanged) schedule(true);
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    observers.push(mutationObserver);

    var state = {
      stages: {},
      railOverflow: 0,
      headlineOverflow: 0,
      manifestoDelta: null,
      packetPhase: -1,
      seasonChapter: -1,
      needsMeasure: true,
      raf: 0
    };

    window.__homeCinemaState = state;
    window.__homeCinema = api;

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

      var heroProgress = stageProgress.hero || 0;
      var heroY = -42 * easeInOut(clamp(heroProgress / 0.85));
      setVar(stages.hero, '--hero-type-y', heroY.toFixed(2) + 'px');
      setVar(stages.hero, '--hero-lede-y', (heroY * 0.35).toFixed(2) + 'px');
      setVar(stages.hero, '--hero-type-scale', (1 - 0.07 * easeOut(clamp((heroProgress - 0.08) / 0.92))).toFixed(3));
      setVar(stages.hero, '--hero-type-alpha', (1 - easeIn(clamp((heroProgress - 0.42) / 0.58))).toFixed(3));
      setVar(stages.hero, '--hero-line', easeOut(clamp(heroProgress / 0.72)).toFixed(3));

      var manifestoProgress = stageProgress.manifesto || 0;
      setVar(stages.manifesto, '--manifesto-wipe', (100 * (1 - easeInOut(manifestoProgress))).toFixed(2) + '%');
      setVar(stages.manifesto, '--manifesto-scale', (1 + 0.025 * (1 - easeOut(manifestoProgress))).toFixed(3));
      setVar(stages.manifesto, '--manifesto-line', easeOut(clamp(manifestoProgress / 0.8)).toFixed(3));

      var railProgress = stageProgress.rail || 0;
      setVar(stages.rail, '--rail-x', (-state.railOverflow * railProgress).toFixed(2) + 'px');
      setVar(stages.rail, '--rail-progress', railProgress.toFixed(4));

      var packetProgress = stageProgress.packet || 0;
      setVar(stages.packet, '--packet-alpha', easeOut(clamp(packetProgress / 0.16)).toFixed(3));
      setVar(stages.packet, '--packet-enter', ((1 - easeOut(clamp(packetProgress / 0.32))) * 34).toFixed(2) + 'px');
      setVar(stages.packet, '--packet-scale', (0.965 + 0.035 * easeOut(clamp(packetProgress / 0.36))).toFixed(3));
      setVar(stages.packet, '--packet-cut', (100 * (1 - easeInOut(clamp(packetProgress / 0.55)))).toFixed(2) + '%');
      setVar(stages.packet, '--packet-meter', (packetProgress * 100).toFixed(2) + '%');
      setVar(stages.packet, '--packet-copy-x', ((1 - easeOut(clamp((packetProgress - 0.15) / 0.6))) * 18).toFixed(2) + 'px');

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

      var seasonProgress = stageProgress.season || 0;
      setVar(stages.season, '--season-y', ((0.5 - seasonProgress) * 24).toFixed(2) + 'px');
      setVar(stages.season, '--season-scale', (1 + 0.035 * (1 - seasonProgress)).toFixed(3));
      setVar(stages.season, '--season-line', easeOut(clamp(seasonProgress / 0.85)).toFixed(3));

      var activeChapter = phaseFor(seasonProgress, chapters.length || 3);
      if (activeChapter !== state.seasonChapter) {
        state.seasonChapter = activeChapter;
        chapters.forEach(function (chapter, index) {
          var active = index === activeChapter;
          chapter.classList.toggle('is-active', active);
          /* On phones all chapters are shown, so none may be hidden from AT. */
          chapter.setAttribute('aria-hidden', state.staticMode || active ? 'false' : 'true');
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

    /* Failsafe: if IntersectionObserver never fires, nothing stays hidden. */
    later(function () {
      Array.prototype.slice.call(document.querySelectorAll('[data-rev]')).forEach(function (el) {
        el.classList.add('is-rev');
      });
    }, 2400);

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
      root.classList.remove('home-cinema-ready');
      window.__homeCinemaDestroy = null;
    }

    window.__homeCinemaDestroy = destroy;
    return destroy;
  }

  function init() {
    teardown = boot();
    if (reduceQuerySupported()) {
      var query = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function (event) {
        if (event.matches) {
          if (teardown) teardown();
          teardown = null;
        } else if (!teardown) {
          teardown = boot();
        }
      };
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
    window.addEventListener('pagehide', function () {
      if (teardown) teardown();
      teardown = null;
    }, { once: true });
  }

  function reduceQuerySupported() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
