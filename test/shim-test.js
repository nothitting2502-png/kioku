/* ブラウザでテストを走らせるための node:test 代替（test/browser.html 用） */

const queue = [];

export function test(name, fn) {
  queue.push({ name, fn });
}

export default test;

/** browser.html から呼ぶ。登録済みテストを順に実行して結果を返す。 */
export async function runAll(onResult) {
  const results = [];
  for (const item of queue) {
    const started = performance.now();
    try {
      await item.fn();
      const r = { name: item.name, ok: true, ms: performance.now() - started };
      results.push(r);
      onResult?.(r);
    } catch (err) {
      const r = { name: item.name, ok: false, ms: performance.now() - started, error: err?.message || String(err) };
      results.push(r);
      onResult?.(r);
    }
  }
  return results;
}
