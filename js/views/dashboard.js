/* ダッシュボード：セッションを見つける起点（提案書 4 章） */

import { el, clear, highlight, toast, confirmDialog } from '../ui.js';
import * as store from '../store.js';
import { filterSessions, collectTags, SORT_OPTIONS } from '../lib/search.js';
import { displayTitle, sessionStats, parseTags, SESSION_STATUS } from '../lib/model.js';
import { formatDateTime, formatElapsed } from '../lib/time.js';

const filter = { query: '', tags: [], from: '', to: '', sort: 'newest' };

export function render(root, { navigate }) {
  clear(root);
  const view = el('section', { class: 'view view--dashboard' });

  view.append(
    el('header', { class: 'page-head' }, [
      el('div', {}, [
        el('h1', { class: 'page-title' }, ['Kioku', el('span', { class: 'page-title__ja', text: '記憶' })]),
        el('p', { class: 'page-sub', text: '話したことを、そのまま残す' })
      ]),
      el('button', {
        class: 'btn btn--icon',
        type: 'button',
        title: '設定',
        'aria-label': '設定',
        onClick: () => navigate('#/settings')
      }, '⚙')
    ])
  );

  const searchBox = el('input', {
    class: 'input input--search',
    type: 'search',
    placeholder: '本文・メモ・タグを検索',
    value: filter.query,
    'aria-label': '全文検索',
    onInput: (e) => {
      filter.query = e.target.value;
      renderList();
    }
  });

  const sortSelect = el('select', {
    class: 'input input--select',
    'aria-label': '並び替え',
    onChange: (e) => {
      filter.sort = e.target.value;
      renderList();
    }
  }, SORT_OPTIONS.map((o) => el('option', { value: o.id, selected: o.id === filter.sort }, o.label)));

  const fromInput = el('input', {
    class: 'input input--date', type: 'date', value: filter.from, 'aria-label': '開始日',
    onChange: (e) => { filter.from = e.target.value; renderList(); }
  });
  const toInput = el('input', {
    class: 'input input--date', type: 'date', value: filter.to, 'aria-label': '終了日',
    onChange: (e) => { filter.to = e.target.value; renderList(); }
  });

  const tagBar = el('div', { class: 'tagbar' });
  const listHost = el('div', { class: 'session-list' });
  const summary = el('p', { class: 'list-summary' });

  const filters = el('details', { class: 'filters' }, [
    el('summary', { class: 'filters__summary', text: '絞り込み・並び替え' }),
    el('div', { class: 'filters__body' }, [
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '並び替え' }), sortSelect])
      ]),
      el('div', { class: 'field-row' }, [
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '開始日' }), fromInput]),
        el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '終了日' }), toInput])
      ]),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button',
        onClick: () => {
          filter.query = ''; filter.tags = []; filter.from = ''; filter.to = ''; filter.sort = 'newest';
          searchBox.value = ''; fromInput.value = ''; toInput.value = ''; sortSelect.value = 'newest';
          renderList();
        }
      }, '条件をクリア')
    ])
  ]);

  view.append(el('div', { class: 'toolbar' }, [searchBox]), filters, tagBar, summary, listHost);

  view.append(
    el('button', {
      class: 'fab', type: 'button', onClick: () => openNewSessionForm(navigate)
    }, [el('span', { class: 'fab__plus', text: '＋' }), el('span', { text: '新規セッション' })])
  );

  root.append(view);

  function renderTagBar() {
    clear(tagBar);
    const tags = collectTags(store.state.sessions);
    if (!tags.length) return;
    for (const { tag, count } of tags.slice(0, 24)) {
      const active = filter.tags.includes(tag);
      tagBar.append(el('button', {
        class: `chip ${active ? 'chip--active' : ''}`,
        type: 'button',
        onClick: () => {
          filter.tags = active ? filter.tags.filter((t) => t !== tag) : [...filter.tags, tag];
          renderTagBar();
          renderList();
        }
      }, `#${tag} ${count}`));
    }
  }

  function renderList() {
    const hits = filterSessions(store.state.sessions, filter);
    const total = store.state.sessions.length;
    summary.textContent = total === 0 ? '' : `${hits.length} / ${total} 件`;
    clear(listHost);

    if (total === 0) {
      listHost.append(emptyState(navigate));
      return;
    }
    if (hits.length === 0) {
      listHost.append(el('p', { class: 'empty', text: '条件に合うセッションがありません。' }));
      return;
    }
    for (const session of hits) {
      listHost.append(sessionCard(session, filter.query, navigate, renderAll));
    }
  }

  function renderAll() {
    renderTagBar();
    renderList();
  }

  renderAll();
  return renderAll;
}

function emptyState(navigate) {
  return el('div', { class: 'empty-state' }, [
    el('p', { class: 'empty-state__title', text: 'まだ記録がありません' }),
    el('p', { class: 'empty-state__body', text: '「新規セッション」から、録音とリアルタイム文字起こしを始められます。マイクが使えない場所では、文字入力だけでも記録できます。' }),
    el('button', { class: 'btn btn--primary', type: 'button', onClick: () => openNewSessionForm(navigate) }, '最初のセッションを作る')
  ]);
}

function sessionCard(session, query, navigate, refresh) {
  const stats = sessionStats(session);
  const preview = (session.segments || []).map((s) => s.text).join(' ').slice(0, 120)
    || (session.notes || []).map((n) => n.text).join(' ').slice(0, 120);

  const card = el('article', { class: 'card', tabindex: '0', role: 'button' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'card__title', html: highlight(displayTitle(session), query) }),
      el('span', { class: `badge badge--${session.status}`, text: SESSION_STATUS[session.status] || '' })
    ]),
    el('p', { class: 'card__meta', text: `${formatDateTime(session.createdAt)}・${formatElapsed(session.durationMs)}・文字起こし${stats.segmentCount}件・メモ${stats.noteCount}件${stats.hasAudio ? '・音声あり' : ''}` }),
    preview ? el('p', { class: 'card__preview', html: highlight(preview, query) }) : null,
    (session.tags || []).length
      ? el('div', { class: 'card__tags' }, session.tags.map((t) => el('span', { class: 'tag', text: `#${t}` })))
      : null,
    el('div', { class: 'card__actions' }, [
      session.status !== 'done'
        ? el('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: (e) => { e.stopPropagation(); navigate(`#/record/${session.id}`); } }, '記録を続ける')
        : el('button', { class: 'btn btn--sm', type: 'button', onClick: (e) => { e.stopPropagation(); navigate(`#/record/${session.id}`); } }, '追記する'),
      el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: (e) => { e.stopPropagation(); navigate(`#/session/${session.id}`); } }, '詳細'),
      el('button', {
        class: 'btn btn--sm btn--ghost btn--danger-text', type: 'button',
        onClick: async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog({
            title: 'セッションを削除しますか',
            message: `「${displayTitle(session)}」の文字起こし・メモ・音声をこの端末から完全に削除します。元に戻せません。`,
            confirmLabel: '削除する',
            danger: true
          });
          if (!ok) return;
          await store.removeSession(session.id);
          toast('削除しました');
          refresh();
        }
      }, '削除')
    ])
  ]);

  const open = () => navigate(session.status === 'done' ? `#/session/${session.id}` : `#/record/${session.id}`);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return card;
}

/** 新規セッション作成フォーム（提案書 3.1 の 1 番目） */
function openNewSessionForm(navigate) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const titleInput = el('input', { class: 'input', type: 'text', placeholder: '例）企画の打ち合わせ', 'aria-label': 'タイトル' });
  const purposeInput = el('select', { class: 'input input--select', 'aria-label': '用途' },
    ['会話・打ち合わせ', '独り言・思考整理', '読書メモ', 'アイデア', '日記', 'その他'].map((p) => el('option', { value: p }, p)));
  const participantsInput = el('input', { class: 'input', type: 'text', placeholder: '例）自分、田中さん', 'aria-label': '参加者' });
  const tagsInput = el('input', { class: 'input', type: 'text', placeholder: '例）仕事 企画 2026Q3', 'aria-label': 'タグ' });

  const close = () => backdrop.remove();

  const submit = async () => {
    const session = await store.addSession({
      title: titleInput.value.trim(),
      purpose: purposeInput.value,
      participants: participantsInput.value.trim(),
      tags: parseTags(tagsInput.value)
    });
    close();
    navigate(`#/record/${session.id}`);
  };

  backdrop.append(el('div', { class: 'modal modal--form', role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', { class: 'modal__title', text: '新規セッション' }),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'タイトル' }), titleInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '用途' }), purposeInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: '参加者（任意）' }), participantsInput]),
    el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'タグ（スペース区切り）' }), tagsInput]),
    el('div', { class: 'modal__actions' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onClick: close }, 'やめる'),
      el('button', { class: 'btn btn--primary', type: 'button', onClick: submit }, '作成して記録画面へ')
    ])
  ]));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  titleInput.focus();
}
