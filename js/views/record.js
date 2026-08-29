/* 記録画面：録音・文字起こし・メモを同時に扱う（提案書 4 章の中心画面） */

import { el, clear, toast, confirmDialog, promptDialog, autoGrow } from '../ui.js';
import * as store from '../store.js';
import { Transcriber, isSpeechSupported } from '../speech.js';
import { AudioRecorder, isRecorderSupported, ScreenLock } from '../recorder.js';
import { Stopwatch } from '../lib/stopwatch.js';
import { createSegment, createNote, displayTitle, NOTE_TYPES, noteTypeOf, segmentAt } from '../lib/model.js';
import { formatElapsed } from '../lib/time.js';

export function render(root, { navigate, params }) {
  const session = store.getSession(params.id);
  if (!session) {
    navigate('#/');
    return () => {};
  }

  clear(root);
  const settings = store.state.settings;
  const watch = new Stopwatch();
  const recorder = new AudioRecorder();
  const screenLock = new ScreenLock();

  let mode = 'idle'; // idle | recording | paused
  let interimText = '';
  let recognitionState = 'stopped';
  let banner = null;
  let autoScroll = true;
  let timerHandle = null;
  let audioStarted = false;
  let panel = 'transcript'; // モバイルで表示する側

  watch.reset();
  if (session.durationMs) watch._accumulated = session.durationMs;

  /* ---------- 部品 ---------- */
  const titleInput = el('input', {
    class: 'record-title',
    type: 'text',
    value: session.title,
    placeholder: 'タイトルを入力',
    'aria-label': 'セッションのタイトル',
    onChange: (e) => store.updateSession(session.id, { title: e.target.value.trim() })
  });

  const timerEl = el('span', { class: 'timer', text: formatElapsed(watch.elapsed()) });
  const stateDot = el('span', { class: 'state-dot' });
  const stateText = el('span', { class: 'state-text', text: '待機中' });
  const bannerHost = el('div', { class: 'banner-host' });

  const transcriptList = el('div', { class: 'transcript', tabindex: '0' });
  const interimLine = el('p', { class: 'interim', 'aria-live': 'polite' });
  const transcriptPanel = el('div', { class: 'panel panel--transcript' }, [
    el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: '文字起こし' }),
      el('button', {
        class: 'btn btn--sm btn--ghost', type: 'button',
        onClick: addManualSegment
      }, '＋ 文章を追加')
    ]),
    transcriptList,
    interimLine
  ]);

  const noteInput = el('textarea', {
    class: 'input input--note',
    rows: '2',
    placeholder: 'メモを入力（発言の位置に紐づきます）',
    'aria-label': 'メモ本文',
    onInput: (e) => autoGrow(e.target),
    onKeydown: (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); addNote(); }
    }
  });
  let noteType = NOTE_TYPES[0].id;
  const typeChips = el('div', { class: 'type-chips' });
  const noteList = el('div', { class: 'note-list' });
  const notePanel = el('div', { class: 'panel panel--notes' }, [
    el('div', { class: 'panel__head' }, [
      el('h2', { class: 'panel__title', text: 'メモ' }),
      el('span', { class: 'panel__hint', text: 'タップで該当箇所へ' })
    ]),
    el('div', { class: 'note-compose' }, [
      typeChips,
      noteInput,
      el('button', { class: 'btn btn--primary btn--block', type: 'button', onClick: addNote }, 'メモを追加')
    ]),
    noteList
  ]);

  const panelTabs = el('div', { class: 'panel-tabs', role: 'tablist' }, [
    el('button', { class: 'panel-tab is-active', type: 'button', role: 'tab', onClick: () => setPanel('transcript') }, '文字起こし'),
    el('button', { class: 'panel-tab', type: 'button', role: 'tab', onClick: () => setPanel('notes') }, 'メモ')
  ]);

  const startBtn = el('button', { class: 'btn btn--rec', type: 'button', onClick: onPrimary }, '● 録音開始');
  const pauseBtn = el('button', { class: 'btn btn--ghost', type: 'button', hidden: true, onClick: onPause }, '一時停止');
  const stopBtn = el('button', { class: 'btn btn--ghost', type: 'button', hidden: true, onClick: onStop }, '終了して保存');

  const view = el('section', { class: 'view view--record' }, [
    el('header', { class: 'record-head' }, [
      el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '戻る', onClick: leave }, '←'),
      titleInput,
      el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '詳細', onClick: () => navigate(`#/session/${session.id}`) }, '☰')
    ]),
    el('div', { class: 'record-status' }, [stateDot, stateText, timerEl]),
    bannerHost,
    panelTabs,
    el('div', { class: 'panels' }, [transcriptPanel, notePanel]),
    el('footer', { class: 'record-controls' }, [startBtn, pauseBtn, stopBtn])
  ]);
  root.append(view);

  /* ---------- 認識エンジン ---------- */
  const transcriber = new Transcriber({
    lang: settings.lang,
    autoRestart: settings.autoRestart,
    elapsed: () => watch.elapsed(),
    onInterim: (text) => {
      interimText = text;
      interimLine.textContent = text;
      if (text) scrollToBottom();
    },
    onFinal: (seg) => {
      if (!seg.text) return;
      const segment = createSegment(seg);
      store.updateSessionBuffered(session.id, (s) => ({
        segments: [...s.segments, segment],
        durationMs: Math.max(s.durationMs, watch.elapsed())
      }));
      appendSegment(segment);
      scrollToBottom();
    },
    onStatus: (status, detail) => {
      recognitionState = status;
      paintState(detail);
    },
    onError: (message, fatal) => {
      showBanner(message, fatal ? 'error' : 'warn');
      if (fatal && mode === 'recording') {
        // 認識が使えなくても録音と文字入力は続けられる
        recognitionState = 'unavailable';
        paintState();
      }
    }
  });

  /* ---------- 描画 ---------- */
  function paintState(detail) {
    const map = {
      idle: ['待機中', 'idle'],
      listening: ['認識中', 'live'],
      reconnecting: ['再接続中…', 'warn'],
      stopped: ['停止', 'idle'],
      unavailable: ['認識オフ（文字入力で記録できます）', 'warn']
    };
    let label;
    let tone;
    if (mode === 'paused') [label, tone] = ['一時停止中', 'warn'];
    else if (mode === 'idle') [label, tone] = ['待機中', 'idle'];
    else [label, tone] = map[recognitionState] || ['記録中', 'live'];
    stateText.textContent = detail ? `${label}・${detail}` : label;
    stateDot.className = `state-dot state-dot--${tone}`;
    view.classList.toggle('is-recording', mode === 'recording');
  }

  function showBanner(message, kind = 'warn') {
    clear(bannerHost);
    if (!message) { banner = null; return; }
    banner = el('div', { class: `banner banner--${kind}` }, [
      el('span', { text: message }),
      el('button', { class: 'banner__close', type: 'button', 'aria-label': '閉じる', onClick: () => clear(bannerHost) }, '×')
    ]);
    bannerHost.append(banner);
  }

  function setPanel(next) {
    panel = next;
    view.classList.toggle('show-notes', panel === 'notes');
    [...panelTabs.children].forEach((b, i) => b.classList.toggle('is-active', (i === 0) === (panel === 'transcript')));
  }

  function scrollToBottom() {
    if (!autoScroll) return;
    transcriptList.scrollTop = transcriptList.scrollHeight;
  }

  transcriptList.addEventListener('scroll', () => {
    const nearBottom = transcriptList.scrollHeight - transcriptList.scrollTop - transcriptList.clientHeight < 60;
    autoScroll = nearBottom;
  });

  function appendSegment(segment) {
    transcriptList.append(segmentRow(segment));
  }

  function segmentRow(segment) {
    const time = el('button', {
      class: 'seg__time', type: 'button', title: 'この時刻でメモを追加',
      onClick: () => {
        noteInput.focus();
        noteInput.dataset.atMs = String(segment.startMs);
        noteInput.dataset.segmentId = segment.id;
        setPanel('notes');
        toast(`${formatElapsed(segment.startMs)} にメモを紐づけます`);
      }
    }, formatElapsed(segment.startMs));

    const text = el('div', {
      class: 'seg__text',
      contenteditable: 'true',
      role: 'textbox',
      spellcheck: 'false',
      text: segment.text,
      onBlur: (e) => {
        const value = e.target.textContent.trim();
        if (value === segment.text) return;
        segment.text = value;
        store.updateSession(session.id, (s) => ({
          segments: s.segments.map((x) => (x.id === segment.id
            ? { ...x, text: value, edited: true, updatedAt: new Date().toISOString() }
            : x))
        }));
        row.classList.add('seg--edited');
        toast('修正を保存しました');
      },
      onKeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.blur(); }
      }
    });

    const del = el('button', {
      class: 'seg__del', type: 'button', 'aria-label': 'この行を削除',
      onClick: async () => {
        const ok = await confirmDialog({ title: 'この文を削除しますか', message: segment.text.slice(0, 80), confirmLabel: '削除する', danger: true });
        if (!ok) return;
        await store.updateSession(session.id, (s) => ({ segments: s.segments.filter((x) => x.id !== segment.id) }));
        row.remove();
      }
    }, '×');

    const row = el('div', { class: `seg ${segment.edited ? 'seg--edited' : ''}`, dataset: { id: segment.id } }, [time, text, del]);
    return row;
  }

  function renderTranscript() {
    clear(transcriptList);
    const segs = (store.getSession(session.id)?.segments || []).slice().sort((a, b) => a.startMs - b.startMs);
    if (!segs.length) {
      transcriptList.append(el('p', { class: 'empty', text: '録音を開始すると、ここに文字起こしが表示されます。「文章を追加」から手入力もできます。' }));
      return;
    }
    for (const s of segs) transcriptList.append(segmentRow(s));
    scrollToBottom();
  }

  function renderTypeChips() {
    clear(typeChips);
    for (const t of NOTE_TYPES) {
      typeChips.append(el('button', {
        class: `chip chip--type ${t.id === noteType ? 'chip--active' : ''}`,
        type: 'button',
        style: `--chip-color:${t.color}`,
        onClick: () => { noteType = t.id; renderTypeChips(); noteInput.focus(); }
      }, t.label));
    }
  }

  function renderNotes() {
    clear(noteList);
    const current = store.getSession(session.id);
    const notes = (current?.notes || []).slice().sort((a, b) => b.atMs - a.atMs);
    if (!notes.length) {
      noteList.append(el('p', { class: 'empty', text: 'メモはまだありません。気づき・TODO・確認事項を種類ごとに残せます。' }));
      return;
    }
    for (const note of notes) noteList.append(noteRow(note));
  }

  function noteRow(note) {
    const type = noteTypeOf(note.type);
    const row = el('article', { class: 'note', style: `--note-color:${type.color}` }, [
      el('div', { class: 'note__head' }, [
        el('span', { class: 'note__type', text: type.label }),
        el('button', {
          class: 'note__time', type: 'button', title: '該当する発言へ移動',
          onClick: () => jumpToSegment(note)
        }, formatElapsed(note.atMs))
      ]),
      el('div', {
        class: 'note__text', contenteditable: 'true', role: 'textbox', text: note.text,
        onBlur: (e) => {
          const value = e.target.textContent.trim();
          if (value === note.text) return;
          note.text = value;
          store.updateSession(session.id, (s) => ({
            notes: s.notes.map((n) => (n.id === note.id ? { ...n, text: value, updatedAt: new Date().toISOString() } : n))
          }));
          toast('メモを更新しました');
        }
      }),
      el('button', {
        class: 'note__del', type: 'button', 'aria-label': 'メモを削除',
        onClick: async () => {
          const ok = await confirmDialog({ title: 'メモを削除しますか', message: note.text.slice(0, 80), confirmLabel: '削除する', danger: true });
          if (!ok) return;
          await store.updateSession(session.id, (s) => ({ notes: s.notes.filter((n) => n.id !== note.id) }));
          row.remove();
        }
      }, '×')
    ]);
    return row;
  }

  function jumpToSegment(note) {
    setPanel('transcript');
    const current = store.getSession(session.id);
    const target = note.segmentId
      ? (current.segments || []).find((s) => s.id === note.segmentId)
      : segmentAt(current, note.atMs);
    if (!target) { toast('対応する発言が見つかりませんでした'); return; }
    const node = transcriptList.querySelector(`[data-id="${target.id}"]`);
    if (!node) return;
    autoScroll = false;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('seg--flash');
    setTimeout(() => node.classList.remove('seg--flash'), 1400);
  }

  /* ---------- 操作 ---------- */
  async function addNote() {
    const text = noteInput.value.trim();
    if (!text) { noteInput.focus(); return; }
    const atMs = noteInput.dataset.atMs ? Number(noteInput.dataset.atMs) : watch.elapsed();
    const current = store.getSession(session.id);
    const linked = noteInput.dataset.segmentId || segmentAt(current, atMs)?.id || null;
    const note = createNote({ type: noteType, text, atMs, segmentId: linked });
    await store.updateSession(session.id, (s) => ({ notes: [...s.notes, note] }));
    noteInput.value = '';
    delete noteInput.dataset.atMs;
    delete noteInput.dataset.segmentId;
    autoGrow(noteInput);
    renderNotes();
    toast('メモを追加しました');
  }

  async function addManualSegment() {
    const text = await promptDialog({
      title: '文章を追加',
      label: '認識できなかった部分を手入力できます',
      placeholder: '例）来週までに見積もりを出す',
      confirmLabel: '文字起こしに追加'
    });
    if (!text) return;
    const segment = createSegment({ text, startMs: watch.elapsed() });
    await store.updateSession(session.id, (s) => ({
      segments: [...s.segments, segment],
      durationMs: Math.max(s.durationMs, watch.elapsed())
    }));
    renderTranscript();
  }

  async function onPrimary() {
    if (mode === 'recording') return;
    if (mode === 'paused') { await resume(); return; }
    await begin();
  }

  async function begin() {
    showBanner('');
    watch.start();
    mode = 'recording';
    await store.updateSession(session.id, { status: 'recording', startedAt: session.startedAt || new Date().toISOString() });

    if (store.state.settings.saveAudio && isRecorderSupported()) {
      try {
        await recorder.start();
        audioStarted = true;
      } catch (err) {
        showBanner(`録音を開始できませんでした（${err.message}）。文字起こしのみ続行します。`, 'warn');
      }
    } else if (store.state.settings.saveAudio) {
      showBanner('このブラウザは録音の保存に対応していません。文字起こしのみ記録します。', 'warn');
    }

    if (isSpeechSupported()) transcriber.start();
    else showBanner('このブラウザは音声認識に対応していません。Android では Chrome をお使いください。「文章を追加」で手入力できます。', 'warn');

    if (store.state.settings.keepAwake) await screenLock.acquire();
    startTimer();
    updateControls();
    paintState();
  }

  async function resume() {
    watch.start();
    mode = 'recording';
    if (audioStarted) recorder.resume();
    if (isSpeechSupported()) transcriber.start();
    if (store.state.settings.keepAwake) await screenLock.acquire();
    startTimer();
    updateControls();
    paintState();
  }

  async function onPause() {
    if (mode !== 'recording') return;
    watch.pause();
    mode = 'paused';
    transcriber.stop();
    if (audioStarted) recorder.pause();
    stopTimer();
    await store.updateSession(session.id, { durationMs: watch.elapsed() });
    await store.flushSaves();
    await screenLock.release();
    updateControls();
    paintState();
    toast('一時停止しました（保存済み）');
  }

  async function onStop() {
    watch.pause();
    mode = 'idle';
    transcriber.stop();
    stopTimer();
    await screenLock.release();
    await store.flushSaves();

    let audioNote = '';
    if (audioStarted) {
      try {
        const blob = await recorder.stop();
        if (blob && blob.size > 0) {
          await store.saveAudio(session.id, blob);
          audioNote = '・音声を保存しました';
        }
      } catch {
        audioNote = '・音声の保存に失敗しました';
      }
      audioStarted = false;
    }

    await store.updateSession(session.id, { status: 'done', durationMs: watch.elapsed() });
    toast(`セッションを保存しました${audioNote}`);
    navigate(`#/session/${session.id}`);
  }

  async function leave() {
    if (mode === 'recording' || mode === 'paused') {
      const ok = await confirmDialog({
        title: '記録中です',
        message: '画面を離れると録音と認識を停止し、ここまでの内容を下書きとして保存します。',
        confirmLabel: '停止して戻る'
      });
      if (!ok) return;
      watch.pause();
      transcriber.stop();
      stopTimer();
      await screenLock.release();
      if (audioStarted) {
        const blob = await recorder.stop().catch(() => null);
        if (blob && blob.size > 0) await store.saveAudio(session.id, blob);
        audioStarted = false;
      }
      await store.updateSession(session.id, { status: 'draft', durationMs: watch.elapsed() });
      await store.flushSaves();
    }
    navigate('#/');
  }

  function updateControls() {
    startBtn.hidden = mode === 'recording';
    startBtn.textContent = mode === 'paused' ? '● 再開する' : '● 録音開始';
    pauseBtn.hidden = mode !== 'recording';
    stopBtn.hidden = mode === 'idle' && !session.startedAt && watch.elapsed() === 0;
  }

  function startTimer() {
    stopTimer();
    timerHandle = setInterval(() => {
      timerEl.textContent = formatElapsed(watch.elapsed());
    }, 250);
  }

  function stopTimer() {
    clearInterval(timerHandle);
    timerHandle = null;
    timerEl.textContent = formatElapsed(watch.elapsed());
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      screenLock.reacquireIfNeeded(mode === 'recording');
    } else if (mode === 'recording') {
      // Android では画面を離れると認識が止まることがある
      showBanner('画面を離れている間は認識が止まることがあります。戻ったら状態を確認してください。', 'warn');
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  const onBeforeUnload = (e) => {
    if (mode === 'recording' || mode === 'paused') {
      store.flushSaves();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  renderTranscript();
  renderTypeChips();
  renderNotes();
  setPanel('transcript');
  updateControls();
  paintState();

  /* 画面を離れるときの後始末 */
  return function destroy() {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
    transcriber.stop();
    stopTimer();
    screenLock.release();
    if (audioStarted) recorder.stop().catch(() => {});
    store.flushSaves();
  };
}
