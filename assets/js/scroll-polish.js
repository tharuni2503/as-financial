/* ==========================================================================
   AS Financial Services — lightweight scroll polish.

   Adds reversible reveal states to existing semantic elements, labels
   scrollable regions for keyboard users, and tidies the live ticker. This
   script is progressive: without it, all content remains visible.
   ========================================================================== */

(function () {
  'use strict';

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  /* Accessibility fixes run regardless of animation preference. */
  function labelScrollRegions() {
    qsa('.testi-grid, .table-wrap, .schedule-wrap, .table-responsive').forEach(function (el) {
      if (!el || el.scrollWidth <= el.clientWidth + 2) return;
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
      if (!el.hasAttribute('role')) el.setAttribute('role', 'region');
      if (!el.hasAttribute('aria-label')) {
        el.setAttribute('aria-label', el.classList.contains('testi-grid')
          ? 'Customer testimonials, scrollable'
          : 'Scrollable table');
      }
    });
  }

  function tidyTicker() {
    var ticker = document.querySelector('.live-ticker');
    if (!ticker) return;
    if (ticker.getAttribute('aria-live') !== 'off') ticker.setAttribute('aria-live', 'off');

    var items = qsa('.live-ticker-item', ticker);
    var half = Math.floor(items.length / 2);
    items.forEach(function (item, index) {
      if (index >= half) item.setAttribute('aria-hidden', 'true');
    });
  }

  function enableFaqFocus() {
    qsa('.faq-item').forEach(function (item) {
      var button = item.querySelector('.faq-q');
      if (!button || button.dataset.spFocus === '1') return;
      button.dataset.spFocus = '1';
      button.addEventListener('focus', function () {
        if (!item.classList.contains('open')) button.click();
      });
    });
  }

  labelScrollRegions();
  tidyTicker();
  enableFaqFocus();
  document.addEventListener('DOMContentLoaded', function () {
    labelScrollRegions();
    tidyTicker();
    enableFaqFocus();
  });

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;

  var revealSelector = [
    '.reveal',
    '.reveal-left',
    '.reveal-right',
    '.reveal-zoom',
    '.lp2-item',
    '.pcard',
    '.blog-card',
    '.process-step',
    '.calc-panel',
    '.form-card',
    '.faq-item'
  ].join(',');

  var seen = new WeakSet();
  var queued = false;
  var count = 0;

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      entry.target.classList.toggle('sp-in', entry.isIntersecting);
    });
  }, { threshold: 0.06, rootMargin: '0px 0px -6% 0px' });

  function kindFor(el) {
    var cls = String(el.className || '');
    if (/^H[1-2]$/.test(el.tagName)) return 'sp-heading';
    if (/(pcard|lp2-item|blog-card|faq-item|calc-panel|form-card)/.test(cls)) return 'sp-card';
    return '';
  }

  function addTarget(el) {
    if (!el || seen.has(el)) return;
    seen.add(el);
    el.classList.add('sp-reveal');
    var kind = kindFor(el);
    if (kind) el.classList.add(kind);
    el.style.setProperty('--sp-delay', ((count % 4) * 55) + 'ms');
    count += 1;
    observer.observe(el);
  }

  function register(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(revealSelector)) addTarget(root);
    if (root.querySelectorAll) qsa(revealSelector, root).forEach(addTarget);
  }

  register(document.body);

  qsa('.section-head h2, .hero2 h1, .page-hero h1').forEach(function (heading) {
    if (!heading.closest('.sp-reveal')) addTarget(heading);
  });

  document.documentElement.classList.add('sp-ready');

  function revealVisible() {
    var viewH = window.innerHeight || document.documentElement.clientHeight || 0;
    qsa('.sp-reveal').forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top < viewH * .94 && rect.bottom > 0) el.classList.add('sp-in');
    });
  }

  window.setTimeout(revealVisible, 120);
  window.addEventListener('load', revealVisible, { once: true });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) revealVisible();
  });

  if ('MutationObserver' in window) {
    new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, function (node) {
          if (node.nodeType === 1) register(node);
        });
      });
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        labelScrollRegions();
        tidyTicker();
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
