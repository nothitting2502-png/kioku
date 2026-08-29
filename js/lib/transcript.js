/* 認識結果をどう積むかの判断（DOM 非依存 / テスト対象）

   Android の音声認識は、話している間ずっと「そこまでの累積文」を返し続ける。
   さらに continuous が効かず認識が何度も終了するため、
   素直に append すると同じ文が何行も積み上がる。

       バイクの奪い合い
       バイクの奪い合い
       バイクの奪い合い 先にマイクを掴むので
       バイクの奪い合い 先にマイクを掴むので

   直前の行を「伸ばす」のか「新しい行にする」のかを、ここで一元的に決める。 */

/** 比較用に正規化する。空白の揺れと句読点の有無で別物にしない */
export function normalizeText(text) {
  return String(text ?? '')
    .replace(/[　\s]+/g, ' ')
    .trim();
}

/** 前後の文をつなぐときの区切り。日本語なら詰め、英字どうしなら空白を入れる */
function join(previous, addition) {
  if (!previous) return addition;
  if (!addition) return previous;
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(addition);
  return needsSpace ? `${previous} ${addition}` : previous + addition;
}

/** 同じ発話の続きとみなす時間の上限。これを超えたら別の文として扱う */
export const CONTINUATION_WINDOW_MS = 20000;

/**
 * 直前の行に対して、届いたテキストをどう扱うか決める。
 *
 * @param {{text:string, endMs?:number}|null} previous 直前に積んだ行
 * @param {string} incoming 届いたテキスト
 * @param {{atMs?:number}} [opts] incoming の時刻（継続とみなすかの判定に使う）
 * @returns {{action:'append'|'replace'|'skip', text:string}}
 */
export function decideCommit(previous, incoming, opts = {}) {
  const next = normalizeText(incoming);
  if (!next) return { action: 'skip', text: '' };

  const prev = normalizeText(previous?.text);
  if (!prev) return { action: 'append', text: next };

  // 時間が空いていれば、似ていても別の発話として扱う
  const atMs = opts.atMs;
  const prevEnd = previous?.endMs ?? previous?.startMs;
  const tooOld = Number.isFinite(atMs) && Number.isFinite(prevEnd)
    && atMs - prevEnd > CONTINUATION_WINDOW_MS;
  if (tooOld) return { action: 'append', text: next };

  if (next === prev) return { action: 'skip', text: prev };

  // 直前の行が伸びた（累積結果）→ 行を増やさず置き換える
  if (next.startsWith(prev)) return { action: 'replace', text: next };

  // 届いた方が短い＝すでに書いた内容の一部 → 何もしない
  if (prev.startsWith(next)) return { action: 'skip', text: prev };

  return { action: 'append', text: next };
}

/**
 * 保存済みのセグメント列から、重複・累積の重なりを畳んで作り直す。
 * 以前の版で溜まってしまった記録の掃除にも使う。
 *
 * @param {Array<{text:string,startMs:number,endMs?:number}>} segments
 */
export function collapseSegments(segments) {
  const out = [];
  for (const seg of segments || []) {
    const previous = out[out.length - 1] || null;
    const { action, text } = decideCommit(previous, seg.text, { atMs: seg.startMs });
    if (action === 'skip') continue;
    if (action === 'replace') {
      out[out.length - 1] = { ...previous, text, endMs: seg.endMs ?? previous.endMs };
      continue;
    }
    out.push({ ...seg, text });
  }
  return out;
}

export { join as joinText };
