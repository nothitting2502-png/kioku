/* 起動とルーティング（ハッシュ 1 本の SPA） */

import * as store from './store.js';
import { el, clear, toast } from './ui.js';
import * as dashboard from './views/dashboard.js';
import * as record from './views/record.js';
import * as detail from './views/detail.js';
import * as settings from './views/settings.js';

window.__APP_VERSION__ = '0.1.0';

const root = document.getElementById('app');
let destroyCurrent = null;
let currentPath = null;

const ROUTES = [
  { pattern: /^#\/?$/, view: dashboard },
  { pattern: /^#\/record\/(?<id>[^/]+)$/, view: record },
  { pattern: /^#\/session\/(?<id>[^/]+)$/, view: detail },
  { pattern: /^#\/settings$/, view: settings }
];

function resolve(hash) {
  for (const route of ROUTES) {
    const m = route.pattern.exec(hash || '#/');
    if (m) return { view: route.view, params: m.groups || {} };
  }
  return { view: dashboard, params: {} };
}

export function navigate(hash, { replace = false, force = false } = {}) {
  if (force) currentPath = null;
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) location.hash = hash;
  else renderRoute();
}

function renderRoute() {
  const hash = location.hash || '#/';
  if (hash === currentPath) return;
  currentPath = hash;

  if (typeof destroyCurrent === 'function') {
    try { destroyCurrent(); } catch { /* 後始末の失敗で画面遷移を止めない */ }
  }
  destroyCurrent = null;

  const { view, params } = resolve(hash);
  window.scrollTo(0, 0);
  const result = view.render(root, { navigate, params });
  if (typeof result === 'function') destroyCurrent = result;
  else if (view === dashboard) {
    // ダッシュボードは他画面での変更を反映できるよう購読する
    const off = store.subscribe(() => { if (location.hash === hash) result?.(); });
    destroyCurrent = off;
  }
}

async function boot() {
  clear(root);
  root.append(el('p', { class: 'loading', text: '読み込み中…' }));
  await store.init();
  if (store.state.error) {
    clear(root);
    root.append(el('div', { class: 'banner banner--error', text: `データを読み込めませんでした：${store.state.error}` }));
    return;
  }
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// で開いた場合は登録できないので黙って諦める
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('error', (e) => {
  if (e?.message) toast(`エラー：${e.message}`, 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || String(e?.reason || '');
  if (msg) toast(`エラー：${msg}`, 'error');
});

boot();
