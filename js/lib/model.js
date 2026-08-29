/* データモデル（DOM 非依存 / テスト対象）
   提案書 5.1「1セッション = 音声・文字起こしセグメント・メモ・タグ・日時」に対応 */

/* 種別は3つに絞る。横スクロールなしで並び、迷わず選べる幅。
   色は和の中間色に寄せ、明るい紙の上でも暗い墨の上でも読める明度にしている。 */
export const NOTE_TYPES = [
  { id: 'insight', label: '気づき', color: '#b4893c' },  // 山吹
  { id: 'todo', label: 'TODO', color: '#b0463b' },       // 朱
  { id: 'check', label: '確認', color: '#3e6480' }        // 藍
];

export const SESSION_STATUS = {
  draft: '下書き',
  recording: '記録中',
  done: '保存済み'
};

/** 衝突しにくい ID。crypto があれば UUID、なければ時刻＋乱数 */
export function newId(prefix = 'id') {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return `${prefix}_${g.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function noteTypeOf(id) {
  return NOTE_TYPES.find((t) => t.id === id) || NOTE_TYPES[0];
}

/** 「会議, 読書 メモ」のような入力をタグ配列にする */
export function parseTags(input) {
  if (Array.isArray(input)) return normalizeTags(input);
  return normalizeTags(String(input || '').split(/[,、\s]+/));
}

function normalizeTags(list) {
  const out = [];
  for (const raw of list) {
    const t = String(raw || '').trim().replace(/^#/, '');
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function createSession(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: newId('ses'),
    title: '',
    tags: [],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    durationMs: 0,
    segments: [],
    notes: [],
    audio: null, // { mimeType, size } 実体は IndexedDB の audio ストア
    ...overrides
  };
}

export function createSegment({ text, startMs = 0, endMs = null }) {
  const now = new Date().toISOString();
  return {
    id: newId('seg'),
    text: String(text || '').trim(),
    startMs: Math.max(0, Math.round(startMs)),
    endMs: endMs == null ? null : Math.max(0, Math.round(endMs)),
    createdAt: now,
    updatedAt: now,
    edited: false
  };
}

export function createNote({ type = 'insight', text = '', atMs = 0, segmentId = null }) {
  const now = new Date().toISOString();
  return {
    id: newId('note'),
    type,
    text: String(text || ''),
    color: noteTypeOf(type).color,
    atMs: Math.max(0, Math.round(atMs)),
    segmentId,
    createdAt: now,
    updatedAt: now
  };
}

/** セッションの表示用タイトル（未入力なら日時から補う） */
export function displayTitle(session) {
  const t = String(session?.title || '').trim();
  if (t) return t;
  const d = new Date(session?.createdAt || Date.now());
  return `無題のセッション（${d.getMonth() + 1}/${d.getDate()}）`;
}

/** 検索対象になる全文（タイトル・タグ・文字起こし・メモ） */
export function fullText(session) {
  const parts = [
    session.title,
    (session.tags || []).join(' '),
    ...(session.segments || []).map((s) => s.text),
    ...(session.notes || []).map((n) => n.text)
  ];
  return parts.filter(Boolean).join('\n');
}

/** 指定ミリ秒に最も近い（それ以前の）セグメントを返す */
export function segmentAt(session, atMs) {
  const segs = (session.segments || []).slice().sort((a, b) => a.startMs - b.startMs);
  let hit = null;
  for (const s of segs) {
    if (s.startMs <= atMs) hit = s;
    else break;
  }
  return hit;
}

/** 統計（一覧カードの表示に使う） */
export function sessionStats(session) {
  const segments = session.segments || [];
  const chars = segments.reduce((n, s) => n + (s.text ? s.text.length : 0), 0);
  return {
    segmentCount: segments.length,
    noteCount: (session.notes || []).length,
    charCount: chars,
    hasAudio: Boolean(session.audio)
  };
}
