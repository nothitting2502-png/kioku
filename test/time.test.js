import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, formatDateTime, toLocalDateKey } from '../js/lib/time.js';
import { Stopwatch } from '../js/lib/stopwatch.js';

test('formatElapsed は 1 時間未満を mm:ss にする', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(999), '00:00');
  assert.equal(formatElapsed(61000), '01:01');
  assert.equal(formatElapsed(3599000), '59:59');
});

test('formatElapsed は 1 時間以上を h:mm:ss にする', () => {
  assert.equal(formatElapsed(3600000), '1:00:00');
  assert.equal(formatElapsed(3725000), '1:02:05');
});

test('formatElapsed は不正値を 00:00 にする', () => {
  assert.equal(formatElapsed(-5), '00:00');
  assert.equal(formatElapsed(undefined), '00:00');
  assert.equal(formatElapsed('x'), '00:00');
});

test('formatDateTime / toLocalDateKey は不正な日付で空文字', () => {
  assert.equal(formatDateTime('とても不正'), '');
  assert.equal(toLocalDateKey(''), '');
  assert.match(formatDateTime('2026-08-29T12:34:00'), /^2026\/08\/29 12:34$/);
  assert.equal(toLocalDateKey('2026-08-29T12:34:00'), '2026-08-29');
});

test('Stopwatch は一時停止した分を除いて数える', () => {
  let now = 1000;
  const w = new Stopwatch(() => now);
  assert.equal(w.elapsed(), 0);
  w.start();
  now += 5000;
  assert.equal(w.elapsed(), 5000);
  w.pause();
  now += 60000;               // 一時停止中は増えない
  assert.equal(w.elapsed(), 5000);
  assert.equal(w.running, false);
  w.start();
  now += 2000;
  assert.equal(w.elapsed(), 7000);
  assert.equal(w.stop(), 7000);
  w.reset();
  assert.equal(w.elapsed(), 0);
});

test('Stopwatch の start は二重呼び出しで基準がずれない', () => {
  let now = 0;
  const w = new Stopwatch(() => now);
  w.start();
  now += 1000;
  w.start();                  // 無視されるべき
  now += 1000;
  assert.equal(w.elapsed(), 2000);
});
