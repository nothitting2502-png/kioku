/* 一時停止を含む経過時間の計測（DOM 非依存 / テスト対象）
   録音を保存しない設定でも文字起こしのタイムスタンプが必要なので、
   MediaRecorder ではなくこのクラスが時刻の基準になる。 */

export class Stopwatch {
  /** @param {() => number} now テスト時に差し替えられる時刻取得関数 */
  constructor(now = () => Date.now()) {
    this._now = now;
    this.reset();
  }

  reset() {
    this._accumulated = 0;
    this._startedAt = null;
  }

  start() {
    if (this._startedAt == null) this._startedAt = this._now();
  }

  pause() {
    if (this._startedAt == null) return;
    this._accumulated += this._now() - this._startedAt;
    this._startedAt = null;
  }

  stop() {
    this.pause();
    return this.elapsed();
  }

  get running() {
    return this._startedAt != null;
  }

  elapsed() {
    const live = this._startedAt == null ? 0 : this._now() - this._startedAt;
    return this._accumulated + live;
  }
}
