/* 設定：保存・表示・データ管理（提案書 4 章 / 6 章） */

import { el, clear, toast, confirmDialog, downloadFile, bytes } from '../ui.js';
import * as store from '../store.js';
import { LANGUAGES, RETENTIONS } from '../settings.js';
import { toBackup } from '../lib/export.js';
import { fileStamp } from '../lib/time.js';
import { isSpeechSupported } from '../speech.js';
import { isRecorderSupported } from '../recorder.js';

export function render(root, { navigate }) {
  clear(root);
  const s = store.state.settings;
  const view = el('section', { class: 'view view--settings' });

  view.append(el('header', { class: 'record-head' }, [
    el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '戻る', onClick: () => navigate('#/') }, '←'),
    el('h1', { class: 'detail-title', text: '設定' }),
    el('span', { class: 'btn btn--icon', style: 'visibility:hidden' }, '　')
  ]));

  /* --- 認識 --- */
  view.append(section('文字起こし', [
    selectField('認識する言語', LANGUAGES, s.lang, (v) => store.updateSettings({ lang: v })),
    toggleField('認識が止まったら自動で再開する', s.autoRestart,
      (v) => store.updateSettings({ autoRestart: v }),
      'Android では無音が続くと認識が終了します。自動再開を切ると、その都度手動で開始し直す必要があります。')
  ]));

  /* --- 録音 --- */
  view.append(section('録音', [
    toggleField('音声も端末内に保存する', s.saveAudio,
      (v) => store.updateSettings({ saveAudio: v }),
      '保存すると、あとから聞き直せます。容量を節約したい場合はオフにしてください（文字起こしとメモは残ります）。'),
    toggleField('記録中は画面を消さない', s.keepAwake,
      (v) => store.updateSettings({ keepAwake: v }),
      'ブラウザは画面が消えると認識が止まることがあります。バッテリー消費は増えます。')
  ]));

  /* --- データ管理 --- */
  const usageEl = el('p', { class: 'field__help', text: '使用容量を確認しています…' });
  view.append(section('データ管理', [
    selectField('保存期間', RETENTIONS.map((r) => ({ id: String(r.id), label: r.label })), String(s.retentionDays),
      async (v) => {
        store.updateSettings({ retentionDays: Number(v) });
        const removed = await store.applyRetention();
        if (removed) toast(`${removed}件の古いセッションを削除しました`);
      }),
    usageEl,
    el('div', { class: 'export-buttons' }, [
      el('button', {
        class: 'btn btn--sm', type: 'button',
        onClick: () => {
          const data = toBackup(store.state.sessions);
          downloadFile(`kioku-backup-${fileStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast(`${data.sessionCount}件をバックアップしました`);
        }
      }, '全件バックアップ（JSON）'),
      importButton()
    ]),
    el('button', {
      class: 'btn btn--ghost btn--danger-text btn--block', type: 'button',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'すべてのデータを削除しますか',
          message: `${store.state.sessions.length}件のセッション（文字起こし・メモ・音声）をこの端末から完全に削除します。元に戻せません。先にバックアップを取ることをおすすめします。`,
          confirmLabel: 'すべて削除する', danger: true
        });
        if (!ok) return;
        await store.clearEverything();
        toast('すべて削除しました');
        navigate('#/');
      }
    }, 'すべてのデータを削除')
  ]));

  /* --- 環境と注意 --- */
  view.append(section('この端末の対応状況', [
    statusRow('音声認識（文字起こし）', isSpeechSupported()),
    statusRow('録音の保存', isRecorderSupported()),
    statusRow('端末内データベース', 'indexedDB' in window),
    statusRow('安全な接続（HTTPS / localhost）', window.isSecureContext),
    el('p', { class: 'field__help', text: 'マイクを使うには HTTPS か localhost での表示が必要です。Android では Chrome を推奨します。' })
  ]));

  view.append(section('プライバシー', [
    el('p', { class: 'notice' , text: 'ブラウザの音声認識は、端末やブラウザによっては音声データを外部の認識サービスへ送信します。機密性の高い内容を扱う前に、お使いのブラウザの仕様を確認してください。文字起こし・メモ・音声は、この端末のブラウザ内（IndexedDB）だけに保存され、サーバーへは送信されません。' }),
    el('p', { class: 'field__help', text: 'ブラウザの「サイトデータを削除」を実行すると記録も消えます。大事な記録は定期的に JSON でバックアップしてください。' })
  ]));

  view.append(el('p', { class: 'version', text: `Kioku v${window.__APP_VERSION__ || '0.1.0'}` }));
  root.append(view);

  store.estimateUsage().then((u) => {
    usageEl.textContent = u
      ? `使用容量：${bytes(u.usage)} / 見込み上限 ${bytes(u.quota)}（セッション ${store.state.sessions.length}件）`
      : `セッション ${store.state.sessions.length}件`;
  });

  return () => {};
}

function section(title, children) {
  return el('div', { class: 'settings-section' }, [el('h2', { class: 'settings-title', text: title }), ...children]);
}

function selectField(label, options, value, onChange) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('select', {
      class: 'input input--select',
      onChange: (e) => onChange(e.target.value)
    }, options.map((o) => el('option', { value: o.id, selected: String(o.id) === String(value) }, o.label)))
  ]);
}

function toggleField(label, value, onChange, help) {
  const input = el('input', { type: 'checkbox', class: 'switch__input', onChange: (e) => onChange(e.target.checked) });
  input.checked = Boolean(value);
  return el('div', { class: 'field' }, [
    el('label', { class: 'switch' }, [input, el('span', { class: 'switch__track' }), el('span', { class: 'switch__label', text: label })]),
    help ? el('p', { class: 'field__help', text: help }) : null
  ]);
}

function statusRow(label, ok) {
  return el('p', { class: `status-row ${ok ? 'is-ok' : 'is-ng'}` }, [
    el('span', { class: 'status-row__icon', text: ok ? '✓' : '×' }),
    el('span', { text: label }),
    el('span', { class: 'status-row__value', text: ok ? '利用できます' : '利用できません' })
  ]);
}

function importButton() {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = await store.importBackup(text);
      if (result.ok) toast(`${result.added}件を取り込みました`);
      else toast(result.error, 'error');
      e.target.value = '';
    }
  });
  const button = el('button', { class: 'btn btn--sm', type: 'button', onClick: () => input.click() }, 'バックアップを読み込む');
  return el('span', {}, [button, input]);
}
