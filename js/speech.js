/* Web Speech API のラッパー。
   Android の Chrome は無音や一定時間で認識が終わるため、
   記録中は自動で再開して「途切れない文字起こし」に見せる。
   提案書 9 章「音声認識が長時間で途切れる」への対策。 */

import { decideCommit } from './lib/transcript.js';

/* 実行時に取り出す。モジュール読み込み時に固定しないことで、
   テストから差し替えられるようにしている。 */
function getSR() {
  return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
}

export function isSpeechSupported() {
  return Boolean(getSR());
}

/* Android の Chrome は continuous を実質サポートせず、
   true にすると「累積した途中結果」を返しながら短い間隔で終了を繰り返す。
   false にすると発話の切れ目を検出して確定結果を返すため、こちらを使う。 */
function prefersSingleUtterance() {
  return /Android/i.test(globalThis.navigator?.userAgent || '');
}


const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/** 結果ゼロで即終了が続いたら、再試行をやめて呼び出し側へ知らせる回数 */
const EMPTY_RUN_LIMIT = 3;
/** start() の例外を許容する回数 */
const START_FAILURE_LIMIT = 3;

const ERROR_MESSAGES = {
  'not-allowed': 'マイクの使用が許可されていません。ブラウザの設定で許可してください。',
  'service-not-allowed': '音声認識サービスを利用できません。ブラウザの設定を確認してください。',
  'audio-capture': 'マイクを取得できませんでした。他のアプリが使用していないか確認してください。',
  network: 'ネットワークエラーで認識が中断しました。接続を確認してください。',
  'no-speech': '音声が検出されませんでした。'
};

export class Transcriber {
  /**
   * @param {object} opts
   * @param {string} opts.lang 認識言語
   * @param {boolean} opts.autoRestart 自動再開するか
   * @param {() => number} opts.elapsed 経過ミリ秒を返す関数（タイムスタンプの基準）
   * @param {(text:string) => void} opts.onInterim 途中結果
   * @param {(seg:{text:string,startMs:number,endMs:number}) => void} opts.onFinal 確定結果
   * @param {(state:string, detail?:string) => void} opts.onStatus 状態通知
   * @param {(message:string, fatal:boolean) => void} opts.onError エラー通知
   */
  constructor(opts) {
    this.opts = opts;
    this.recognition = null;
    this.running = false;      // 利用者が「記録中」を望んでいるか
    this.stopping = false;     // 明示的な停止処理中か
    this.restartDelay = 250;
    this._utteranceStart = null;
    this._restartTimer = null;

    /* 診断用。Android では「開始したのに何も返らず終わる」ことがあるため、
       黙って再試行し続けず、状況を数えて表に出す。 */
    this.gotAnyResult = false;   // このセッションで一度でも結果が来たか
    this.lastError = null;       // 最後のエラーコード
    this.startFailures = 0;      // start() が例外を投げた回数
    this.emptyRuns = 0;          // 結果ゼロのまま即終了した連続回数
    this._runStartedAt = 0;
    this._runGotResult = false;
    this._lastCommitted = null;  // 直前に積んだ行 { text, startMs, endMs }
  }

  start() {
    if (!getSR()) {
      this.opts.onError?.('このブラウザは音声認識に対応していません。文字入力で記録できます。', true);
      return false;
    }
    this.running = true;
    this.stopping = false;
    this.gotAnyResult = false;
    this.lastError = null;
    this.startFailures = 0;
    this.emptyRuns = 0;
    this._spawn();
    return true;
  }

  stop() {
    this.running = false;
    this.stopping = true;
    clearTimeout(this._restartTimer);
    this._flushInterim();
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* 既に停止している場合は無視 */
      }
    }
    this.opts.onStatus?.('stopped');
  }

  /** 設定画面や診断で使う現在の状態 */
  get diagnostics() {
    return {
      running: this.running,
      gotAnyResult: this.gotAnyResult,
      lastError: this.lastError,
      startFailures: this.startFailures,
      emptyRuns: this.emptyRuns
    };
  }

  setLang(lang) {
    this.opts.lang = lang;
    if (this.running) {
      // 反映のためいったん作り直す
      this._restart(0);
    }
  }

  _spawn() {
    const Recognition = getSR();
    const rec = new Recognition();
    rec.lang = this.opts.lang || 'ja-JP';
    rec.continuous = !prefersSingleUtterance();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this._lastInterim = '';

    rec.onstart = () => {
      this.restartDelay = 250;
      this.startFailures = 0;
      this._runStartedAt = Date.now();
      this._runGotResult = false;
      this.opts.onStatus?.('listening');
    };

    rec.onresult = (event) => {
      this._runGotResult = true;
      this.gotAnyResult = true;
      this.emptyRuns = 0;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) {
          const startMs = this._utteranceStart ?? this.opts.elapsed();
          this._utteranceStart = null;
          this._lastInterim = '';
          this._commit(text, startMs);
        } else {
          if (this._utteranceStart == null) this._utteranceStart = this.opts.elapsed();
          interim += text;
        }
      }
      this._lastInterim = interim;
      this.opts.onInterim?.(interim);
    };

    rec.onerror = (event) => {
      const code = event.error || 'unknown';
      if (code === 'aborted' && this.stopping) return;
      this.lastError = code;
      const fatal = FATAL_ERRORS.has(code);
      if (fatal) {
        this.running = false;
        // まだ一度も認識できていない場合は、マイクの取り合いが原因のことが多い
        this.opts.onBlocked?.({ code, neverWorked: !this.gotAnyResult });
        this.opts.onError?.(ERROR_MESSAGES[code] || `認識エラー: ${code}`, true);
        return;
      }
      if (code === 'no-speech') {
        this.opts.onStatus?.('idle', ERROR_MESSAGES['no-speech']);
        return;
      }
      this.opts.onError?.(ERROR_MESSAGES[code] || `認識エラー: ${code}`, false);
      this.restartDelay = Math.min(this.restartDelay * 2, 5000);
    };

    rec.onend = () => {
      this._flushInterim();

      /* 開始直後に結果ゼロで終わる＝音声が届いていない兆候。
         ただし一度でも認識できているなら、無音区間で終わるのは正常な動作なので数えない。 */
      const ranBriefly = Date.now() - this._runStartedAt < 1200;
      if (!this._runGotResult && ranBriefly && !this.gotAnyResult) this.emptyRuns += 1;

      if (this.running && this.emptyRuns >= EMPTY_RUN_LIMIT) {
        // 無限に再試行しても直らない。呼び出し側へ判断を委ねる
        this.running = false;
        this.opts.onStatus?.('stopped');
        this.opts.onBlocked?.({ code: 'no-audio', neverWorked: !this.gotAnyResult });
        return;
      }

      if (this.running && this.opts.autoRestart !== false) {
        this.opts.onStatus?.('reconnecting');
        this._restart(this.restartDelay);
      } else if (this.running) {
        this.running = false;
        this.opts.onStatus?.('stopped');
      }
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      // 直前のインスタンスがまだ終了していない場合は少し待てば直る。
      // ただし何度も失敗するなら黙って回り続けず、エラーとして表に出す。
      this.startFailures += 1;
      this.lastError = `start-failed: ${err?.message || err}`;
      if (this.startFailures >= START_FAILURE_LIMIT) {
        this.running = false;
        this.opts.onStatus?.('stopped');
        this.opts.onBlocked?.({ code: 'start-failed', neverWorked: !this.gotAnyResult });
        this.opts.onError?.('音声認識を開始できませんでした。マイクが他の機能に使われている可能性があります。', true);
        return;
      }
      this._restart(400);
    }
  }

  _restart(delay) {
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      if (!this.running) return;
      this._spawn();
    }, delay);
  }

  /** 途中結果が残ったまま切れたときに、取りこぼさず保存する。
      同じ内容が積み上がらないよう、必ず _commit を通す。 */
  _flushInterim() {
    const text = (this._lastInterim || '').trim();
    this._lastInterim = '';
    this.opts.onInterim?.('');
    if (!text) {
      this._utteranceStart = null;
      return;
    }
    const startMs = this._utteranceStart ?? this.opts.elapsed();
    this._utteranceStart = null;
    this._commit(text, startMs, true);
  }

  /* 直前の行を伸ばすのか、新しい行にするのか、捨てるのかを決めて通知する。
     Android は同じ文を何度も返してくるため、ここを通さないと同じ行が積み上がる。 */
  _commit(text, startMs, fromInterim = false) {
    const endMs = this.opts.elapsed();
    const decision = decideCommit(this._lastCommitted, text, { atMs: startMs });
    if (decision.action === 'skip') return;

    if (decision.action === 'replace') {
      this._lastCommitted = { ...this._lastCommitted, text: decision.text, endMs };
      this.opts.onFinal?.({
        text: decision.text,
        startMs: this._lastCommitted.startMs,
        endMs,
        fromInterim,
        replacesLast: true
      });
      return;
    }

    this._lastCommitted = { text: decision.text, startMs, endMs };
    this.opts.onFinal?.({ text: decision.text, startMs, endMs, fromInterim, replacesLast: false });
  }
}
