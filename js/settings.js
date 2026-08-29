/* 設定は「本人にしか決められないこと」だけ置く。
   自動再開・画面の消灯防止・録音と認識の競合回避は、
   選ばせずにアプリ側が常に面倒を見る。 */

const KEY = 'kioku:settings';

export const DEFAULT_SETTINGS = {
  lang: 'ja-JP',   // 認識する言語
  saveAudio: true, // 音声も端末内に残すか（容量に関わるので本人が決める）

  /* 以下は利用者に見せない。使ってみて分かったことを覚えておく欄。
     Android では音声認識サービスがマイクを占有するため、
     録音と文字起こしを同時に使えない端末がある。 */
  deviceCannotDoBoth: false
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
  { id: 'en-US', label: 'English' },
  { id: 'zh-CN', label: '中文' },
  { id: 'ko-KR', label: '한국어' }
];
