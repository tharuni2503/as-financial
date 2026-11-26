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
  for (const exact of [
    '--navy: #101F38;', '--gold: #C49A45;', '--surface: #FFFFFF;',
    '--bg: #F5F6F8;', '--ink: #202938;', '--muted: #667085;'
  ]) {
    assert.ok(css.includes(exact), 'canonical brand token ' + exact);
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

test('lead status vocabulary is normalised before counting, filtering and display', () => {
  assert.ok(js.includes('function leadStatus(lead)'), 'status normalisation helper exists');
  assert.ok(js.includes('function hasLeadStatus(lead, status)'), 'status comparison helper exists');
  assert.ok(js.includes("'Accepted': 'Approved'"), 'legacy Accepted maps to Approved');
  assert.ok(js.includes("'Declined': 'Rejected'"), 'legacy Declined maps to Rejected');
  assert.ok(js.includes("'Disbursed': 'Approved'"), 'legacy Disbursed maps to Approved');
  assert.ok(js.includes("'Lost': 'Rejected'"), 'legacy Lost maps to Rejected');
  // Counts and filters must never compare the raw, possibly legacy status.
  assert.ok(js.includes('hasLeadStatus(l, \'Approved\')'), 'approved counts use the normalised helper');
  assert.ok(js.includes('hasLeadStatus(l, \'Rejected\')'), 'rejected counts use the normalised helper');
  assert.ok(js.includes('if (filters.leadStatus && !hasLeadStatus(l, filters.leadStatus)) return false;'), 'lead filters use the normalised helper');
  assert.ok(js.includes("if (followupFilters.status) followups = followups.filter(l => hasLeadStatus(l, followupFilters.status));"), 'follow-up filters use the normalised helper');
  assert.ok(js.includes("esc(leadStatus(l))"), 'status chips render the canonical label');
  assert.ok(js.includes("{ label: 'Approved', count: acceptedLeads"), 'chart legend uses Approved');
  assert.ok(js.includes("{ label: 'Rejected', count: declinedLeads"), 'chart legend uses Rejected');
  assert.ok(js.includes("['Approved', accepted]"), 'report rows use Approved');
  assert.ok(js.includes("['Rejected', declined]"), 'report rows use Rejected');
  assert.ok(!/hasLeadStatus\(l, 'Accepted'\)|hasLeadStatus\(l, 'Declined'\)/.test(js), 'legacy values are never used as canonical filters');
});

test('chart animation honours the reduced-motion preference', () => {
  assert.ok(js.includes('function prefersReducedMotion()'), 'reduced-motion helper exists');
  assert.ok(js.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"), 'OS preference is queried');
  assert.ok(js.includes('if (prefersReducedMotion()) { draw(1); return; }'), 'final frame is drawn immediately when motion is reduced');
  const animate = js.match(/function animateChart\(canvas, duration, draw\)\{[\s\S]*?\n  \}/);
  assert.ok(animate, 'chart animation helper exists');
  assert.ok(animate[0].indexOf('prefersReducedMotion()') < animate[0].indexOf('requestAnimationFrame(step)'), 'reduced-motion check runs before any animation frame');
});

test('dialogs, drawer and menus manage keyboard focus', () => {
  assert.ok(js.includes('const FOCUSABLE_SELECTOR ='), 'one focusable selector is shared');
  assert.ok(js.includes('function focusableIn(container)'), 'focusable collector exists');
  assert.ok(js.includes('function trapFocus(container, e)'), 'shared focus trap exists');
  assert.ok(js.includes('trapFocus(overlay, e);'), 'modal traps focus');
  assert.ok(js.includes('trapFocus(drawer, e); return;'), 'lead drawer traps focus');
  assert.ok(js.includes('trapFocus(sidebar, e);'), 'mobile sidebar traps focus');
  assert.ok(js.includes('drawerLastFocus'), 'drawer restores focus on close');
  assert.ok(js.includes('sidebarLastFocus'), 'sidebar restores focus on close');
  assert.ok(js.includes("const cancel = $('#modal-cancel');") && js.includes('if (cancel) cancel.focus();'), 'confirm dialog moves focus to the safe action');
  assert.ok(html.includes('id="lead-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"'), 'drawer is a labelled modal dialog');
  assert.ok(html.includes('id="modal-overlay"') && html.includes('role="dialog" aria-modal="true" aria-labelledby="modal-title"'), 'modal is a labelled dialog');
});

test('status messages are announced and the shell exposes a working skip link', () => {
  assert.ok(html.includes('id="toast-host" role="status" aria-live="polite"'), 'toast host is a polite live region');
  assert.ok(html.includes('class="skip-link" href="#login-email"'), 'skip link targets sign in on the login screen');
  assert.ok(html.includes('id="admin-app" tabindex="-1"'), 'admin shell is a programmatic focus target');
  assert.ok(html.includes('id="admin-main"'), 'main landmark is identifiable');
  assert.ok(html.includes('<main class="admin-main" id="admin-main">'), 'content lives in a main landmark');
  assert.ok(js.includes('function updateSkipLink()'), 'skip link target updates with app visibility');
  assert.ok(js.includes("link.setAttribute('href', appVisible ? '#admin-app' : '#login-email');"), 'skip link follows the visible screen');
  assert.ok(js.includes("link.textContent = appVisible ? 'Skip to dashboard' : 'Skip to sign in';"), 'skip link label matches its target');
  assert.ok(js.includes('updateSkipLink();'), 'skip link is refreshed on screen changes');
});

test('icon-only admin actions carry accessible names and reschedule copy is readable', () => {
  assert.ok(js.includes('aria-label="View follow-up for '), 'follow-up view action is labelled');
  assert.ok(js.includes('aria-label="Reschedule follow-up for '), 'follow-up reschedule action is labelled');
  assert.ok(js.includes('aria-label="Message '), 'WhatsApp action is labelled');
  assert.ok(js.includes('aria-label="Edit enquiry '), 'lead edit action is labelled');
  assert.ok(js.includes('aria-label="Edit product '), 'product edit action is labelled');
  assert.ok(js.includes('aria-label="Edit lender '), 'lender edit action is labelled');
  assert.ok(js.includes('aria-label="Edit testimonial from '), 'testimonial edit action is labelled');
  assert.ok(js.includes('aria-label="Edit customer '), 'customer edit action is labelled');
  assert.ok(js.includes('aria-label="Edit application '), 'application edit action is labelled');
  assert.ok(js.includes(' — set the next follow-up date.'), 'reschedule prompt uses readable copy');
  assert.ok(!/\uFFFD/.test(js), 'admin script contains no replacement characters');
});
