/* MediaRecorder ラッパー。
   録音は「あると便利だが必須ではない」機能として扱い、
   失敗しても文字起こしは続行できるようにしている。 */

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
}

export function isRecorderSupported() {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export class AudioRecorder {
  constructor() {
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.mimeType = '';
  }

  get state() {
    return this.recorder ? this.recorder.state : 'inactive';
  }

  async start() {
    if (!isRecorderSupported()) throw new Error('このブラウザは録音に対応していません。');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    this.mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = this.mimeType
      ? new MediaRecorder(this.stream, { mimeType: this.mimeType })
      : new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    // 1秒ごとに切り出しておくと、異常終了しても途中までは残る
    this.recorder.start(1000);
  }

  pause() {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume() {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  /** @returns {Promise<Blob|null>} */
  async stop() {
    if (!this.recorder) {
      this._releaseStream();
      return null;
    }
    const type = this.recorder.mimeType || this.mimeType || 'audio/webm';
    const done = new Promise((resolve) => {
      this.recorder.onstop = () => resolve();
    });
    try {
      if (this.recorder.state !== 'inactive') this.recorder.stop();
      else resolveImmediately(done);
    } catch {
      /* 停止済みなら無視 */
    }
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    this._releaseStream();
    const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
    this.chunks = [];
    this.recorder = null;
    return blob;
  }

  _releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function resolveImmediately() {
  /* stop() 済みで onstop が来ない環境向けのフォールバック（Promise.race のタイムアウトが処理する） */
}

/** 記録中に画面が消えないようにする（Android Chrome 対応） */
export class ScreenLock {
  constructor() {
    this.sentinel = null;
  }

  async acquire() {
    if (!('wakeLock' in navigator)) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener?.('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release() {
    try {
      await this.sentinel?.release();
    } catch {
      /* 既に解放済み */
    }
    this.sentinel = null;
  }

  /** 画面復帰時に取り直す */
  async reacquireIfNeeded(active) {
    if (active && !this.sentinel && document.visibilityState === 'visible') {
      await this.acquire();
    }
  }
}
