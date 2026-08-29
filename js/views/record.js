/* 記録画面：録音・文字起こし・メモを同時に扱う（提案書 4 章の中心画面） */

import { el, clear, toast, confirmDialog, promptDialog, autoGrow } from '../ui.js';
import * as store from '../store.js';
import { Transcriber, isSpeechSupported } from '../speech.js';
import { AudioRecorder, isRecorderSupported, ScreenLock } from '../recorder.js';
import { Stopwatch } from '../lib/stopwatch.js';
import { createSegment, createNote, displayTitle, NOTE_TYPES, noteTypeOf, segmentAt } from '../lib/model.js';
import { formatElapsed } from '../lib/time.js';

/** 認識を開始してから、これだけ経っても結果が無ければ手が打てる案内に切り替える */
const WATCHDOG_MS = 9000;

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
  let blockedHandled = false;   // マイク競合の案内を出したか
  let lastSegmentId = null;     // 直前に積んだ行（伸びた結果の書き換え先）
  let watchdogHandle = null;    // 「開始したのに何も出ない」の見張り

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
    el('div', { class: 'panel__head panel__head--end' }, [
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
      titleInput
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
    autoRestart: true,   // 途切れたら必ず自分で戻る
    elapsed: () => watch.elapsed(),
    onInterim: (text) => {
      interimText = text;
      interimLine.textContent = text;
      if (text) scrollToBottom();
    },
    onFinal: (seg) => {
      if (!seg.text) return;

      /* Android は同じ文を伸ばしながら何度も返してくる。
         その場合は行を増やさず、直前の行を書き換える。 */
      if (seg.replacesLast && lastSegmentId && replaceLastSegment(seg)) return;

      const segment = createSegment(seg);
      lastSegmentId = segment.id;
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
      // マイクの取り合いは onBlocked 側で案内するので、二重にバナーを出さない
      if (blockedHandled) return;
      showBanner(message, fatal ? 'error' : 'warn');
      if (fatal && mode === 'recording') {
        // 認識が使えなくても録音と文字入力は続けられる
        recognitionState = 'unavailable';
        paintState();
      }
    },
    onBlocked: (info) => { handleBlocked(info); }
  });

  /* ---------- 認識が音声を取れないときの回復 ----------
     Android では音声認識サービスがマイクを占有するため、
     MediaRecorder が先にマイクを掴んでいると認識が何も返さずに終わる。
     録音を手放してマイクを空け、利用者のタップで認識を開始し直す。 */
  async function handleBlocked(info) {
    if (blockedHandled) return;
    blockedHandled = true;
    recognitionState = 'unavailable';
    paintState();

    if (audioStarted) {
      // ここまでの音声は失わずに保存してから、マイクを解放する
      let saved = false;
      try {
        const blob = await recorder.stop();
        if (blob && blob.size > 0) { await store.saveAudio(session.id, blob); saved = true; }
      } catch {
        /* 保存できなくても認識の回復を優先する */
      }
      audioStarted = false;
      store.updateSettings({ deviceCannotDoBoth: true });

      showBanner(
        `この端末では録音と文字起こしを同時に使えないようです。${saved ? 'ここまでの音声は保存しました。' : ''}録音を止めてマイクを空けたので、下のボタンで文字起こしを始められます。`,
        'warn',
        { label: '文字起こしを開始', onClick: () => { blockedHandled = false; retryRecognition(); } }
      );
      return;
    }

    showBanner(blockedMessage(info?.code), 'error',
      { label: 'もう一度試す', onClick: () => { blockedHandled = false; retryRecognition(); } });
  }

  function blockedMessage(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'マイクの使用が許可されていません。アドレスバーの鍵アイコンからマイクを許可して、もう一度お試しください。';
      case 'audio-capture':
      case 'no-audio':
      case 'no-result':
        return '音声を取り込めませんでした。他のアプリがマイクを使っていないか確認してください。「＋ 文章を追加」で手入力もできます。';
      case 'start-failed':
        return '音声認識を開始できませんでした。ページを開き直してからもう一度お試しください。';
      default:
        return `音声を取り込めませんでした（${code || '原因不明'}）。マイクの許可と通信状態を確認してください。`;
    }
  }

  /** バナーのボタンから呼ぶ。タップ直後なので start() が許可される */
  function retryRecognition() {
    if (!isSpeechSupported()) return;
    transcriber.start();
    startWatchdog();
    paintState();
  }

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

  /** @param {{label:string, onClick:Function}} [action] バナー内に置く操作ボタン */
  function showBanner(message, kind = 'warn', action = null) {
    clear(bannerHost);
    if (!message) { banner = null; return; }
    banner = el('div', { class: `banner banner--${kind}` }, [
      el('div', { class: 'banner__body' }, [
        el('span', { text: message }),
        action
          ? el('button', {
              class: 'btn btn--sm banner__action', type: 'button',
              onClick: () => { clear(bannerHost); action.onClick(); }
            }, action.label)
          : null
      ]),
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
    // 最初の1行が入ったら案内文は退ける
    transcriptList.querySelector('.empty')?.remove();
    transcriptList.append(segmentRow(segment));
  }

  /** 直前の行を書き換える。編集中や行が消えている場合は諦めて新しい行にする */
  function replaceLastSegment(seg) {
    const current = store.getSession(session.id);
    const target = (current?.segments || []).find((x) => x.id === lastSegmentId);
    if (!target) return false;

    const node = transcriptList.querySelector(`[data-id="${lastSegmentId}"] .seg__text`);
    if (node && document.activeElement === node) return false;  // 手で直している最中は触らない

    store.updateSessionBuffered(session.id, (s) => ({
      segments: s.segments.map((x) => (x.id === lastSegmentId
        ? { ...x, text: seg.text, endMs: seg.endMs, updatedAt: new Date().toISOString() }
        : x)),
      durationMs: Math.max(s.durationMs, watch.elapsed())
    }));
    if (node) node.textContent = seg.text;
    scrollToBottom();
    return true;
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
    lastSegmentId = segs.length ? segs[segs.length - 1].id : null;
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

  /* タップのハンドラは同期で始める。
     Android の SpeechRecognition.start() はユーザー操作の直後でないと拒否されるため、
     await（DB書き込みやマイク許可）を挟む前に認識を起動する。 */
  function onPrimary() {
    if (mode === 'recording') return;
    startRecognitionNow();
    if (mode === 'paused') resume();
    else begin();
  }

  function startRecognitionNow() {
    blockedHandled = false;
    if (!isSpeechSupported()) {
      showBanner('このブラウザは音声認識に対応していません。Android では Chrome をお使いください。「＋ 文章を追加」で手入力できます。', 'warn');
      recognitionState = 'unavailable';
      return;
    }
    transcriber.start();
    startWatchdog();
  }

  /* 認識が「開始した」と言うのに何も返さない端末があるため、
     一定時間ぶんの空振りを検知して、手が打てる案内に切り替える。 */
  function startWatchdog() {
    clearTimeout(watchdogHandle);
    watchdogHandle = setTimeout(() => {
      if (mode !== 'recording') return;
      if (transcriber.gotAnyResult) return;
      handleBlocked({ code: 'no-result', neverWorked: true });
    }, WATCHDOG_MS);
  }

  function stopWatchdog() {
    clearTimeout(watchdogHandle);
    watchdogHandle = null;
  }

  async function begin() {
    watch.start();
    mode = 'recording';
    startTimer();
    updateControls();
    paintState();

    await store.updateSession(session.id, { status: 'recording', startedAt: session.startedAt || new Date().toISOString() });
    await startRecorderIfPossible();
    await screenLock.acquire();
    paintState();
  }

  /** 録音は「あると便利」な機能。失敗しても文字起こしは続ける */
  async function startRecorderIfPossible() {
    const settings = store.state.settings;
    if (!settings.saveAudio) return;

    if (settings.deviceCannotDoBoth) {
      // 以前この端末で競合が起きているので、最初から録音しない
      if (!blockedHandled) showBanner('この端末は録音と文字起こしを同時に使えないため、文字起こしのみ記録します。設定から戻せます。', 'warn');
      return;
    }
    if (!isRecorderSupported()) {
      if (!blockedHandled) showBanner('このブラウザは録音の保存に対応していません。文字起こしのみ記録します。', 'warn');
      return;
    }
    try {
      await recorder.start();
      audioStarted = true;
    } catch (err) {
      // 認識側で既に原因を案内しているなら、同じ話を上書きしない
      if (blockedHandled) return;
      showBanner(`録音を開始できませんでした（${err.message}）。文字起こしのみ続行します。`, 'warn');
    }
  }

  async function resume() {
    watch.start();
    mode = 'recording';
    startTimer();
    updateControls();
    paintState();

    if (audioStarted) recorder.resume();
    else await startRecorderIfPossible();
    await screenLock.acquire();
    paintState();
  }

  async function onPause() {
    if (mode !== 'recording') return;
    watch.pause();
    mode = 'paused';
    transcriber.stop();
    stopWatchdog();
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
    stopWatchdog();
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

    if (isEmpty()) {
      await store.removeSession(session.id);
      toast('記録がなかったので保存しませんでした');
      navigate('#/');
      return;
    }

    await store.updateSession(session.id, { status: 'done', durationMs: watch.elapsed() });
    toast(`保存しました${audioNote}`);
    navigate(`#/session/${session.id}`);
  }

  /** 何も記録せずに離れたセッションは一覧に残さない */
  function isEmpty() {
    const s = store.getSession(session.id);
    if (!s) return false;
    return (s.segments || []).length === 0
      && (s.notes || []).length === 0
      && !String(s.title || '').trim()
      && !s.audio;
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
      stopWatchdog();
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
    if (isEmpty()) await store.removeSession(session.id);
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

  /* 画面へ戻ってきたら、外れていた画面ロックを取り直すだけにする。
     「認識が止まるかも」といった予告は出さない（状態表示に出る）。 */
  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      screenLock.reacquireIfNeeded(mode === 'recording');
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
    stopWatchdog();
    stopTimer();
    screenLock.release();
    if (audioStarted) recorder.stop().catch(() => {});
    store.flushSaves();
    if (isEmpty()) store.removeSession(session.id);
  };
}
