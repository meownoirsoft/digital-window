import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';

test('items: add, update, reorder, delete', () => {
  const db = openDb(':memory:');
  const a = db.addItem({ type: 'youtube', title: 'A', payload: { videoId: 'x' } });
  const b = db.addItem({ type: 'apod', title: 'B' });
  const c = db.addItem({ type: 'epic', title: 'C', duration_sec: 20 });
  assert.deepEqual(db.listItems().map((i) => i.title), ['A', 'B', 'C']);
  assert.deepEqual(a.payload, { videoId: 'x' });
  assert.equal(a.enabled, true);

  db.reorder([c.id, a.id, b.id]);
  assert.deepEqual(db.listItems().map((i) => i.title), ['C', 'A', 'B']);

  const u = db.updateItem(b.id, { enabled: false, duration_sec: null, error: 'nope' });
  assert.equal(u.enabled, false);
  assert.equal(u.error, 'nope');

  assert.equal(db.deleteItem(a.id), true);
  assert.equal(db.deleteItem(a.id), false);
  assert.deepEqual(db.listItems().map((i) => i.title), ['C', 'B']);
});

test('reorder rolls back on error', () => {
  const db = openDb(':memory:');
  const a = db.addItem({ type: 'apod', title: 'A' });
  const b = db.addItem({ type: 'epic', title: 'B' });
  assert.throws(() => db.reorder([b.id, a.id, 'not-a-number-but-a-string-is-fine', {}]));
  assert.deepEqual(db.listItems().map((i) => i.title), ['A', 'B']);
});

test('settings: defaults and unknown keys ignored', () => {
  const db = openDb(':memory:');
  assert.equal(db.getSettings().still_duration_sec, '30');
  db.setSettings({ still_duration_sec: 12, bogus: 1 });
  assert.equal(db.getSettings().still_duration_sec, '12');
  assert.equal(db.getSettings().bogus, undefined);
});
