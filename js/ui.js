/* DOM 用の小さなヘルパー群 */

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/** 検索語をハイライトした HTML を返す（入力はエスケープ済みにする） */
export function highlight(text, query) {
  const safe = escapeHtml(text);
  const q = String(query || '').trim();
  if (!q) return safe;
  const terms = q.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return safe;
  return safe.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>');
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const host = document.getElementById('toast');
  if (!host) return;
  host.textContent = message;
  host.className = `toast toast--${kind} is-visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.className = 'toast';
  }, kind === 'error' ? 5200 : 2600);
}

/** window.confirm の代わり（Android で見やすく、文言を自由にできる） */
export function confirmDialog({ title, message, confirmLabel = '実行する', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('div', { class: 'modal-backdrop' });
    const close = (value) => {
      dialog.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };
    dialog.append(
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', { class: 'modal__title', text: title }),
        el('p', { class: 'modal__body', text: message }),
        el('div', { class: 'modal__actions' }, [
          el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => close(false) }, 'やめる'),
          el('button', {
            class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
            type: 'button',
            onClick: () => close(true)
          }, confirmLabel)
        ])
      ])
    );
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) close(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(dialog);
  });
}

/** window.prompt の代わり。Android のシステムダイアログより入力しやすい。
 *  @returns {Promise<string|null>} 取り消したときは null */
export function promptDialog({ title, label = '', placeholder = '', value = '', confirmLabel = '追加する', multiline = true }) {
  return new Promise((resolve) => {
    const field = multiline
      ? el('textarea', { class: 'input input--note', rows: '3', placeholder, 'aria-label': label || title })
      : el('input', { class: 'input', type: 'text', placeholder, 'aria-label': label || title });
    field.value = value;

    const backdrop = el('div', { class: 'modal-backdrop' });
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const submit = () => {
      const text = field.value.trim();
      close(text ? text : null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
    };

    backdrop.append(el('div', { class: 'modal modal--form', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { class: 'modal__title', text: title }),
      label ? el('label', { class: 'field' }, [el('span', { class: 'field__label', text: label }), field]) : field,
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', onClick: () => close(null) }, 'やめる'),
        el('button', { class: 'btn btn--primary', type: 'button', onClick: submit }, confirmLabel)
      ])
    ]));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(backdrop);
    field.focus();
  });
}

/** テキスト/JSON/CSV をダウンロードする */
export function downloadFile(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** 端末の共有シート（Android Chrome で使える） */
export async function shareText(title, text) {
  if (!navigator.share) return false;
  try {
    await navigator.share({ title, text });
    return true;
  } catch {
    return false;
  }
}

export function bytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 入力欄の高さを内容に合わせる */
export function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
}
