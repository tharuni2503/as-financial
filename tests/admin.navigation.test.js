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

test('admin has one follow-up workflow and one live follow-up table', () => {
  assert.equal((html.match(/id="view-followups"/g) || []).length, 1, 'one follow-up view');
  assert.equal((html.match(/id="followups-body"/g) || []).length, 1, 'one follow-up body');
  assert.equal((js.match(/function renderFollowups\(/g) || []).length, 1, 'one renderer for the live follow-up table');
  assert.ok(!/else if \(view === 'followups'\) renderFollowups\(\);/.test(js), 'unreachable duplicate render branch was removed');
});

test('sidebar uses the agreed grouped hierarchy', () => {
  const navMatch = html.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/);
  assert.ok(navMatch, 'sidebar navigation exists');
  const nav = navMatch[0];
  const expected = [
    'data-view="overview"', 'data-view="leads"', 'data-view="followups"',
    'data-view="notifications"', 'data-view="applications"', 'data-view="analytics"',
    'data-view="customers"', 'data-view="partners"', 'data-view="content"',
    'data-view="health"', 'data-view="audit"', 'data-view="settings"'
  ];
  let cursor = 0;
  expected.forEach((needle) => {
    const at = nav.indexOf(needle, cursor);
    assert.ok(at > -1, 'missing or out-of-order nav item ' + needle);
    cursor = at + needle.length;
  });
  assert.ok(nav.includes('>Main<'), 'Main group');
  assert.ok(nav.includes('>Management<'), 'Management group');
  assert.ok(nav.includes('>System<'), 'System group');
  assert.ok(nav.includes('Analytics &amp; Reports'), 'Analytics & Reports label');
  assert.ok(nav.includes('Lenders &amp; Products'), 'Lenders & Products label');
  assert.ok(nav.includes('Activity &amp; Security'), 'Activity & Security label');
});

test('dashboard puts enquiries and today\'s follow-up work above analytics', () => {
  const board = html.match(/<div class="card priority-board"[\s\S]*?<\/div>\s*<div class="kpi-grid">/);
  assert.ok(board, 'priority board sits before the KPI grid');
  for (const id of ['ov-priority-enquiries', 'ov-priority-overdue', 'ov-priority-today']) {
    assert.ok(html.includes('id="' + id + '"'), 'priority metric ' + id);
  }
  assert.ok(html.includes('data-followup-bucket="overdue"'), 'overdue shortcut preselects the bucket');
  assert.ok(html.includes('data-followup-bucket="today"'), 'today shortcut preselects the bucket');
  assert.ok(js.includes('function renderPriorityBoard()'), 'priority board renderer exists');
  assert.ok(js.includes("ASDateFormat.todayISO()"), 'priority counts use the Asia/Kolkata-aware date helper');
  assert.ok(!html.includes('id="ov-loan-categories-chart"'), 'duplicate overview donut removed');
  assert.ok(!html.includes('id="ov-top-lenders"'), 'secondary overview ranking removed');
  for (const view of ['reports', 'funnel', 'recovery', 'marketing', 'growth', 'partners', 'products']) {
    assert.ok(html.includes('data-view-shortcut data-view="' + view + '"'), 'dashboard shortcut for ' + view);
  }
});

test('notification history has explicit, non-destructive state controls', () => {
  for (const state of ['all', 'pending', 'unread', 'acknowledged', 'dismissed', 'completed', 'superseded']) {
    assert.ok(html.includes('data-notif-state="' + state + '"'), 'notification tab ' + state);
  }
  assert.ok(js.includes('function matchesNotificationState('), 'client-side state filter exists');
  assert.ok(js.includes("notificationStateFilter = 'all'"), 'default state is all history');
  assert.ok(js.includes("navNotif.textContent = String(counts.pending || 0);"), 'nav badge reflects pending state');
  assert.ok(!html.includes('Clear all'), 'no button implies notification history can be erased');
  assert.ok(js.includes('syncNotifications(1);'), 'reload history refetches the server instead of wiping local state');
  const tabHandler = js.match(/\$\$\('\.notif-state-tab'\)\.forEach\(tab => tab\.addEventListener\('click', \(\) => \{[\s\S]*?\n    \}\)\);/);
  assert.ok(tabHandler, 'state tabs have a click handler');
  assert.ok(tabHandler[0].includes('syncNotifications(1);'), 'state tabs refetch the server for the whole history');
  assert.ok(js.includes('Object.assign({}, localStateCounts, notificationStateCounts || {})'), 'tab counts prefer server totals');
  assert.ok(js.includes('window.ASDateFormat.todayISO()'), 'follow-up badge uses the Kolkata-aware date helper');
  const sync = js.match(/function syncNotifications\(page\) \{[\s\S]*?\n  \}/);
  assert.ok(sync, 'notification sync helper exists');
  assert.ok(sync[0].includes('queuedNotificationSync = requestedPage;'), 'in-flight tab changes are queued');
  assert.ok(sync[0].includes('return syncNotifications(nextPage);'), 'queued syncs replay once');
});

test('notification mutations stay server-authoritative', () => {
  const persist = js.match(/function persistNotificationChange\(id, body, method\) \{[\s\S]*?\n  \}/);
  assert.ok(persist, 'notification mutation helper exists');
  assert.ok(persist[0].includes('.then(() => syncNotifications())'), 'successful mutations refetch server state');
  const markAll = js.match(/const markAllNotifsBtn = \$\('#mark-all-notifs-read'\);[\s\S]*?\n    \}\);/);
  assert.ok(markAll, 'mark-all-read handler exists');
  assert.ok(markAll[0].includes('unreadNotificationIdsFromServer(api)'), 'mark-all-read collects unread ids across pages');
  assert.ok(markAll[0].includes('patchNotificationsRead(api, ids)'), 'mark-all-read persists per-item PATCH batches');
  assert.ok(js.includes("'&state=unread'"), 'unread collection uses the server unread filter');
  assert.ok(js.includes('const pageSize = 500;'), 'unread collection uses the largest server page');
  assert.ok(markAll[0].includes('syncNotifications()'), 'mark-all-read refreshes counts from the server');
  const fallbackAt = markAll[0].indexOf("if (!api || !api.request)");
  const emptyGuardAt = markAll[0].indexOf("if (!unread.length)");
  assert.ok(fallbackAt > -1 && emptyGuardAt > fallbackAt, 'empty-page guard only applies to the offline fallback');
  assert.ok(!markAll[0].includes("method: 'PUT'"), 'mark-all-read never replaces the whole collection');
});

test('navigation preserves known notification fetch rules', () => {
  assert.ok(js.includes('function setView(view, skipHash)'), 'setView is retained');
  assert.ok(!js.includes('function showView('), 'showView is not reintroduced');
  const renderView = js.match(/function renderView\(view\) \{[\s\S]*?\n  \}/);
  assert.ok(renderView, 'renderView exists');
  assert.ok(!renderView[0].includes('syncNotifications'), 'renderView never fetches notifications');
  assert.ok(js.includes("if (view === 'notifications') syncNotifications();"), 'navigation fetches notifications exactly once');
  assert.ok(js.includes("$$('.view-shortcut[data-view]')"), 'setView updates secondary shortcut state');
});

test('mobile shell uses a drawer and labelled table cards', () => {
  assert.ok(!html.includes('class="bottom-nav"'), 'bottom navigation removed');
  assert.ok(js.includes("$('#admin-burger').addEventListener('click', openSidebar);"), 'burger opens the drawer');
  assert.ok(js.includes("$('#sidebar-close').addEventListener('click', closeSidebar);"), 'drawer has a close control');
  assert.ok(/\.bottom-nav \{ display: none !important; \}/.test(css), 'bottom nav hidden at tablet width');
  assert.ok(/\.admin-burger \{ display: inline-flex !important; \}/.test(css), 'burger visible at tablet width');
  assert.ok(css.includes('.a-table.responsive-cards'), 'responsive card tables are styled');
  assert.ok(css.includes('content: attr(data-label)'), 'card cells show their column label');
  for (const body of ['leads-body', 'followups-body', 'customers-body', 'applications-body', 'audit-body', 'audit-sessions-body']) {
    assert.ok(new RegExp('id="' + body + '"').test(html), 'responsive target ' + body);
  }
  assert.ok(js.includes('data-label="Customer"'), 'generated rows carry labels');
});

test('notification open action uses only defined helpers', () => {
  assert.ok(!/\bnowISO\s*\(/.test(js), 'no undefined nowISO helper call');
  assert.ok(js.includes("n.readAt = new Date().toISOString();"), 'read timestamp uses Date directly');
  assert.ok(js.includes("if (lead) { setView('leads'); openDrawer(lead.id); renderAll(); return; }"), 'open action can reach the drawer');
});

test('mobile sidebar has one scrim and keeps the burger state in sync', () => {
  assert.equal((html.match(/id="sidebar-scrim"/g) || []).length, 1, 'one functional scrim exists');
  assert.ok(html.includes('id="sidebar-overlay" aria-hidden="true" hidden'), 'legacy overlay id stays as a hidden alias');
  assert.ok(html.includes('id="admin-burger" aria-label="Open menu" aria-expanded="false" aria-controls="admin-sidebar"'), 'burger exposes initial state and its controlled element');
  assert.ok(js.includes('function setBurgerExpanded(open)'), 'burger state helper exists');
  assert.ok(js.includes('setBurgerExpanded(true);'), 'opening the sidebar expands the burger');
  assert.ok(js.includes('setBurgerExpanded(false);'), 'closing the sidebar collapses the burger');
  assert.ok(js.includes("burger.setAttribute('aria-expanded', open ? 'true' : 'false')"), 'aria-expanded tracks the drawer');
  assert.ok(/\.sidebar-scrim \{ display: none;/.test(css), 'scrim is hidden until opened');
  assert.ok(/\.sidebar-scrim\.open \{ display: block;/.test(css), 'scrim opens with the drawer');
  assert.ok(!/\.sidebar-overlay(?:\.open)?\s*\{/.test(css), 'dead sidebar-overlay rules were removed');
});

test('notification tabs are wired to a labelled tabpanel with keyboard navigation', () => {
  for (const state of ['all', 'pending', 'unread', 'acknowledged', 'dismissed', 'completed', 'superseded']) {
    assert.ok(html.includes('id="notif-tab-' + state + '"'), state + ' tab has a stable id');
    assert.ok(html.includes('id="notif-tab-' + state + '" data-notif-state="' + state + '" role="tab"'), state + ' tab is a role=tab');
    assert.ok(html.includes('id="notif-tab-' + state + '" data-notif-state="' + state + '" role="tab" aria-selected='), state + ' tab exposes selection state');
  }
  assert.ok(html.includes('aria-controls="notifications-list"'), 'tabs point at the single panel');
  assert.ok(html.includes('id="notifications-list" role="tabpanel" aria-labelledby="notif-tab-all"'), 'panel is labelled by the active tab');
  assert.ok(js.includes("panel.setAttribute('aria-labelledby', 'notif-tab-' + notificationStateFilter)"), 'panel label follows the active tab');
  assert.ok(js.includes("if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;"), 'tab list handles arrow/Home/End keys');
  assert.ok(js.includes("e.key === 'Home' ? 0"), 'Home moves to the first tab');
  assert.ok(js.includes("e.key === 'End' ? notifTabs.length - 1"), 'End moves to the last tab');
  assert.ok(js.includes('notifTabs[next].focus();') && js.includes('notifTabs[next].click();'), 'keyboard movement activates the focused tab');
});

test('follow-up and notification links resolve leads without loading the whole feed', () => {
  assert.ok(js.includes('function findOrFetchLead(id)'), 'narrow lead lookup helper exists');
  assert.ok(js.includes("api.request('api/enquiries?q=' + encodeURIComponent(key) + '&limit=50')"), 'lookup uses the filtered enquiry endpoint');
  assert.ok(js.includes('findOrFetchLead(id).then((lead) => {'), 'follow-up view resolves missing leads');
  assert.ok(js.includes('findOrFetchLead(n.targetId).then((fresh) => {'), 'notification open resolves missing leads');
  assert.ok(js.includes("toast('Open Enquiries and refresh to view full details.', 'error');"), 'a clear fallback remains when the lookup cannot find a lead');
});

test('notification badges prefer server counts without losing the offline fallback', () => {
  assert.ok(js.includes('function serverPendingCount()'), 'server pending helper exists');
  assert.ok(js.includes('const serverPending = serverPendingCount();'), 'badge uses the server pending count');
  assert.ok(js.includes('const badge = serverPending !== null ? serverPending : (localPending || localUnread);'), 'local counts are only a fallback');
  assert.ok(js.includes("visibleNotifs.filter(n => matchesNotificationState(n, 'unread')).length"), 'local unread count uses the canonical state filter');
  assert.ok(js.includes("badge + ' pending'"), 'menu copy follows the authoritative badge');
  assert.ok(js.includes('navNotif.textContent = String(counts.pending || 0);'), 'navigation badge stays server-authoritative');
});
