/* アプリ全体の状態と保存。
   画面は store 経由でのみデータを触る（保存漏れを防ぐため）。 */

import * as db from './db.js';
import { loadSettings, saveSettings } from './settings.js';
import { createSession } from './lib/model.js';
import { parseBackup, toBackup } from './lib/export.js';

const listeners = new Set();

export const state = {
  ready: false,
  sessions: [],
  settings: loadSettings(),
  error: null
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export async function init() {
  try {
    state.sessions = await db.getAllSessions();
    state.ready = true;
  } catch (err) {
    state.error = err.message;
    state.ready = true;
  }
  emit();
}

export function getSession(id) {
  return state.sessions.find((s) => s.id === id) || null;
}

export async function addSession(fields = {}) {
  const session = createSession(fields);
  state.sessions.push(session);
  await db.putSession(session);
  emit();
  return session;
}

/** 部分更新して即保存する。updatedAt は自動で更新。 */
export async function updateSession(id, patch) {
  const idx = state.sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const next = {
    ...state.sessions[idx],
    ...(typeof patch === 'function' ? patch(state.sessions[idx]) : patch),
    updatedAt: new Date().toISOString()
  };
  state.sessions[idx] = next;
  await db.putSession(next);
  emit();
  return next;
}

/** 記録中の高頻度更新用。保存はまとめて行い、通知は即時に出す。 */
let saveTimer = null;
const pendingSaves = new Map();

export function updateSessionBuffered(id, patch, { flushMs = 800 } = {}) {
  const idx = state.sessions.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const next = {
    ...state.sessions[idx],
    ...(typeof patch === 'function' ? patch(state.sessions[idx]) : patch),
    updatedAt: new Date().toISOString()
  };
  state.sessions[idx] = next;
  pendingSaves.set(id, next);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, flushMs);
  emit();
  return next;
}

export async function flushSaves() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (pendingSaves.size === 0) return;
  const items = [...pendingSaves.values()];
  pendingSaves.clear();
  await db.putSessions(items);
}

export async function removeSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  pendingSaves.delete(id);
  await db.deleteSession(id);
  emit();
}

export async function saveAudio(sessionId, blob) {
  const meta = await db.putAudio(sessionId, blob);
  await updateSession(sessionId, { audio: meta });
  return meta;
}

export function loadAudio(sessionId) {
  return db.getAudio(sessionId);
}

export async function removeAudio(sessionId) {
  await db.deleteAudio(sessionId);
  await updateSession(sessionId, { audio: null });
}

export function updateSettings(patch) {
  state.settings = saveSettings(patch);
  emit();
  return state.settings;
}

export async function clearEverything() {
  await db.clearAll();
  state.sessions = [];
  pendingSaves.clear();
  emit();
}

export function exportAll() {
  return toBackup(state.sessions);
}

/**
 * バックアップ取り込み。同じ ID は上書きせず新規として追加する。
 * @returns {{ok:boolean, added?:number, error?:string}}
 */
export async function importBackup(raw) {
  const parsed = parseBackup(raw);
  if (!parsed.ok) return parsed;
  const existing = new Set(state.sessions.map((s) => s.id));
  const incoming = parsed.sessions.map((s) => {
    if (!existing.has(s.id)) return s;
    return { ...s, id: `${s.id}_imported_${Date.now().toString(36)}`, title: `${s.title || '無題'}（取り込み）` };
  });
  await db.putSessions(incoming);
  state.sessions = await db.getAllSessions();
  emit();
  return { ok: true, added: incoming.length };
}

export { estimateUsage } from './db.js';
