/* Android の音声認識のふるまいを偽の SpeechRecognition で再現し、
   Transcriber が「同じ行を積み上げない」ことを確かめる。
   マイクなしで走るので Mac でもCIでも実行できる。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transcriber } from '../js/speech.js';

/* ---------- 偽の SpeechRecognition ---------- */

class MockRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.started = false;
    MockRecognition.instances.push(this);
  }

  start() {
    this.started = true;
    this.onstart?.();
  }

  stop() {
    this.started = false;
    this.onend?.();
  }

  abort() {
    this.started = false;
    this.onend?.();
  }

  /** Android は話している間ずっと「そこまでの累積文」を返してくる */
  interim(text) {
    this.onresult?.(resultEvent([{ text, isFinal: false }]));
  }

  final(text) {
    this.onresult?.(resultEvent([{ text, isFinal: true }]));
  }

  /** 端末側の都合で認識が終わる（continuous が効かない端末の挙動） */
  endByItself() {
    this.started = false;
    this.onend?.();
  }
}
MockRecognition.instances = [];

function resultEvent(entries) {
  const results = entries.map((e) => {
    const alternatives = [{ transcript: e.text }];
    alternatives.isFinal = e.isFinal;
    return alternatives;
  });
  return { resultIndex: 0, results };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ブラウザで走らせる場合、本物の SpeechRecognition が存在するので両方とも差し替える */
function installMock() {
  MockRecognition.instances = [];
  globalThis.SpeechRecognition = MockRecognition;
  globalThis.webkitSpeechRecognition = MockRecognition;
}

/** 画面側の積み方を、記録画面と同じ規則で真似る */
function makeRecorder() {
  const rows = [];
  return {
    rows,
    onFinal(seg) {
      if (seg.replacesLast && rows.length) rows[rows.length - 1] = seg.text;
      else rows.push(seg.text);
    }
  };
}

function setup({ autoRestart = true } = {}) {
  installMock();
  let now = 0;
  const view = makeRecorder();
  const interims = [];
  const transcriber = new Transcriber({
    lang: 'ja-JP',
    autoRestart,
    elapsed: () => now,
    onInterim: (t) => interims.push(t),
    onFinal: (seg) => view.onFinal(seg),
    onStatus: () => {},
    onError: () => {},
    onBlocked: () => {}
  });
  return {
    transcriber,
    view,
    interims,
    advance: (ms) => { now += ms; },
    latest: () => MockRecognition.instances[MockRecognition.instances.length - 1]
  };
}

/* ---------- テスト ---------- */

test('累積結果が繰り返し届いても、行は増えず1行が伸びていく', async () => {
  const { transcriber, view, advance, latest } = setup();
  transcriber.start();

  // 実機と同じ流れ：同じ文の途中結果 → 端末都合で終了 → 再開、を繰り返す
  advance(5000);
  latest().interim('バイクの奪い合い');
  latest().endByItself();
  await sleep(400);

  advance(600);
  latest().interim('バイクの奪い合い');
  latest().endByItself();
  await sleep(400);

  advance(600);
  latest().interim('バイクの奪い合い 先にマイクを掴むので');
  latest().endByItself();
  await sleep(400);

  advance(600);
  latest().interim('バイクの奪い合い 先にマイクを掴むので Android');
  latest().endByItself();
  await sleep(400);

  transcriber.stop();
  assert.deepEqual(view.rows, ['バイクの奪い合い 先にマイクを掴むので Android']);
});

test('確定結果が別の文なら、新しい行になる', async () => {
  const { transcriber, view, advance, latest } = setup();
  transcriber.start();

  advance(1000);
  latest().final('見積もりは来週までに出す');
  advance(2000);
  latest().final('納期は9月中旬を希望している');

  transcriber.stop();
  assert.deepEqual(view.rows, ['見積もりは来週までに出す', '納期は9月中旬を希望している']);
});

test('途中結果のまま終了しても、内容は失われない', async () => {
  const { transcriber, view, advance, latest } = setup({ autoRestart: false });
  transcriber.start();
  advance(1500);
  latest().interim('あとで見積もりを送る');
  transcriber.stop();
  assert.deepEqual(view.rows, ['あとで見積もりを送る']);
});

test('確定結果のあとに同じ内容の途中結果が来ても二重にならない', async () => {
  const { transcriber, view, advance, latest } = setup({ autoRestart: false });
  transcriber.start();
  advance(1000);
  latest().final('よろしくお願いします');
  advance(300);
  latest().interim('よろしくお願いします');
  transcriber.stop();
  assert.deepEqual(view.rows, ['よろしくお願いします']);
});

test('途中結果は画面へ流れ、確定したら空になる', async () => {
  const { transcriber, interims, advance, latest } = setup({ autoRestart: false });
  transcriber.start();
  advance(500);
  latest().interim('えーっと');
  latest().final('えーっと、そうですね');
  transcriber.stop();
  assert.ok(interims.includes('えーっと'), '途中結果が画面へ渡る');
  assert.equal(interims[interims.length - 1], '', '最後は空に戻る');
});

test('無音で終了が続いても、一度認識できていれば止めずに再開する', async () => {
  const { transcriber, advance, latest } = setup();
  transcriber.start();
  advance(1000);
  latest().final('はじめまして');

  // 無音のまま終了が4回続く（continuous が効かない端末では普通に起きる）
  for (let i = 0; i < 4; i += 1) {
    latest().endByItself();
    await sleep(350);
  }
  assert.equal(transcriber.running, true, '記録は続いている');
  assert.equal(transcriber.diagnostics.emptyRuns, 0, '正常な無音を異常として数えない');
  transcriber.stop();
});

test('一度も認識できないまま空振りが続いたら、再試行をやめて知らせる', async () => {
  installMock();
  const blocked = [];
  const transcriber = new Transcriber({
    lang: 'ja-JP', autoRestart: true, elapsed: () => 0,
    onInterim: () => {}, onFinal: () => {}, onStatus: () => {},
    onError: () => {}, onBlocked: (info) => blocked.push(info)
  });
  transcriber.start();

  for (let i = 0; i < 4; i += 1) {
    const rec = MockRecognition.instances[MockRecognition.instances.length - 1];
    rec.endByItself();
    await sleep(350);
  }

  assert.equal(blocked.length >= 1, true, '原因を呼び出し側へ知らせる');
  assert.equal(blocked[0].code, 'no-audio');
  assert.equal(blocked[0].neverWorked, true);
  assert.equal(transcriber.running, false, '無限に再試行しない');
});
