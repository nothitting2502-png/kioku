/* 時刻・経過時間の整形（DOM 非依存 / テスト対象） */

/** ミリ秒を mm:ss または h:mm:ss に整形する */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** ISO 文字列を「2026/08/29 19:45」形式にする */
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 文字列を YYYY-MM-DD（ローカル日付）にする。日付フィルタ用 */
export function toLocalDateKey(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ファイル名に使える日時スタンプ */
export function fileStamp(iso = new Date().toISOString()) {
  return toLocalDateKey(iso).replace(/-/g, '') + '-' + formatDateTime(iso).slice(11).replace(':', '');
}
