/* 設定：本人にしか決められないことだけを置く。
   自動再開・画面の消灯防止・録音と認識の競合回避は、
   選ばせずにアプリが常に面倒を見る。 */

import { el, clear, toast, confirmDialog, downloadFile, bytes } from '../ui.js';
import * as store from '../store.js';
import { LANGUAGES } from '../settings.js';
import { toBackup } from '../lib/export.js';
import { fileStamp } from '../lib/time.js';
import { isSpeechSupported } from '../speech.js';
import { isRecorderSupported } from '../recorder.js';

export function render(root, { navigate }) {
  clear(root);
  const view = el('section', { class: 'view view--settings' });

  view.append(el('header', { class: 'record-head' }, [
    el('button', { class: 'btn btn--icon', type: 'button', 'aria-label': '戻る', onClick: () => navigate('#/') }, '←'),
    el('h1', { class: 'detail-title', text: '設定' })
  ]));

  /* --- 記録のしかた --- */
  const s = store.state.settings;
  const audioToggle = toggleField('音声も残す', s.saveAudio, (v) => {
    store.updateSettings({ saveAudio: v });
    toast(v ? '音声を保存します' : '文字起こしとメモだけを保存します');
  }, '残すとあとから聞き直せます。容量を抑えたいときはオフにしてください（文字起こしとメモは残ります）。');

  view.append(section('記録', [
    selectField('言語', LANGUAGES, s.lang, (v) => {
      store.updateSettings({ lang: v });
      toast('次の録音から反映されます');
    }),
    audioToggle
  ]));

  /* --- データ --- */
  const usage = el('p', { class: 'field__help' });
  view.append(section('データ', [
    usage,
    el('div', { class: 'export-buttons' }, [
      el('button', {
        class: 'btn btn--sm', type: 'button',
        onClick: () => {
          const data = toBackup(store.state.sessions);
          downloadFile(`kioku-backup-${fileStamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
          toast(`${data.sessionCount}件を書き出しました`);
        }
      }, 'バックアップ'),
      importButton()
    ]),
    el('button', {
      class: 'btn btn--ghost btn--danger-text btn--block', type: 'button',
      onClick: async () => {
        const ok = await confirmDialog({
          title: 'すべて削除しますか',
          message: `${store.state.sessions.length}件の記録（文字起こし・メモ・音声）をこの端末から完全に削除します。元に戻せません。`,
          confirmLabel: '削除する', danger: true
        });
        if (!ok) return;
        await store.clearEverything();
        toast('すべて削除しました');
        navigate('#/');
      }
    }, 'すべて削除')
  ]));

  /* --- 端末の状態（診断） --- */
  const statusHost = el('div');
  view.append(section('この端末', [statusHost]));
  renderDeviceStatus();

  view.append(el('p', { class: 'notice', text: 'ブラウザの音声認識は、端末によっては音声を外部の認識サービスへ送ります。文字起こし・メモ・音声そのものは、この端末のブラウザ内だけに保存され、サーバーへは送信されません。ブラウザのサイトデータを削除すると記録も消えるため、大事な記録はバックアップを取ってください。' }));
  view.append(el('p', { class: 'version', text: `Kioku v${window.__APP_VERSION__ || '0.1.0'}` }));
  root.append(view);

  store.estimateUsage().then((u) => {
    usage.textContent = u
      ? `記録 ${store.state.sessions.length}件・使用容量 ${bytes(u.usage)}`
      : `記録 ${store.state.sessions.length}件`;
  });

  function renderDeviceStatus() {
    clear(statusHost);
    statusHost.append(
      statusRow('文字起こし', isSpeechSupported()),
      statusRow('録音', isRecorderSupported()),
      statusRow('端末内の保存', 'indexedDB' in window),
      statusRow('安全な接続', window.isSecureContext)
    );

    if (!window.isSecureContext) {
      statusHost.append(el('p', { class: 'field__help', text: 'マイクを使うには https:// か localhost で開く必要があります。' }));
    }

    /* 録音と文字起こしを同時に使えないと判定した端末には、その事実と戻し方を示す */
    if (store.state.settings.deviceCannotDoBoth) {
      statusHost.append(el('div', { class: 'banner banner--warn' }, [
        el('div', { class: 'banner__body' }, [
          el('span', { text: 'この端末では録音と文字起こしを同時に使えないと判断したため、録音を止めて文字起こしを優先しています。' }),
          el('button', {
            class: 'btn btn--sm banner__action', type: 'button',
            onClick: () => {
              store.updateSettings({ deviceCannotDoBoth: false });
              toast('次の録音でもう一度ためします');
              renderDeviceStatus();
            }
          }, 'もう一度ためす')
        ])
      ]));
    }
  }

  return () => {};
}

function section(title, children) {
  return el('div', { class: 'settings-section' }, [el('h2', { class: 'settings-title', text: title }), ...children]);
}

function selectField(label, options, value, onChange) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: label }),
    el('select', { class: 'input input--select', onChange: (e) => onChange(e.target.value) },
      options.map((o) => el('option', { value: o.id, selected: String(o.id) === String(value) }, o.label)))
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
    el('span', { class: 'status-row__value', text: ok ? '使えます' : '使えません' })
  ]);
}

function importButton() {
  const input = el('input', {
    type: 'file', accept: 'application/json,.json', hidden: true,
    onChange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const result = await store.importBackup(await file.text());
      toast(result.ok ? `${result.added}件を読み込みました` : result.error, result.ok ? 'info' : 'error');
      e.target.value = '';
    }
  });
  return el('span', {}, [
    el('button', { class: 'btn btn--sm', type: 'button', onClick: () => input.click() }, '読み込み'),
    input
  ]);
}
