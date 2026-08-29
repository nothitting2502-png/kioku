/* ダッシュボード：記録を見つける起点。
   操作は「探す」「開く」「はじめる」の3つだけに絞る。
   並び替えと日付フィルタは置かない（常に新しい順、日付は検索語で辿れる）。 */

import { el, clear, highlight } from '../ui.js';
import * as store from '../store.js';
import { filterSessions, collectTags } from '../lib/search.js';
import { displayTitle, sessionStats } from '../lib/model.js';
import { formatDateTime, formatElapsed } from '../lib/time.js';

const filter = { query: '', tags: [] };

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
        class: 'btn btn--icon', type: 'button', title: '設定', 'aria-label': '設定',
        onClick: () => navigate('#/settings')
      }, '⚙')
    ])
  );

  const searchBox = el('input', {
    class: 'input input--search',
    type: 'search',
    placeholder: '本文・メモ・タグ・日付で検索',
    value: filter.query,
    'aria-label': '検索',
    onInput: (e) => {
      filter.query = e.target.value;
      renderList();
    }
  });

  const tagBar = el('div', { class: 'tagbar' });
  const listHost = el('div', { class: 'session-list' });

  view.append(searchBox, tagBar, listHost);
  view.append(
    el('button', { class: 'fab', type: 'button', onClick: () => startNewSession(navigate) }, [
      el('span', { class: 'fab__dot' }),
      el('span', { text: '録音をはじめる' })
    ])
  );
  root.append(view);

  function renderTagBar() {
    clear(tagBar);
    const tags = collectTags(store.state.sessions);
    for (const { tag } of tags.slice(0, 20)) {
      const active = filter.tags.includes(tag);
      tagBar.append(el('button', {
        class: `chip ${active ? 'chip--active' : ''}`,
        type: 'button',
        onClick: () => {
          filter.tags = active ? filter.tags.filter((t) => t !== tag) : [...filter.tags, tag];
          renderTagBar();
          renderList();
        }
      }, `#${tag}`));
    }
  }

  function renderList() {
    clear(listHost);
    if (store.state.sessions.length === 0) {
      listHost.append(el('div', { class: 'empty-state' }, [
        el('p', { class: 'empty-state__title', text: 'まだ記録がありません' }),
        el('p', { class: 'empty-state__body', text: '「録音をはじめる」を押すと、すぐに文字起こしが始まります。タイトルはあとから付けられます。' })
      ]));
      return;
    }
    const hits = filterSessions(store.state.sessions, filter);
    if (hits.length === 0) {
      listHost.append(el('p', { class: 'empty', text: '見つかりませんでした。' }));
      return;
    }
    for (const session of hits) listHost.append(sessionCard(session, filter.query, navigate));
  }

  function renderAll() {
    renderTagBar();
    renderList();
  }

  renderAll();
  return renderAll;
}

/** カード全体がひとつのボタン。個別の操作ボタンは詳細画面に集約する */
function sessionCard(session, query, navigate) {
  const stats = sessionStats(session);
  const preview = (session.segments || []).map((s) => s.text).join(' ').slice(0, 110)
    || (session.notes || []).map((n) => n.text).join(' ').slice(0, 110);
  const unfinished = session.status !== 'done';

  const card = el('article', { class: 'card', tabindex: '0', role: 'button' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { class: 'card__title', html: highlight(displayTitle(session), query) }),
      unfinished ? el('span', { class: 'badge badge--draft', text: '記録中' }) : null
    ]),
    el('p', { class: 'card__meta', text: `${formatDateTime(session.createdAt)}・${formatElapsed(session.durationMs)}${stats.noteCount ? `・メモ${stats.noteCount}` : ''}` }),
    preview ? el('p', { class: 'card__preview', html: highlight(preview, query) }) : null,
    (session.tags || []).length
      ? el('div', { class: 'card__tags' }, session.tags.map((t) => el('span', { class: 'tag', text: `#${t}` })))
      : null
  ]);

  const open = () => navigate(unfinished ? `#/record/${session.id}` : `#/session/${session.id}`);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return card;
}

/* 作成フォームは置かない。押したらすぐ記録画面へ行き、
   タイトルとタグはあとから付ける（話し始めるまでの手数を減らす）。 */
async function startNewSession(navigate) {
  const session = await store.addSession();
  navigate(`#/record/${session.id}`);
}
