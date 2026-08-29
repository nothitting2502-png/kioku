/* セッション詳細：終了後の整理・再利用（提案書 4 章） */

import { el, clear, toast, confirmDialog, promptDialog, downloadFile, shareText, highlight, bytes } from '../ui.js';
import * as store from '../store.js';
import { displayTitle, sessionStats, parseTags, noteTypeOf, NOTE_TYPES, segmentAt } from '../lib/model.js';
import { formatDateTime, formatElapsed, fileStamp } from '../lib/time.js';
import { toText, toMarkdown, toCsv, safeFileName } from '../lib/export.js';
import { searchInSession } from '../lib/search.js';

export function render(root, { navigate, params }) {
  const session = store.getSession(params.id);
  if (!session) { navigate('#/'); return () => {}; }

  clear(root);
  let query = '';
  let audioUrl = null;
  let audioEl = null;

  const stats = sessionStats(session);

  const view = el('section', { class: 'view view--detail' });

  /* タイトルとタグは「編集」を開かず、その場で直せる */
  const titleInput = el('input', {
    class: 'record-title', type: 'text', value: session.title,
    placeholder: 'タイトルを入力', 'aria-label': 'タイトル',
    onChange: (e) => store.updateSession(session.id, { title: e.target.value.trim() })
  });

  view.append(el('header', { class: 'record-head' }, [
    el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '戻る', onClick: () => navigate('#/') }, '←'),
    titleInput,
    el('button', { class: 'btn btn--icon btn--rec-dot', type: 'button', 'aria-label': '録音を続ける', title: '録音を続ける', onClick: () => navigate(`#/record/${session.id}`) }, '●')
  ]));

  view.append(el('p', { class: 'detail-meta', text:
    `${formatDateTime(session.createdAt)}・${formatElapsed(session.durationMs)}・文字起こし${stats.segmentCount}件・メモ${stats.noteCount}件・${stats.charCount}文字` }));

  /* --- 音声 --- */
  const audioHost = el('div', { class: 'audio-host' });
  view.append(audioHost);

  /* --- タグ --- */
  view.append(el('input', {
    class: 'input input--tags', type: 'text', value: (session.tags || []).join(' '),
    placeholder: 'タグ（スペース区切り）', 'aria-label': 'タグ',
    onChange: async (e) => {
      await store.updateSession(session.id, { tags: parseTags(e.target.value) });
      toast('保存しました');
    }
  }));

  /* --- セッション内検索 --- */
  const searchInput = el('input', {
    class: 'input input--search', type: 'search', placeholder: 'このセッション内を検索',
    onInput: (e) => { query = e.target.value; renderBody(); }
  });
  view.append(searchInput);

  const hitInfo = el('p', { class: 'list-summary' });
  const transcriptHost = el('div', { class: 'panel panel--flat' });
  const noteHost = el('div', { class: 'panel panel--flat' });
  view.append(hitInfo, transcriptHost, noteHost);

  /* --- 書き出し --- */
  view.append(el('div', { class: 'export-bar' }, [
    el('h2', { class: 'panel__title', text: '書き出し・共有' }),
    el('div', { class: 'export-buttons' }, [
      exportButton('共有', async () => {
        const ok = await shareText(displayTitle(current()), toText(current()));
        if (!ok) toast('この環境では共有シートを開けませんでした', 'error');
      }),
      exportButton('テキスト', () => download('txt', toText(current()), 'text/plain;charset=utf-8')),
      exportButton('Markdown', () => download('md', toMarkdown(current()), 'text/markdown;charset=utf-8')),
      exportButton('CSV', () => download('csv', '﻿' + toCsv(current()), 'text/csv;charset=utf-8'))
    ]),
    el('button', {
      class: 'btn btn--ghost btn--danger-text btn--block', type: 'button',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'セッションを削除しますか',
          message: '文字起こし・メモ・音声をこの端末から完全に削除します。元に戻せません。',
          confirmLabel: '削除する', danger: true
        });
        if (!ok) return;
        await store.removeSession(session.id);
        toast('削除しました');
        navigate('#/');
      }
    }, 'このセッションを削除')
  ]));

  root.append(view);

  function current() {
    return store.getSession(session.id) || session;
  }

  function exportButton(label, onClick) {
    return el('button', { class: 'btn btn--sm', type: 'button', onClick }, label);
  }

  function download(ext, content, mime) {
    const name = `${safeFileName(displayTitle(current()))}-${fileStamp(current().createdAt)}.${ext}`;
    downloadFile(name, content, mime);
    toast(`${ext.toUpperCase()} を書き出しました`);
  }

  async function downloadAudio() {
    const blob = await store.loadAudio(session.id);
    if (!blob) { toast('このセッションに音声はありません', 'error'); return; }
    const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
    downloadFile(`${safeFileName(displayTitle(current()))}-${fileStamp(current().createdAt)}.${ext}`, blob, blob.type);
    toast('音声を書き出しました');
  }

  async function renderAudio() {
    clear(audioHost);
    const meta = current().audio;
    if (!meta) return;
    const blob = await store.loadAudio(session.id);
    if (!blob) return;
    audioUrl = URL.createObjectURL(blob);
    audioEl = el('audio', { class: 'audio', controls: true, src: audioUrl, preload: 'metadata' });
    audioHost.append(
      audioEl,
      el('div', { class: 'audio-meta' }, [
        el('span', { text: `音声 ${bytes(meta.size)}・時刻をタップするとその位置から再生します` }),
        el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: downloadAudio }, '音声を保存')
      ])
    );
  }

  function seekTo(ms) {
    if (!audioEl) return false;
    audioEl.currentTime = Math.max(0, ms / 1000);
    audioEl.play().catch(() => {});
    return true;
  }

  function renderBody() {
    const s = current();
    const hits = query ? searchInSession(s, query) : null;
    hitInfo.textContent = query
      ? `一致：文字起こし ${hits.segments.length}件 / メモ ${hits.notes.length}件`
      : '';

    clear(transcriptHost);
    transcriptHost.append(el('div', { class: 'panel__head' }, [el('h2', { class: 'panel__title', text: '文字起こし' })]));
    const segs = (query ? hits.segments : (s.segments || [])).slice().sort((a, b) => a.startMs - b.startMs);
    if (!segs.length) {
      transcriptHost.append(el('p', { class: 'empty', text: query ? '一致する文はありません。' : '文字起こしはありません。' }));
    }
    for (const seg of segs) {
      transcriptHost.append(el('div', { class: `seg ${seg.edited ? 'seg--edited' : ''}`, dataset: { id: seg.id } }, [
        el('button', {
          class: 'seg__time', type: 'button', title: 'この位置から再生',
          onClick: () => { if (!seekTo(seg.startMs)) toast('音声が保存されていません'); }
        }, formatElapsed(seg.startMs)),
        el('div', {
          class: 'seg__text', contenteditable: 'true', role: 'textbox',
          html: highlight(seg.text, query),
          onBlur: async (e) => {
            const value = e.target.textContent.trim();
            if (value === seg.text) return;
            await store.updateSession(session.id, (x) => ({
              segments: x.segments.map((y) => (y.id === seg.id ? { ...y, text: value, edited: true, updatedAt: new Date().toISOString() } : y))
            }));
            toast('修正を保存しました');
            renderBody();
          }
        })
      ]));
    }

    clear(noteHost);
    noteHost.append(el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: 'メモ' }),
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: addNoteHere }, '＋ メモを追加')
    ]));
    const notes = (query ? hits.notes : (s.notes || [])).slice().sort((a, b) => a.atMs - b.atMs);
    if (!notes.length) {
      noteHost.append(el('p', { class: 'empty', text: query ? '一致するメモはありません。' : 'メモはありません。' }));
    }
    for (const note of notes) {
      const type = noteTypeOf(note.type);
      noteHost.append(el('article', { class: 'note', style: `--note-color:${type.color}` }, [
        el('div', { class: 'note__head' }, [
          el('span', { class: 'note__type', text: type.label }),
          el('button', {
            class: 'note__time', type: 'button', title: '該当箇所へ',
            onClick: () => {
              const target = note.segmentId ? (s.segments || []).find((x) => x.id === note.segmentId) : segmentAt(s, note.atMs);
              if (audioEl) seekTo(note.atMs);
              if (target) {
                const node = transcriptHost.querySelector(`[data-id="${target.id}"]`);
                node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                node?.classList.add('seg--flash');
                setTimeout(() => node?.classList.remove('seg--flash'), 1400);
              }
            }
          }, formatElapsed(note.atMs))
        ]),
        el('div', {
          class: 'note__text', contenteditable: 'true', role: 'textbox', html: highlight(note.text, query),
          onBlur: async (e) => {
            const value = e.target.textContent.trim();
            if (value === note.text) return;
            await store.updateSession(session.id, (x) => ({
              notes: x.notes.map((n) => (n.id === note.id ? { ...n, text: value, updatedAt: new Date().toISOString() } : n))
            }));
            toast('メモを更新しました');
            renderBody();
          }
        }),
        el('button', {
          class: 'note__del', type: 'button', 'aria-label': 'メモを削除',
          onClick: async () => {
            const ok = await confirmDialog({ title: 'メモを削除しますか', message: note.text.slice(0, 80), confirmLabel: '削除する', danger: true });
            if (!ok) return;
            await store.updateSession(session.id, (x) => ({ notes: x.notes.filter((n) => n.id !== note.id) }));
            renderBody();
          }
        }, '×')
      ]));
    }
  }

  async function addNoteHere() {
    const text = await promptDialog({
      title: 'メモを追加',
      label: audioEl ? '再生位置に紐づけて保存します' : 'このセッションにメモを追加します',
      placeholder: '例）ここは要確認',
      confirmLabel: 'メモを追加'
    });
    if (!text) return;
    const atMs = audioEl ? Math.round(audioEl.currentTime * 1000) : 0;
    const s = current();
    const { createNote } = await import('../lib/model.js');
    const note = createNote({ type: NOTE_TYPES[0].id, text, atMs, segmentId: segmentAt(s, atMs)?.id || null });
    await store.updateSession(session.id, (x) => ({ notes: [...x.notes, note] }));
    renderBody();
  }

  renderAudio();
  renderBody();

  return function destroy() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  };
}
