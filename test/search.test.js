import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, createSegment, createNote } from '../js/lib/model.js';
import {
  matchesQuery, matchesTags, haystack,
  filterSessions, sortByNewest, collectTags, searchInSession
} from '../js/lib/search.js';

const s1 = createSession({
  id: 's1', title: '企画会議', tags: ['仕事', '企画'], createdAt: '2026-08-01T02:00:00.000Z',
  segments: [createSegment({ text: '新しいアプリの案を話した' })],
  notes: [createNote({ text: '見積もりを作る', type: 'todo' })]
});
const s2 = createSession({
  id: 's2', title: '読書メモ', tags: ['読書'], createdAt: '2026-08-20T02:00:00.000Z',
  segments: [createSegment({ text: '集中の技術について' })],
  notes: []
});
const s3 = createSession({
  id: 's3', title: 'アイデア', tags: ['仕事'], createdAt: '2026-08-10T02:00:00.000Z',
  notes: [createNote({ text: 'a' }), createNote({ text: 'b' })]
});
const all = [s1, s2, s3];

test('matchesQuery は空クエリを常に通す', () => {
  assert.equal(matchesQuery(s1, ''), true);
  assert.equal(matchesQuery(s1, '   '), true);
});

test('matchesQuery は本文・メモ・タグを横断する AND 検索', () => {
  assert.equal(matchesQuery(s1, 'アプリ'), true);
  assert.equal(matchesQuery(s1, '見積もり'), true);
  assert.equal(matchesQuery(s1, '企画 アプリ'), true);
  assert.equal(matchesQuery(s1, '企画 存在しない語'), false);
});

test('matchesTags は指定タグをすべて持つものだけ通す', () => {
  assert.equal(matchesTags(s1, []), true);
  assert.equal(matchesTags(s1, ['仕事']), true);
  assert.equal(matchesTags(s1, ['仕事', '企画']), true);
  assert.equal(matchesTags(s2, ['仕事']), false);
});

test('日付も検索語で辿れる（日付フィルタの代わり）', () => {
  const d = new Date(s2.createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  const short = `${d.getMonth() + 1}/${d.getDate()}`;
  assert.ok(haystack(s2).includes(ymd), 'YYYY/MM/DD で引ける');
  assert.equal(matchesQuery(s2, ymd), true);
  assert.equal(matchesQuery(s2, short), true);
  assert.equal(matchesQuery(s2, '1999/01/01'), false);
});

test('sortByNewest は新しい順に並べ、元の配列を壊さない', () => {
  assert.deepEqual(sortByNewest(all).map((s) => s.id), ['s2', 's3', 's1']);
  assert.equal(sortByNewest(all) === all, false);
});

test('filterSessions は検索とタグを組み合わせ、新しい順で返す', () => {
  assert.deepEqual(filterSessions(all, { query: '仕事' }).map((s) => s.id), ['s3', 's1']);
  assert.deepEqual(filterSessions(all, { tags: ['読書'] }).map((s) => s.id), ['s2']);
  assert.deepEqual(filterSessions(all, { query: 'アプリ', tags: ['読書'] }), []);
  assert.deepEqual(filterSessions(all, {}).map((s) => s.id), ['s2', 's3', 's1']);
});

test('collectTags は出現回数の多い順', () => {
  assert.deepEqual(collectTags(all), [
    { tag: '仕事', count: 2 },
    { tag: '企画', count: 1 },
    { tag: '読書', count: 1 }
  ]);
});

test('searchInSession はセグメントとメモを分けて返す', () => {
  const hit = searchInSession(s1, '見積');
  assert.equal(hit.segments.length, 0);
  assert.equal(hit.notes.length, 1);
  assert.deepEqual(searchInSession(s1, ''), { segments: [], notes: [] });
});
