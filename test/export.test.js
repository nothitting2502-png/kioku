import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, createSegment, createNote } from '../js/lib/model.js';
import { toText, toMarkdown, toCsv, toCsvRows, toBackup, parseBackup, safeFileName, SCHEMA_VERSION } from '../js/lib/export.js';

const session = createSession({
  id: 'sx', title: '打ち合わせ', tags: ['仕事'], durationMs: 65000,
  segments: [
    createSegment({ text: '後半の話', startMs: 61000 }),
    createSegment({ text: '最初の話', startMs: 1000 })
  ],
  notes: [createNote({ type: 'todo', text: '資料, "改訂"', atMs: 2000 })]
});

test('toText は時刻順に並べ、メモも付ける', () => {
  const text = toText(session);
  assert.ok(text.indexOf('最初の話') < text.indexOf('後半の話'), '時刻順に並ぶ');
  assert.ok(text.includes('[01:01] 後半の話'));
  assert.ok(text.includes('--- メモ ---'));
  assert.ok(text.includes('(TODO)'));
});

test('toMarkdown は見出しとメタ情報を含む', () => {
  const md = toMarkdown(session);
  assert.ok(md.startsWith('# 打ち合わせ'));
  assert.ok(md.includes('## 文字起こし'));
  assert.ok(md.includes('## メモ'));
  assert.ok(md.includes('#仕事'));
  assert.ok(md.includes('| 収録時間 | 01:05 |'));
});

test('toMarkdown は空のセッションでも壊れない', () => {
  const md = toMarkdown(createSession({ title: '空' }));
  assert.ok(md.includes('_（本文はありません）_'));
  assert.ok(md.includes('_（メモはありません）_'));
});

test('toCsv はカンマと引用符をエスケープする', () => {
  const rows = toCsvRows(session);
  assert.deepEqual(rows[0], ['種別', '時刻', 'メモ種別', '本文', '紐づけID', '作成日時']);
  const csv = toCsv(session);
  assert.ok(csv.includes('"資料, ""改訂"""'), 'カンマと二重引用符が正しく囲まれる');
  assert.ok(csv.includes('\r\n'), 'CRLF 改行');
});

test('toBackup は 1 件でも配列でも同じ形', () => {
  const one = toBackup(session);
  assert.equal(one.sessionCount, 1);
  assert.equal(one.schemaVersion, SCHEMA_VERSION);
  assert.equal(toBackup([session, session]).sessionCount, 2);
});

test('parseBackup は往復できる', () => {
  const json = JSON.stringify(toBackup([session]));
  const result = parseBackup(json);
  assert.equal(result.ok, true);
  assert.equal(result.sessions[0].id, 'sx');
  assert.equal(result.sessions[0].segments.length, 2);
});

test('parseBackup は壊れた入力を理由付きで拒否する', () => {
  assert.equal(parseBackup('{壊れた').ok, false);
  assert.equal(parseBackup('null').ok, false);
  assert.equal(parseBackup('{"sessions": "x"}').ok, false);
  assert.equal(parseBackup('{"sessions": []}').ok, false);
  assert.equal(parseBackup({ schemaVersion: 999, sessions: [session] }).ok, false);
});

test('parseBackup は素の配列も受け付け、欠けた配列を補う', () => {
  const result = parseBackup(JSON.stringify([{ id: 'a', title: 'x' }]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions[0].segments, []);
  assert.deepEqual(result.sessions[0].notes, []);
  assert.deepEqual(result.sessions[0].tags, []);
});

test('safeFileName はファイル名に使えない文字を落とす', () => {
  assert.equal(safeFileName('a/b:c*d?e'), 'a_b_c_d_e');
  assert.equal(safeFileName('  複数 の 語 '), '複数_の_語');
  assert.equal(safeFileName(''), 'session');
  assert.equal(safeFileName('   ', 'fallback'), 'fallback');
});
