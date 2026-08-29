import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, createSegment, createNote } from '../js/lib/model.js';
import {
  matchesQuery, matchesTags, matchesDateRange,
  filterSessions, sortSessions, collectTags, searchInSession
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

test('matchesDateRange は端の日付を含む', () => {
  const key = new Date(s2.createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const same = `${key.getFullYear()}-${pad(key.getMonth() + 1)}-${pad(key.getDate())}`;
  assert.equal(matchesDateRange(s2, same, same), true);
  assert.equal(matchesDateRange(s2, '2100-01-01', ''), false);
  assert.equal(matchesDateRange(s2, '', '2000-01-01'), false);
});

test('sortSessions は指定順に並べる', () => {
  assert.deepEqual(sortSessions(all, 'newest').map((s) => s.id), ['s2', 's3', 's1']);
  assert.deepEqual(sortSessions(all, 'oldest').map((s) => s.id), ['s1', 's3', 's2']);
  assert.equal(sortSessions(all, 'notes')[0].id, 's3');
  assert.equal(sortSessions(all, 'newest') === all, false, '元の配列を壊さない');
});

test('filterSessions は検索とタグを組み合わせる', () => {
  assert.deepEqual(filterSessions(all, { query: '仕事' }).map((s) => s.id), ['s3', 's1']);
  assert.deepEqual(filterSessions(all, { tags: ['読書'] }).map((s) => s.id), ['s2']);
  assert.deepEqual(filterSessions(all, { query: 'アプリ', tags: ['読書'] }), []);
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
