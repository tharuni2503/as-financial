'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('admin.html');
const js = read('assets/js/admin.js');
const css = read('assets/css/admin.css');

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp('(?:^|\\n)\\s*' + escaped + '\\s*\\{([^}]*)\\}'));
  return match ? match[1] : '';
}

test('admin uses a Manrope-only premium type and colour system', () => {
  assert.ok(!/Playfair/i.test(html), 'admin page does not request Playfair Display');
  assert.ok(!/Playfair/i.test(css), 'admin stylesheet does not request Playfair Display');
  assert.ok(/fonts\.googleapis\.com\/css2\?family=Manrope:/.test(html), 'admin page requests Manrope');
  const manropeRequests = (html.match(/fonts\.googleapis\.com\/css2\?family=Manrope:/g) || []).length +
    (css.match(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Manrope/g) || []).length;
  assert.equal(manropeRequests, 1, 'Manrope is requested exactly once');
  assert.ok(html.indexOf('assets/css/admin.css') > html.indexOf('assets/css/pro-light.css'), 'admin theme loads last');
  assert.ok(css.includes("--sans: 'Manrope'"), 'sans token is Manrope');
  assert.ok(css.includes("--serif: 'Manrope'"), 'display token is also Manrope');
  assert.ok(/h1, h2, h3, h4, h5 \{[^}]*font-family: var\(--sans\)/.test(css), 'headings use the Manrope token');
  for (const token of ['--navy:', '--gold:', '--surface:', '--radius-lg:', '--shadow-sm:']) {
    assert.ok(css.includes(token), 'premium token ' + token);
  }
});

test('admin shell presents one coherent CRM surface', () => {
  assert.ok(/\.admin-sidebar \{[^}]*linear-gradient/.test(css), 'navy sidebar uses a premium gradient');
  assert.ok(/\.card \{[^}]*border-radius: var\(--radius-lg\)/.test(css), 'cards share the radius token');
  assert.ok(/\.a-btn-primary \{[^}]*linear-gradient/.test(css), 'primary actions share a premium fill');
  assert.ok(/\.priority-board/.test(css), 'dashboard priority board is styled');
  assert.ok(/\.chart-wrap/.test(css), 'charts are styled in the design system');
  assert.ok(!html.includes('class="bottom-nav"'), 'legacy bottom navigation stays removed');
});

test('admin controls meet the 44px touch-target floor', () => {
  for (const selector of ['.pagination button', '.notif-state-tab', '.view-shortcut', '.admin-burger', '.icon-btn', '.a-btn']) {
    const body = ruleBody(selector);
    assert.ok(body, 'rule exists for ' + selector);
    assert.ok(/min-height:\s*44px|height:\s*44px/.test(body), selector + ' is at least 44px tall');
  }
  assert.ok(!/notif-refresh[^>]*style="[^"]*width:\s*32px/i.test(html), 'top-bar refresh button keeps the shared icon size');
  assert.ok(!/refresh-notifications[^>]*style="[^"]*width:\s*32px/i.test(js), 'feed refresh button keeps the shared icon size');
});

test('dense admin tables become labelled cards on small screens', () => {
  const responsiveTables = html.match(/class="[^"]*responsive-cards/g) || [];
  assert.ok(responsiveTables.length >= 12, 'all dense tables opt into responsive cards');
  assert.ok(css.includes('.a-table.responsive-cards'), 'responsive card tables are styled');
  assert.ok(css.includes('content: attr(data-label)'), 'card cells expose their column label');
  assert.ok(/@media \(max-width: 640px\)/.test(css), 'cards activate at phone width');
  for (const label of ['Customer', 'Product', 'Name', 'Lead', 'When']) {
    assert.ok(js.includes('data-label="' + label + '"'), 'generated rows label the ' + label + ' column');
  }
});

test('notification history distinguishes every maintained state', () => {
  for (const state of ['all', 'pending', 'unread', 'acknowledged', 'dismissed', 'completed', 'superseded']) {
    assert.ok(html.includes('data-notif-state="' + state + '"'), 'notification tab ' + state);
  }
  for (const state of ['completed', 'superseded']) {
    assert.ok(html.includes('id="notif-tab-count-' + state + '"'), state + ' count has a stable target');
  }
  assert.ok(js.includes("state === 'completed'"), 'client derives completed state from server state');
  assert.ok(js.includes("state === 'superseded'"), 'client derives superseded state from server state');
  assert.ok(js.includes('notificationStateCounts = data && data.stateCounts'), 'server state counts are stored');
  assert.ok(js.includes('superseded: all.filter(n => notificationState(n) === \'superseded\').length'), 'local fallback includes superseded');
  assert.ok(js.includes('class="notif-row state-\''), 'rows carry a state class');
  assert.ok(js.includes("badge-state-' + esc(state)"), 'state chips use distinct styling');
  for (const state of ['pending', 'acknowledged', 'dismissed', 'completed']) {
    assert.ok(css.includes('.badge-state-' + state), 'chip style for ' + state);
  }
  assert.ok(css.includes('.notif-row.state-completed'), 'completed rows have a distinct treatment');
  assert.ok(js.includes('feed-state loading-state'), 'loading uses a dedicated feed state');
  assert.ok(js.includes('feed-state error-state'), 'errors use a dedicated feed state');
});

test('redesign keeps the notification fetch and navigation invariants', () => {
  assert.ok(js.includes('function setView(view, skipHash)'), 'setView is retained');
  assert.ok(!js.includes('function showView('), 'showView is not reintroduced');
  const renderView = js.match(/function renderView\(view\) \{[\s\S]*?\n  \}/);
  assert.ok(renderView, 'renderView exists');
  assert.ok(!renderView[0].includes('syncNotifications'), 'renderView never fetches notifications');
  assert.ok(js.includes("if (view === 'notifications') syncNotifications();"), 'navigation fetches notifications once');
  assert.ok(js.includes('syncNotifications(1);'), 'reload history forces a server refresh');
  assert.ok(js.includes('navNotif.textContent = String(counts.pending || 0);'), 'nav badge remains server-authoritative');
});
