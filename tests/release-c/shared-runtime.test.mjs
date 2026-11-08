import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configRulesSource = fs.readFileSync(new URL('../../shared/config-rules.js', import.meta.url), 'utf8');
const concurrencySource = fs.readFileSync(new URL('../../shared/concurrency.js', import.meta.url), 'utf8');

test('shared rules and concurrency modules expose Node and browser interfaces', async () => {
  const nodeRules = require('../../shared/config-rules.js');
  const nodeConcurrency = require('../../shared/concurrency.js');
  assert.equal(nodeRules.CONFIG_RULES.actionCount.maximum, 100);
  assert.deepEqual(nodeRules.DEFAULT_DURATION_MS, [6000, 10000]);
  assert.equal(typeof nodeConcurrency.mapWithConcurrency, 'function');

  const browserContext = {};
  browserContext.globalThis = browserContext;
  vm.runInNewContext(configRulesSource, browserContext);
  vm.runInNewContext(concurrencySource, browserContext);
  assert.equal(browserContext.DesktopMascotConfigRules.CONFIG_RULES.actionCount.maximum, 100);
  assert.equal(typeof browserContext.DesktopMascotConcurrency.mapWithConcurrency, 'function');
  const mapped = await browserContext.DesktopMascotConcurrency.mapWithConcurrency(
    [1, 2, 3],
    2,
    async (value) => value * 2,
  );
  assert.deepEqual(Array.from(mapped), [2, 4, 6]);
});
