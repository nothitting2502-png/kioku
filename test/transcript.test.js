import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideCommit, collapseSegments, normalizeText, CONTINUATION_WINDOW_MS } from '../js/lib/transcript.js';

test('normalizeText は空白の揺れを吸収する', () => {
  assert.equal(normalizeText('  バイクの　奪い合い  '), 'バイクの 奪い合い');
  assert.equal(normalizeText(null), '');
});

test('最初の1行は追加になる', () => {
  assert.deepEqual(decideCommit(null, 'バイクの奪い合い'), { action: 'append', text: 'バイクの奪い合い' });
  assert.deepEqual(decideCommit({ text: '' }, 'あ'), { action: 'append', text: 'あ' });
});

test('同じ文が再び届いたら捨てる（実機で行が積み上がった原因）', () => {
  const prev = { text: 'バイクの奪い合い', startMs: 5000, endMs: 5000 };
  assert.equal(decideCommit(prev, 'バイクの奪い合い', { atMs: 5200 }).action, 'skip');
  assert.equal(decideCommit(prev, '  バイクの奪い合い ', { atMs: 5400 }).action, 'skip');
});

test('伸びた累積結果は行を増やさず置き換える', () => {
  const prev = { text: 'バイクの奪い合い', startMs: 5000, endMs: 6000 };
  const d = decideCommit(prev, 'バイクの奪い合い 先にマイクを掴むので', { atMs: 7000 });
  assert.deepEqual(d, { action: 'replace', text: 'バイクの奪い合い 先にマイクを掴むので' });
});

test('前より短い（すでに書いた内容の一部）なら捨てる', () => {
  const prev = { text: 'バイクの奪い合い 先にマイクを掴むので', startMs: 5000, endMs: 7000 };
  assert.equal(decideCommit(prev, 'バイクの奪い合い', { atMs: 7200 }).action, 'skip');
});

test('関係のない文は新しい行として追加する', () => {
  const prev = { text: 'バイクの奪い合い', startMs: 5000, endMs: 6000 };
  const d = decideCommit(prev, '納期は9月中旬を希望している', { atMs: 9000 });
  assert.deepEqual(d, { action: 'append', text: '納期は9月中旬を希望している' });
});

test('時間が空けば、同じ文でも別の発話として追加する', () => {
  const prev = { text: 'よろしくお願いします', startMs: 1000, endMs: 2000 };
  const soon = decideCommit(prev, 'よろしくお願いします', { atMs: 3000 });
  assert.equal(soon.action, 'skip');
  const later = decideCommit(prev, 'よろしくお願いします', { atMs: 2000 + CONTINUATION_WINDOW_MS + 1 });
  assert.equal(later.action, 'append');
});

test('実機のスクリーンショットと同じ列を畳むと1行になる', () => {
  // Screenshot_20260829-212845.png に写っていた並び
  const raw = [
    { text: 'バイクの奪い合い', startMs: 5000 },
    { text: 'バイクの奪い合い', startMs: 5300 },
    { text: 'バイクの奪い合い', startMs: 5600 },
    { text: 'バイクの奪い合い', startMs: 5900 },
    { text: 'バイクの奪い合い', startMs: 6200 },
    { text: 'バイクの奪い合い', startMs: 6500 },
    { text: 'バイクの奪い合い 先にマイクを掴むので', startMs: 7000 },
    { text: 'バイクの奪い合い 先にマイクを掴むので', startMs: 7300 },
    { text: 'バイクの奪い合い 先にマイクを掴むので', startMs: 7600 },
    { text: 'バイクの奪い合い 先にマイクを掴むので Android', startMs: 7900 },
    { text: 'バイクの奪い合い 先にマイクを掴むので Android', startMs: 8200 }
  ];
  const collapsed = collapseSegments(raw);
  assert.equal(collapsed.length, 1, '11行が1行に畳まれる');
  assert.equal(collapsed[0].text, 'バイクの奪い合い 先にマイクを掴むので Android');
  assert.equal(collapsed[0].startMs, 5000, '最初の時刻を保つ');
});

test('別の発話が混ざっていれば、その分だけ行が残る', () => {
  const collapsed = collapseSegments([
    { text: 'おはよう', startMs: 0 },
    { text: 'おはようございます', startMs: 500 },
    { text: '今日の予定を確認します', startMs: 3000 },
    { text: '今日の予定を確認します', startMs: 3400 }
  ]);
  assert.deepEqual(collapsed.map((s) => s.text), ['おはようございます', '今日の予定を確認します']);
});

test('空の入力では何も起きない', () => {
  assert.equal(decideCommit({ text: 'あ' }, '   ').action, 'skip');
  assert.deepEqual(collapseSegments([]), []);
  assert.deepEqual(collapseSegments(null), []);
});
