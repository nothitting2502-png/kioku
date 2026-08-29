/* 設定は件数が少なく同期的に読みたいので localStorage に置く */

const KEY = 'kioku:settings';

export const DEFAULT_SETTINGS = {
  lang: 'ja-JP',        // 認識言語
  saveAudio: true,      // 音声も端末内に保存するか
  keepAwake: true,      // 記録中に画面を消さない（Wake Lock）
  autoRestart: true,    // 認識が止まったら自動で再開する
  retentionDays: 0,     // 0 = 自動削除しない
  fontScale: 1          // 文字起こしの表示倍率
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* プライベートモードなどで保存できない場合は既定値のまま動かす */
  }
  return next;
}

export const LANGUAGES = [
  { id: 'ja-JP', label: '日本語' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'zh-CN', label: '中文（简体）' },
  { id: 'ko-KR', label: '한국어' }
];

export const RETENTIONS = [
  { id: 0, label: '自動削除しない' },
  { id: 30, label: '30日で削除' },
  { id: 90, label: '90日で削除' },
  { id: 365, label: '1年で削除' }
];
