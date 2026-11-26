'use strict';

(function () {
  /* Pure helpers are exported for Node tests; browser boot is guarded below. */
  var clamp = function (value, min, max) {
    min = min === undefined ? 0 : min;
    max = max === undefined ? 1 : max;
    return Math.min(max, Math.max(min, value));
  };

  var round2 = function (value) {
    return Math.round(value * 100) / 100;
  };

  var easeInOut = function (value) {
    var t = clamp(value);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  };

  var easeOut = function (value) {
    var t = clamp(value);
    return 1 - Math.pow(1 - t, 3);
  };

  var easeIn = function (value) {
    var t = clamp(value);
    return t * t * t;
  };

  /* A pinned stage runs from when its child sticks until the wrapper ends. */
  var stageWindow = function (stageTop, stageHeight, pinnedHeight, stickyTop) {
    return {
      start: round2(stageTop - (stickyTop || 0)),
      travel: Math.max(1, round2((stageHeight || 0) - (pinnedHeight || 0)))
    };
  };

  var progressFor = function (scrollY, start, travel) {
    return clamp((scrollY - start) / Math.max(1, travel));
  };

  /* The rail travels exactly its measured overflow, never a guessed distance. */
  var railOverflow = function (trackScrollWidth, viewportWidth) {
    return Math.max(0, (trackScrollWidth || 0) - (viewportWidth || 0));
  };

  var phaseFor = function (progress, count) {
    var total = Math.max(1, count || 1);
    return Math.min(total - 1, Math.floor(clamp(progress) * total));
  };

  /* Milestones finish before the stage ends, leaving a calm hold at the end. */
  var milestoneFor = function (progress, count, completeAt) {
    var span = completeAt && completeAt > 0 ? completeAt : 1;
    return phaseFor(progress / span, count);
  };

  var textFitOverflow = function (scrollWidth, clientWidth) {
    return Math.max(0, (scrollWidth || 0) - (clientWidth || 0));
  };

  var alignmentDelta = function (frontRect, ghostRect) {
    if (!frontRect || !ghostRect) return null;
    return {
      x: round2((frontRect.left || 0) - (ghostRect.left || 0)),
      y: round2((frontRect.top || 0) - (ghostRect.top || 0)),
      width: round2((frontRect.width || 0) - (ghostRect.width || 0)),
      height: round2((frontRect.height || 0) - (ghostRect.height || 0))
    };
  };

  var api = {
    clamp: clamp,
    easeInOut: easeInOut,
    easeOut: easeOut,
    easeIn: easeIn,
    stageWindow: stageWindow,
    progressFor: progressFor,
    railOverflow: railOverflow,
    phaseFor: phaseFor,
    milestoneFor: milestoneFor,
    textFitOverflow: textFitOverflow,
    alignmentDelta: alignmentDelta
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  var root = document.documentElement;
  var MOBILE_BREAKPOINT = 700;
  var JOURNEY_COMPLETE = 0.82;
  var GUIDANCE_COMPLETE = 0.78;
  var teardown = null;
  var motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

  function setVar(el, name, value) {
    if (el) el.style.setProperty(name, String(value));
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, String(attrs[key]));
    });
    return el;
  }

  /* Decorative financial-line artwork is generated once, never loaded as stock imagery. */
  function createHeroArtwork(host) {
    if (!host || host.dataset.storyArtReady === '1') return;
    var svg = svgEl('svg', {
      'class': 'story-finline',
      viewBox: '0 0 600 320',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      focusable: 'false'
    });

    var defs = svgEl('defs', {});
    var gradient = svgEl('linearGradient', {
      id: 'story-finline-fill',
      x1: '0', y1: '0', x2: '0', y2: '1'
    });
    gradient.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#C49A45', 'stop-opacity': '.22' }));
    gradient.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#C49A45', 'stop-opacity': '0' }));
    defs.appendChild(gradient);
    svg.appendChild(defs);

    var grid = svgEl('path', {
      'class': 'story-finline__grid',
      d: 'M20 80H580 M20 160H580 M20 240H580 M20 40V280 M170 40V280 M320 40V280 M470 40V280'
    });
    svg.appendChild(grid);

    var points = [
      [20, 248], [74, 232], [128, 242], [182, 196], [236, 214],
      [290, 158], [344, 178], [398, 112], [452, 138], [506, 78], [560, 96]
    ];
    var linePath = points.map(function (point, index) {
      return (index ? 'L' : 'M') + point[0] + ' ' + point[1];
    }).join(' ');

    svg.appendChild(svgEl('path', {
      'class': 'story-finline__area',
      d: linePath + ' L560 280 L20 280 Z'
    }));
    svg.appendChild(svgEl('path', {
      'class': 'story-finline__line',
      pathLength: '1',
      d: linePath
    }));
    var last = points[points.length - 1];
    svg.appendChild(svgEl('circle', {
      'class': 'story-finline__point',
      cx: last[0], cy: last[1], r: '4'
    }));

    host.appendChild(svg);
    host.dataset.storyArtReady = '1';
  }

  function boot() {
    if (!document.body || !document.body.classList.contains('page-home')) return null;
    if (motionQuery && motionQuery.matches) return null;
    if (root.classList.contains('home-scroll-story-ready')) return null;

    var created = [];
    var listeners = [];
    var timers = [];
    var observers = [];
    var destroyed = false;
    var chromeEls = [
      document.querySelector('.topbar'),
      document.querySelector('.site-header'),
      document.querySelector('.live-ticker')
    ];

    /* Pinned sections use the real bottom edge of the fixed chrome rather than
       a guessed custom-property total. */
    function measureChrome() {
      var bottom = 0;
      chromeEls.forEach(function (el) {
        if (!el) return;
        var style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
        var rect = el.getBoundingClientRect();
        bottom = Math.max(bottom, rect.bottom || 0);
      });
      if (bottom > 0) setVar(document.body, '--story-chrome-h', Math.ceil(bottom) + 'px');
    }

    function listen(target, type, fn, options) {
      target.addEventListener(type, fn, options);
      listeners.push([target, type, fn, options]);
    }

    function later(fn, delay) {
      var id = window.setTimeout(fn, delay);
      timers.push(id);
      return id;
    }

    var stageEls = Array.prototype.slice.call(document.querySelectorAll('[data-story-stage]'));
    if (stageEls.length < 5) return null;

    var stages = {};
    var stageList = [];
    stageEls.forEach(function (el) {
      var name = el.dataset.storyStage;
      stages[name] = el;
      stageList.push({ name: name, el: el });
    });
    if (!stages.hero || !stages.manifesto || !stages.rail || !stages.journey || !stages.guidance) return null;

    var hero = stages.hero.querySelector('#hero');
    var headline = document.querySelector('[data-story-hero-headline]');
    var lede = document.querySelector('[data-story-hero-lede]');
    var heroImage = document.querySelector('[data-story-hero-image]');
    var heroArt = document.querySelector('[data-story-hero-art]');
    var manifestoFront = document.querySelector('[data-story-manifesto-front]');
    var manifestoGhost = document.querySelector('[data-story-manifesto-ghost]');
    var manifestoInner = stages.manifesto.querySelector('.story-stage-inner');
    var track = document.querySelector('[data-story-rail-track]');
    var railViewport = document.querySelector('[data-story-rail-viewport]');
    var journeyDoc = document.querySelector('[data-story-journey-document]');
    var journeyPhase = document.querySelector('[data-story-journey-phase]');
    var steps = journeyDoc ? Array.prototype.slice.call(journeyDoc.querySelectorAll('.process-step')) : [];
    var guidanceInner = stages.guidance.querySelector('.story-stage-inner');
    var guidanceArt = document.querySelector('[data-story-guidance-art]');
    var chapters = Array.prototype.slice.call(document.querySelectorAll('[data-story-chapter]'));
    var chapterDots = Array.prototype.slice.call(document.querySelectorAll('.story-guidance-index span'));
    var moreBtn = document.querySelector('[data-products-more]');

    createHeroArtwork(heroArt);

    /* Labels describe genuine process steps only; no application or approval state is invented. */
    steps.forEach(function (step, index) {
      if (step.querySelector('.process-status')) return;
      var status = document.createElement('span');
      status.className = 'process-status';
      status.textContent = 'Step ' + String(index + 1).padStart(2, '0');
      step.insertBefore(status, step.firstChild);
      created.push(status);
    });

    var pinnedByStage = {
      hero: hero,
      manifesto: manifestoInner,
      rail: stages.rail.querySelector('#products'),
      journey: journeyDoc,
      guidance: guidanceInner
    };

    var state = {
      stages: {},
      staticMode: false,
      railOverflow: 0,
      headlineFit: 0,
      manifestoAlignment: null,
      milestone: -1,
      chapter: -1,
      needsMeasure: true,
      raf: 0
    };

    window.__homeScrollStory = api;
    window.__homeScrollStoryState = state;

    function measure() {
      var wasStatic = state.staticMode;
      var scrollY = window.scrollY || window.pageYOffset || 0;
      measureChrome();
      state.staticMode = (window.innerWidth || document.documentElement.clientWidth) <= MOBILE_BREAKPOINT;
      if (wasStatic !== state.staticMode) state.chapter = -1;

      stageList.forEach(function (item) {
        var el = item.el;
        var rect = el.getBoundingClientRect();
        var pinned = pinnedByStage[item.name];
        var stageTop = rect.top + scrollY;
        var windowRange;

        if (state.staticMode || !pinned) {
          windowRange = { start: round2(stageTop), travel: 1 };
        } else {
          var stickyTop = parseFloat(window.getComputedStyle(pinned).top) || 0;
          var pinnedHeight = pinned.getBoundingClientRect().height || pinned.offsetHeight || 0;
          windowRange = stageWindow(stageTop, rect.height || el.offsetHeight || 0, pinnedHeight, stickyTop);
        }

        state.stages[item.name] = windowRange;
      });

      state.railOverflow = track && railViewport
        ? railOverflow(track.scrollWidth, railViewport.clientWidth)
        : 0;
      state.railCardCount = track ? track.querySelectorAll('.pcard').length : 0;
      state.visibleRailCards = track
        ? Array.prototype.filter.call(track.querySelectorAll('.pcard'), function (card) {
            return window.getComputedStyle(card).display !== 'none';
          }).length
        : 0;
      state.headlineFit = headline ? textFitOverflow(headline.scrollWidth, headline.clientWidth) : 0;

      if (manifestoFront && manifestoGhost) {
        /* getBoundingClientRect includes the previous correction; clear it
           first so repeated measurements cannot drift the duplicate text. */
        setVar(stages.manifesto, '--story-manifesto-x', '0px');
        setVar(stages.manifesto, '--story-manifesto-y', '0px');
        state.manifestoAlignment = alignmentDelta(
          manifestoFront.getBoundingClientRect(),
          manifestoGhost.getBoundingClientRect()
        );
        setVar(stages.manifesto, '--story-manifesto-x', (state.manifestoAlignment.x || 0) + 'px');
        setVar(stages.manifesto, '--story-manifesto-y', (state.manifestoAlignment.y || 0) + 'px');
      }
    }

    function update(scrollY) {
      var progress = {};
      stageList.forEach(function (item) {
        var measured = state.stages[item.name] || { start: 0, travel: 1 };
        progress[item.name] = progressFor(scrollY, measured.start, measured.travel);
        setVar(item.el, '--story-' + item.name + '-progress', progress[item.name].toFixed(4));
      });

      var heroProgress = progress.hero || 0;
      var fitCap = Math.min(state.headlineFit || 0, 120);
      var heroShift = 18 * easeInOut(clamp(heroProgress / 0.85));
      var heroScale = Math.max(0.94, 1 - 0.045 * easeOut(clamp((heroProgress - 0.08) / 0.92)) - fitCap * 0.00025);
      /* No headline translate: the poster can scale but never clip the first
         line. Only the supporting copy and image use gentle parallax. */
      setVar(stages.hero, '--story-hero-lede-y', (-heroShift * 0.4).toFixed(2) + 'px');
      setVar(stages.hero, '--story-hero-headline-scale', heroScale.toFixed(3));
      setVar(stages.hero, '--story-hero-alpha', (1 - easeIn(clamp((heroProgress - 0.48) / 0.52))).toFixed(3));
      setVar(stages.hero, '--story-hero-image-y', (heroShift * 0.55).toFixed(2) + 'px');
      setVar(stages.hero, '--story-hero-image-scale', (1 + 0.035 * easeInOut(heroProgress)).toFixed(3));
      setVar(stages.hero, '--story-hero-line', easeOut(clamp(heroProgress / 0.72)).toFixed(3));

      var manifestoProgress = progress.manifesto || 0;
      setVar(stages.manifesto, '--story-manifesto-wipe', (100 * (1 - easeInOut(manifestoProgress))).toFixed(2) + '%');
      setVar(stages.manifesto, '--story-manifesto-scale', (1 + 0.025 * (1 - easeOut(manifestoProgress))).toFixed(3));
      setVar(stages.manifesto, '--story-manifesto-line', easeOut(clamp(manifestoProgress / 0.8)).toFixed(3));

      var railProgress = progress.rail || 0;
      if (state.staticMode && railViewport) {
        railProgress = clamp(railViewport.scrollLeft / Math.max(1, state.railOverflow));
      }
      setVar(stages.rail, '--story-rail-x', state.staticMode ? '0px' : (-state.railOverflow * railProgress).toFixed(2) + 'px');
      setVar(stages.rail, '--story-rail-progress', railProgress.toFixed(4));

      var journeyProgress = progress.journey || 0;
      var journeyDraw = clamp(journeyProgress / JOURNEY_COMPLETE);
      /* The flow and every step are visible from the first frame; progress
         only fills the meter and highlights milestones. */
      setVar(stages.journey, '--story-journey-meter', (journeyDraw * 100).toFixed(2) + '%');

      var milestone = milestoneFor(journeyProgress, steps.length || 5, JOURNEY_COMPLETE);
      if (milestone !== state.milestone) {
        state.milestone = milestone;
        steps.forEach(function (step, index) {
          step.classList.toggle('is-story-milestone', index <= milestone);
        });
        if (journeyPhase) {
          var title = steps[milestone] ? steps[milestone].querySelector('h3') : null;
          journeyPhase.textContent = title
            ? 'Step ' + String(milestone + 1).padStart(2, '0') + ' of ' + String(steps.length).padStart(2, '0') + ' — ' + title.textContent.trim()
            : '';
        }
      }

      var guidanceProgress = progress.guidance || 0;
      setVar(stages.guidance, '--story-guidance-y', ((0.5 - guidanceProgress) * 24).toFixed(2) + 'px');
      setVar(stages.guidance, '--story-guidance-scale', (1 + 0.035 * (1 - guidanceProgress)).toFixed(3));
      setVar(stages.guidance, '--story-guidance-line', easeOut(clamp(guidanceProgress / GUIDANCE_COMPLETE)).toFixed(3));
      setVar(guidanceArt, '--story-guidance-y', ((0.5 - guidanceProgress) * 24).toFixed(2) + 'px');
      setVar(guidanceArt, '--story-guidance-scale', (1 + 0.035 * (1 - guidanceProgress)).toFixed(3));

      var chapter = milestoneFor(guidanceProgress, chapters.length || 3, GUIDANCE_COMPLETE);
      if (chapter !== state.chapter) {
        state.chapter = chapter;
        chapters.forEach(function (item, index) {
          var active = index === chapter;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-hidden', state.staticMode || active ? 'false' : 'true');
          if ('inert' in item) item.inert = !active && !state.staticMode;
        });
        chapterDots.forEach(function (dot, index) {
          dot.classList.toggle('is-active', index === chapter);
        });
      }

      state.progress = progress;
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
    var onRailScroll = function () { schedule(false); };
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
    if (railViewport) listen(railViewport, 'scroll', onRailScroll, { passive: true });
    if (moreBtn) {
      listen(moreBtn, 'click', function () { later(function () { schedule(true); }, 0); });
    }

    if ('ResizeObserver' in window) {
      var resizeObserver = new ResizeObserver(function () { schedule(true); });
      [stages.hero, stages.manifesto, stages.rail, stages.journey, stages.guidance,
        track, railViewport, headline, manifestoFront].forEach(function (el) {
        if (el) {
          try { resizeObserver.observe(el); } catch (ignored) {}
        }
      });
      observers.push(resizeObserver);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { schedule(true); }).catch(function () {});
    }

    root.classList.add('home-scroll-story-ready');
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
      chapters.forEach(function (item) {
        item.classList.remove('is-active');
        item.setAttribute('aria-hidden', 'false');
        if ('inert' in item) item.inert = false;
      });
      document.body.style.removeProperty('--story-chrome-h');
      root.classList.remove('home-scroll-story-ready');
      window.__homeScrollStoryDestroy = null;
    }

    window.__homeScrollStoryDestroy = destroy;
    return destroy;
  }

  function init() {
    teardown = boot();
  }

  if (motionQuery) {
    var onMotionChange = function (event) {
      if (event.matches) {
        if (teardown) teardown();
        teardown = null;
      } else if (!teardown) {
        teardown = boot();
      }
    };
    if (motionQuery.addEventListener) motionQuery.addEventListener('change', onMotionChange);
    else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
  }

  window.addEventListener('pagehide', function () {
    if (teardown) teardown();
    teardown = null;
  }, { once: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
