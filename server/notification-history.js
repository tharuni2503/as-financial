'use strict';

/*
 * Notification retention helper (JSON fallback store).
 *
 * Notification history is retained after any terminal state transition. When
 * the collection grows past the cap we trim the oldest *non-history* entries
 * first so acknowledged/dismissed/completed/superseded events are never
 * silently dropped, regardless of notification type. Legacy reminder flags are
 * protected as history too.
 */

const HISTORY_LIMIT = 2000;

const TERMINAL_STATES = ['acknowledged', 'dismissed', 'completed', 'superseded'];

function isProtectedHistory(n) {
  if (!n) return false;
  const state = String(n.state || '').toLowerCase();
  if (TERMINAL_STATES.includes(state)) return true;
  const isReminder = n.type === 'followup.reminder' || n.type === 'lead.sla';
  return isReminder && !!(n.acknowledged || n.dismissed);
}

function trimNotificationHistory(list, limit = HISTORY_LIMIT) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const cap = Math.max(1, Number(limit) || HISTORY_LIMIT);
  if (arr.length <= cap) return arr;
  const kept = [];
  const droppable = [];
  arr.forEach((n) => {
    if (isProtectedHistory(n)) kept.push(n);
    else droppable.push(n);
  });
  droppable.sort((a, b) => new Date(a && a.createdAt || 0) - new Date(b && b.createdAt || 0));
  const room = cap - kept.length;
  const retained = room > 0 ? droppable.slice(droppable.length - room) : [];
  return retained.concat(kept).sort((a, b) => new Date(b && b.createdAt || 0) - new Date(a && a.createdAt || 0));
}

module.exports = { trimNotificationHistory, isProtectedHistory, HISTORY_LIMIT };
