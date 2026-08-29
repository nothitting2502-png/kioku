import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession, createSegment, createNote, parseTags,
  displayTitle, fullText, segmentAt, sessionStats, noteTypeOf, newId, NOTE_TYPES
} from '../js/lib/model.js';

test('parseTags は区切り文字を吸収して重複を除く', () => {
  assert.deepEqual(parseTags('仕事, 企画　 仕事 #2026Q3'), ['仕事', '企画', '2026Q3']);
  assert.deepEqual(parseTags(''), []);
  assert.deepEqual(parseTags(['a', ' b ', 'a']), ['a', 'b']);
});

test('newId は毎回異なる', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newId('x')));
  assert.equal(ids.size, 500);
});

test('createSession は既定値を持ちつつ上書きできる', () => {
  const s = createSession({ title: 'テスト', tags: ['a'] });
  assert.equal(s.title, 'テスト');
  assert.equal(s.status, 'draft');
  assert.deepEqual(s.segments, []);
  assert.deepEqual(s.notes, []);
  assert.equal(s.audio, null);
});

test('displayTitle は未入力なら日付から補う', () => {
  assert.equal(displayTitle({ title: '  会議  ' }), '会議');
  const s = createSession({ createdAt: '2026-08-29T10:00:00.000Z' });
  assert.match(displayTitle(s), /^無題のセッション（\d+\/\d+）$/);
});

test('createSegment は数値を丸めて空白を除く', () => {
  const seg = createSegment({ text: '  こんにちは ', startMs: 1234.7, endMs: null });
  assert.equal(seg.text, 'こんにちは');
  assert.equal(seg.startMs, 1235);
  assert.equal(seg.endMs, null);
  assert.equal(seg.edited, false);
});

test('createNote は種別の色を引き継ぐ', () => {
  const note = createNote({ type: 'todo', text: 'あとで確認', atMs: 500 });
  assert.equal(note.color, noteTypeOf('todo').color);
  assert.equal(note.segmentId, null);
});

test('メモの種別は3つに絞ってある', () => {
  assert.equal(NOTE_TYPES.length, 3);
  assert.deepEqual(NOTE_TYPES.map((t) => t.id), ['insight', 'todo', 'check']);
});

test('fullText はタイトル・タグ・本文・メモを含む', () => {
  const s = createSession({
    title: '打ち合わせ', tags: ['企画'],
    segments: [createSegment({ text: '来週の予定' })],
    notes: [createNote({ text: '資料を準備' })]
  });
  const text = fullText(s);
  for (const part of ['打ち合わせ', '企画', '来週の予定', '資料を準備']) {
    assert.ok(text.includes(part), `${part} が含まれること`);
  }
});

test('segmentAt は指定時刻以前で最も近いセグメントを返す', () => {
  const s = createSession({
    segments: [
      createSegment({ text: 'A', startMs: 0 }),
      createSegment({ text: 'B', startMs: 5000 }),
      createSegment({ text: 'C', startMs: 9000 })
    ]
  });
  assert.equal(segmentAt(s, 0).text, 'A');
  assert.equal(segmentAt(s, 4999).text, 'A');
  assert.equal(segmentAt(s, 5000).text, 'B');
  assert.equal(segmentAt(s, 99999).text, 'C');
  assert.equal(segmentAt(createSession(), 100), null);
});

test('sessionStats は件数と文字数を数える', () => {
  const s = createSession({
    segments: [createSegment({ text: 'あいう' }), createSegment({ text: 'かき' })],
    notes: [createNote({ text: 'x' })],
    audio: { mimeType: 'audio/webm', size: 10 }
  });
  assert.deepEqual(sessionStats(s), { segmentCount: 2, noteCount: 1, charCount: 5, hasAudio: true });
});
