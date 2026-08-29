/* Web Speech API のラッパー。
   Android の Chrome は無音や一定時間で認識が終わるため、
   記録中は自動で再開して「途切れない文字起こし」に見せる。
   提案書 9 章「音声認識が長時間で途切れる」への対策。 */

const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;

export function isSpeechSupported() {
  return Boolean(SR);
}

const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

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
  }

  start() {
    if (!SR) {
      this.opts.onError?.('このブラウザは音声認識に対応していません。文字入力で記録できます。', true);
      return false;
    }
    this.running = true;
    this.stopping = false;
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

  setLang(lang) {
    this.opts.lang = lang;
    if (this.running) {
      // 反映のためいったん作り直す
      this._restart(0);
    }
  }

  _spawn() {
    const rec = new SR();
    rec.lang = this.opts.lang || 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.restartDelay = 250;
      this.opts.onStatus?.('listening');
    };

    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = (result[0]?.transcript || '').trim();
        if (!text) continue;
        if (result.isFinal) {
          const startMs = this._utteranceStart ?? this.opts.elapsed();
          this._utteranceStart = null;
          this._lastInterim = '';
          this.opts.onFinal?.({ text, startMs, endMs: this.opts.elapsed() });
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
      const fatal = FATAL_ERRORS.has(code);
      if (fatal) {
        this.running = false;
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
    } catch {
      // 直前のインスタンスがまだ終了していない場合は少し待って再試行
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

  /** 途中結果が残ったまま切れたときに、取りこぼさず確定扱いで保存する */
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
    this.opts.onFinal?.({ text, startMs, endMs: this.opts.elapsed(), fromInterim: true });
  }
}
