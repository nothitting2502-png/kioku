/* ブラウザでテストを走らせるための node:assert/strict 代替（test/browser.html 用） */

function fail(message, actual, expected) {
  const err = new Error(message);
  err.actual = actual;
  err.expected = expected;
  throw err;
}

function show(v) {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function deepEqualValue(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqualValue(a[k], b[k]));
}

const assert = {
  ok(value, message) {
    if (!value) fail(message || `期待：真値 / 実際：${show(value)}`);
  },
  equal(actual, expected, message) {
    if (!Object.is(actual, expected)) fail(message || `期待：${show(expected)} / 実際：${show(actual)}`, actual, expected);
  },
  notEqual(actual, expected, message) {
    if (Object.is(actual, expected)) fail(message || `${show(actual)} と異なる値が必要です`);
  },
  deepEqual(actual, expected, message) {
    if (!deepEqualValue(actual, expected)) fail(message || `期待：${show(expected)} / 実際：${show(actual)}`, actual, expected);
  },
  match(actual, regexp, message) {
    if (!regexp.test(String(actual))) fail(message || `${show(actual)} が ${regexp} に一致しません`);
  },
  throws(fn, message) {
    try {
      fn();
    } catch {
      return;
    }
    fail(message || '例外が発生しませんでした');
  }
};

export default assert;
export { assert };
