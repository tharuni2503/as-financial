'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const FORMATTER = path.join(__dirname, '..', 'assets', 'js', 'date-format.js').replace(/\\/g, '/');

function formatInTimezone(tz, values) {
  const script = `
    const f = require(process.env.AS_FORMATTER);
    const values = JSON.parse(process.env.AS_VALUES);
    process.stdout.write(JSON.stringify(values.map(v => ({ short: f.fmtShort(v), full: f.fmtDate(v) }))));
  `;
  const res = spawnSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: tz, AS_FORMATTER: FORMATTER, AS_VALUES: JSON.stringify(values) },
    encoding: 'utf8'
  });
  assert.equal(res.status, 0, res.stderr || 'formatter child failed');
  return JSON.parse(res.stdout);
}

test('date-only values render as the stored calendar date in every timezone (H5)', () => {
  const values = ['2026-11-26', '2026-01-01', '2026-12-31', '2026-02-28', '2026-03-01'];
  const expectedShort = ['26 Nov', '01 Jan', '31 Dec', '28 Feb', '01 Mar'];
  const expectedFull = ['26 Nov 2026', '01 Jan 2026', '31 Dec 2026', '28 Feb 2026', '01 Mar 2026'];
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const out = formatInTimezone(tz, values);
    assert.deepEqual(out.map(x => x.short), expectedShort, 'fmtShort in ' + tz);
    assert.deepEqual(out.map(x => x.full), expectedFull, 'fmtDate in ' + tz);
  }
});

test('full timestamps keep local-time rendering', () => {
  const values = ['2026-11-26T00:30:00.000Z'];
  const utc = formatInTimezone('UTC', values)[0];
  const la = formatInTimezone('America/Los_Angeles', values)[0];
  assert.equal(utc.short, '26 Nov');
  assert.equal(la.short, '25 Nov');
});

test('invalid and empty values render an em dash', () => {
  const out = formatInTimezone('UTC', ['', null, 'not-a-date', '2026-13-40']);
  out.forEach((x) => {
    assert.equal(x.short, '—');
    assert.equal(x.full, '—');
  });
});

test('admin bundle loads the formatter before admin.js and delegates to it', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'admin.js'), 'utf8');
  const scriptAt = html.indexOf('assets/js/date-format.js');
  const adminAt = html.indexOf('assets/js/admin.js');
  assert.ok(scriptAt > -1 && adminAt > -1);
  assert.ok(scriptAt < adminAt, 'date-format.js must load before admin.js');
  assert.ok(js.includes('window.ASDateFormat'), 'admin.js must use the shared formatter');
});

test('todayISO follows Asia/Kolkata regardless of browser timezone', () => {
  const script = `
    const f = require(process.env.AS_FORMATTER);
    process.stdout.write(JSON.stringify([
      f.todayISO(new Date('2026-11-25T18:30:00Z')),
      f.todayISO(new Date('2026-11-25T18:29:59Z'))
    ]));
  `;
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Auckland']) {
    const res = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: tz, AS_FORMATTER: FORMATTER },
      encoding: 'utf8'
    });
    assert.equal(res.status, 0, res.stderr || 'todayISO child failed');
    assert.deepEqual(JSON.parse(res.stdout), ['2026-11-26', '2026-11-25'], 'todayISO in ' + tz);
  }
});
