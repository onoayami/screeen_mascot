(function exposeConcurrency(root, factory) {
  const concurrency = factory();
  if (typeof module === 'object' && module.exports) module.exports = concurrency;
  else root.DesktopMascotConcurrency = concurrency;
})(globalThis, function createConcurrency() {
  'use strict';

  async function mapWithConcurrency(items, concurrency, mapper) {
    const values = Array.from(items || []);
    const results = new Array(values.length);
    const workerCount = Math.min(
      values.length,
      Math.max(1, Math.floor(Number(concurrency) || 1)),
    );
    let cursor = 0;

    async function worker() {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(values[index], index);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  return Object.freeze({ mapWithConcurrency });
});
