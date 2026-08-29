/* 書き出し（DOM 非依存 / テスト対象）
   提案書 3.2「テキスト／Markdown／CSV」+ 「JSON バックアップ」に対応 */

import { displayTitle, noteTypeOf } from './model.js';
import { formatElapsed, formatDateTime } from './time.js';

export const SCHEMA_VERSION = 1;

const sortedSegments = (s) => (s.segments || []).slice().sort((a, b) => a.startMs - b.startMs);
const sortedNotes = (s) => (s.notes || []).slice().sort((a, b) => a.atMs - b.atMs);

/** プレーンテキスト：文字起こし本文のみ */
export function toText(session) {
  const lines = [displayTitle(session), formatDateTime(session.createdAt), ''];
  for (const seg of sortedSegments(session)) {
    lines.push(`[${formatElapsed(seg.startMs)}] ${seg.text}`);
  }
  const notes = sortedNotes(session);
  if (notes.length) {
    lines.push('', '--- メモ ---');
    for (const n of notes) {
      lines.push(`[${formatElapsed(n.atMs)}] (${noteTypeOf(n.type).label}) ${n.text}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Markdown：メタ情報・文字起こし・メモをまとめた読み物形式 */
export function toMarkdown(session) {
  const out = [];
  out.push(`# ${displayTitle(session)}`, '');
  out.push('| 項目 | 内容 |', '| --- | --- |');
  out.push(`| 日時 | ${formatDateTime(session.createdAt)} |`);
  out.push(`| 用途 | ${session.purpose || '—'} |`);
  out.push(`| 参加者 | ${session.participants || '—'} |`);
  out.push(`| タグ | ${(session.tags || []).map((t) => `#${t}`).join(' ') || '—'} |`);
  out.push(`| 収録時間 | ${formatElapsed(session.durationMs)} |`);
  out.push('');

  out.push('## 文字起こし', '');
  const segs = sortedSegments(session);
  if (segs.length === 0) out.push('_（本文はありません）_', '');
  for (const seg of segs) {
    out.push(`- \`${formatElapsed(seg.startMs)}\` ${seg.text}${seg.edited ? ' _(修正済み)_' : ''}`);
  }
  out.push('');

  out.push('## メモ', '');
  const notes = sortedNotes(session);
  if (notes.length === 0) out.push('_（メモはありません）_');
  for (const n of notes) {
    out.push(`- **${noteTypeOf(n.type).label}** \`${formatElapsed(n.atMs)}\` ${n.text}`);
  }
  out.push('');
  return out.join('\n');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsvRows(session) {
  const rows = [['種別', '時刻', 'メモ種別', '本文', '紐づけID', '作成日時']];
  for (const seg of sortedSegments(session)) {
    rows.push(['文字起こし', formatElapsed(seg.startMs), '', seg.text, seg.id, formatDateTime(seg.createdAt)]);
  }
  for (const n of sortedNotes(session)) {
    rows.push(['メモ', formatElapsed(n.atMs), noteTypeOf(n.type).label, n.text, n.segmentId || '', formatDateTime(n.createdAt)]);
  }
  return rows;
}

/** CSV：Excel の日本語環境でも開けるよう BOM は書き出し側で付与する */
export function toCsv(session) {
  return toCsvRows(session)
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

/** JSON バックアップ（1件でも全件でも同じ形） */
export function toBackup(sessions) {
  const list = Array.isArray(sessions) ? sessions : [sessions];
  return {
    app: 'kioku',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sessionCount: list.length,
    sessions: list
  };
}

/**
 * バックアップ JSON を読み込む。壊れた入力は例外にせず理由を返す。
 * @returns {{ok:true, sessions:Array}|{ok:false, error:string}}
 */
export function parseBackup(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'JSON として読み取れませんでした。' };
    }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: 'データが空です。' };

  const sessions = Array.isArray(data) ? data : data.sessions;
  if (!Array.isArray(sessions)) return { ok: false, error: 'sessions 配列が見つかりません。' };
  if (data.schemaVersion && Number(data.schemaVersion) > SCHEMA_VERSION) {
    return { ok: false, error: 'このアプリより新しい形式のバックアップです。' };
  }

  const cleaned = [];
  for (const s of sessions) {
    if (!s || typeof s !== 'object' || !s.id) continue;
    cleaned.push({
      ...s,
      tags: Array.isArray(s.tags) ? s.tags : [],
      segments: Array.isArray(s.segments) ? s.segments : [],
      notes: Array.isArray(s.notes) ? s.notes : [],
      audio: s.audio || null
    });
  }
  if (cleaned.length === 0) return { ok: false, error: '取り込めるセッションがありませんでした。' };
  return { ok: true, sessions: cleaned };
}

/** ファイル名に使えない文字を落とす */
export function safeFileName(name, fallback = 'session') {
  const base = String(name || '').trim().replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 60);
  return base || fallback;
}
