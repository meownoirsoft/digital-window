import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SCHEDULE, normalizeSchedule, screenState, makeOverride, timeLabel } from '../lib/schedule.js';
import { openDb } from '../db.js';

// 2026-10-12 is a Monday. Local time, like the schedule itself.
const at = (day, hh, mm = 0) => new Date(2026, 9, day, hh, mm).getTime();
const office = { ...DEFAULT_SCHEDULE, enabled: true }; // Mon–Fri 08:00–18:00

test('schedule off: always on', () => {
  assert.deepEqual(screenState(DEFAULT_SCHEDULE, null, at(12, 3)), { on: true, reason: 'always', next: null });
});

test('office hours on weekdays', () => {
  assert.equal(screenState(office, null, at(12, 7, 59)).on, false);
  assert.equal(screenState(office, null, at(12, 8)).on, true);
  assert.equal(screenState(office, null, at(12, 17, 59)).on, true);
  assert.equal(screenState(office, null, at(12, 18)).on, false);
  assert.deepEqual(screenState(office, null, at(12, 12)).next, { at: at(12, 18), on: false });
  // Friday evening: next on is Monday morning.
  const fri = screenState(office, null, at(16, 20));
  assert.equal(fri.on, false);
  assert.deepEqual(fri.next, { at: at(19, 8), on: true });
  assert.equal(screenState(office, null, at(18, 12)).on, false); // Sunday
});

test('off time before on time runs past midnight', () => {
  const night = normalizeSchedule({
    enabled: true,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ enabled: d === 1, on: '22:00', off: '06:00' })),
  });
  assert.equal(screenState(night, null, at(12, 21)).on, false);
  assert.equal(screenState(night, null, at(12, 23)).on, true);
  assert.equal(screenState(night, null, at(13, 5)).on, true);
  assert.equal(screenState(night, null, at(13, 6)).on, false);
});

test('switching by hand lasts until the schedule changes', () => {
  // Done early at 16:00: off until 18:00, when the schedule agrees, then on tomorrow.
  const off = makeOverride(office, false, at(12, 16));
  assert.deepEqual(off, { on: false, until: at(12, 18) });
  assert.deepEqual(screenState(office, off, at(12, 16, 30)), { on: false, reason: 'manual', next: { at: at(13, 8), on: true } });
  assert.equal(screenState(office, off, at(13, 9)).on, true);
  // In early: on from 07:00, and the schedule takes over at 08:00.
  const on = makeOverride(office, true, at(12, 7));
  assert.deepEqual(on, { on: true, until: at(12, 8) });
  assert.equal(screenState(office, on, at(12, 7, 30)).on, true);
  // Asking for what the schedule already says needs no override.
  assert.equal(makeOverride(office, true, at(12, 9)), null);
  // Without a schedule, "off" holds until switched back on.
  assert.deepEqual(makeOverride(DEFAULT_SCHEDULE, false, at(12, 9)), { on: false, until: null });
});

test('normalizeSchedule rejects bad input', () => {
  assert.throws(() => normalizeSchedule({ days: [] }), /7 days/);
  const days = DEFAULT_SCHEDULE.days.map((d) => ({ ...d }));
  days[1].on = '8am';
  assert.throws(() => normalizeSchedule({ enabled: true, days }), /08:30/);
  days[1] = { enabled: true, on: '09:00', off: '09:00' };
  assert.throws(() => normalizeSchedule({ enabled: true, days }), /Monday/);
});

test('timeLabel', () => {
  assert.equal(timeLabel(at(12, 18), at(12, 9)), '18:00');
  assert.equal(timeLabel(at(13, 8), at(12, 19)), 'tomorrow 08:00');
  assert.equal(timeLabel(at(19, 8, 5), at(16, 19)), 'Mon 08:05');
});

test('db: schedule JSON is stored apart from settings', () => {
  const db = openDb(':memory:');
  assert.equal(db.getJson('schedule'), null);
  db.setJson('schedule', office);
  assert.deepEqual(db.getJson('schedule'), office);
  assert.equal(db.getSettings().schedule, undefined);
  db.setSettings({ schedule: 'x' });
  assert.deepEqual(db.getJson('schedule'), office);
  db.setJson('schedule', null);
  assert.equal(db.getJson('schedule'), null);
});

test('screen-power.sh: TV standby before the signal goes off, and the reverse', () => {
  const script = fileURLToPath(new URL('../kiosk/screen-power.sh', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'digital-window-screen-test-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const log = join(dir, 'log');
    const record = 'echo "$(basename "$0") $*" >> "$SCREEN_TEST_LOG"';
    writeFileSync(join(bin, 'wlopm'), `#!/bin/sh\n${record}\n`, { mode: 0o755 });
    writeFileSync(join(bin, 'cec-ctl'), `#!/bin/sh\n${record}\n`, { mode: 0o755 });
    const env = { PATH: `${bin}:/usr/bin:/bin`, WAYLAND_DISPLAY: 'wayland-0', SCREEN_TEST_LOG: log, KIOSK_SCREEN_POWER: 'dpms' };
    for (const arg of ['off', 'on']) {
      const r = spawnSync('bash', [script, arg], { env, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
    }
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ["wlopm --off *", "wlopm --on *"]);
    const none = spawnSync('bash', [script, 'off'], { env: { ...env, KIOSK_SCREEN_POWER: 'none' }, encoding: 'utf8' });
    assert.equal(none.status, 0);
    assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 2);
    assert.equal(spawnSync('bash', [script, 'sideways'], { env, encoding: 'utf8' }).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
