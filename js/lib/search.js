/* 検索・絞り込み・並び替え（DOM 非依存 / テスト対象）
   提案書 3.2「全文検索、タグ・日付フィルタ、並び替え」に対応 */

import { fullText, displayTitle } from './model.js';
import { toLocalDateKey } from './time.js';

export const SORT_OPTIONS = [
  { id: 'newest', label: '新しい順' },
  { id: 'oldest', label: '古い順' },
  { id: 'title', label: 'タイトル順' },
  { id: 'notes', label: 'メモが多い順' }
];

/** 空白区切りの語をすべて含む（AND 検索・大文字小文字を無視） */
export function matchesQuery(session, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const hay = fullText(session).toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => hay.includes(term));
}

export function matchesTags(session, tags) {
  const want = (tags || []).filter(Boolean);
  if (want.length === 0) return true;
  const have = (session.tags || []).map((t) => t.toLowerCase());
  return want.every((t) => have.includes(String(t).toLowerCase()));
}

export function matchesDateRange(session, from, to) {
  const key = toLocalDateKey(session.createdAt);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function sortSessions(sessions, sortId = 'newest') {
  const list = sessions.slice();
  switch (sortId) {
    case 'oldest':
      return list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    case 'title':
      return list.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b), 'ja'));
    case 'notes':
      return list.sort((a, b) => (b.notes?.length || 0) - (a.notes?.length || 0));
    case 'newest':
    default:
      return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}

/**
 * ダッシュボードの絞り込み一式。
 * @param {Array} sessions
 * @param {{query?:string, tags?:string[], from?:string, to?:string, sort?:string}} filter
 */
export function filterSessions(sessions, filter = {}) {
  const { query = '', tags = [], from = '', to = '', sort = 'newest' } = filter;
  const hit = (sessions || []).filter(
    (s) => matchesQuery(s, query) && matchesTags(s, tags) && matchesDateRange(s, from, to)
  );
  return sortSessions(hit, sort);
}

/** 全セッションから使用中タグを出現回数つきで集計する */
export function collectTags(sessions) {
  const counts = new Map();
  for (const s of sessions || []) {
    for (const t of s.tags || []) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ja'));
}

/** セッション詳細の中で語を含むセグメント/メモを返す */
export function searchInSession(session, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { segments: [], notes: [] };
  const has = (text) => String(text || '').toLowerCase().includes(q);
  return {
    segments: (session.segments || []).filter((s) => has(s.text)),
    notes: (session.notes || []).filter((n) => has(n.text))
  };
}
