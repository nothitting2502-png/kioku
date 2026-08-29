/* 検索・絞り込み（DOM 非依存 / テスト対象）
   並び替えや日付フィルタの操作は置かず、
   「新しい順に並べ、言葉で絞る」の一手だけにしている。
   日付は検索対象に含めてあるので、「2026/08」や「8/29」でも辿り着ける。 */

import { fullText } from './model.js';
import { formatDateTime, toLocalDateKey } from './time.js';

/** 検索対象の文字列。本文・メモ・タグに加えて日付表記も含める */
export function haystack(session) {
  const date = formatDateTime(session.createdAt);     // 2026/08/29 20:21
  const key = toLocalDateKey(session.createdAt);      // 2026-08-29
  const short = date ? date.slice(5, 10).replace(/^0/, '') : ''; // 8/29
  return [fullText(session), date, key, short].filter(Boolean).join('\n').toLowerCase();
}

/** 空白区切りの語をすべて含む（AND 検索・大文字小文字を無視） */
export function matchesQuery(session, query) {
  const q = String(query || '').trim();
  if (!q) return true;
  const hay = haystack(session);
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

/** 常に新しい順。元の配列は壊さない */
export function sortByNewest(sessions) {
  return sessions.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * ダッシュボードの絞り込み。
 * @param {Array} sessions
 * @param {{query?:string, tags?:string[]}} filter
 */
export function filterSessions(sessions, filter = {}) {
  const { query = '', tags = [] } = filter;
  const hit = (sessions || []).filter((s) => matchesQuery(s, query) && matchesTags(s, tags));
  return sortByNewest(hit);
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
